import { execFileSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { Agent as UndiciAgent, EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { ProxyAgent as NodeProxyAgent } from "proxy-agent";

import type { SettingProxyInfo } from "../shared/schema";

/**
 * 网络代理实现（Fello 四层覆盖）：
 *
 * 1. undici 全局 dispatcher —— 覆盖 Electron 主进程 / server 的全局 fetch
 *    （主进程 fetch 走 Node undici 而非 Chromium 栈，session.setProxy 覆盖不到）。
 * 2. http/https globalAgent —— 覆盖 electron-updater 等走 node:http(s) 的模块。
 * 3. 子进程 env（HTTP_PROXY / HTTPS_PROXY / NO_PROXY，大小写都设）——
 *    普通子进程继承 process.env 自动生效；MCP stdio 子进程需在
 *    src/agents/mcp-tools.ts 显式合并 buildProxyEnv() 的输出
 *    （@modelcontextprotocol/sdk 的 StdioClientTransport 只继承白名单 env）。
 * 4. Chromium session 代理 —— 由 Electron 侧单独调用 session.setProxy 完成。
 */

export interface ProxyConfig {
  /** 是否开启 */
  enabled: boolean;
  /** HTTP 代理地址，如 http://127.0.0.1:7890 */
  httpProxy?: string;
  /** HTTPS 代理地址，如 http://127.0.0.1:7890 */
  httpsProxy?: string;
  /** 不走代理的地址列表，逗号分隔 */
  noProxy?: string;
  /** 代理认证用户名（可选） */
  username?: string;
  /** 代理认证密码（可选） */
  password?: string;
}

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

let currentConfig: ProxyConfig = { enabled: false };

/** 数据转换 settingProxyInfo -> proxyConfig */
export function settingProxyInfoToProxyConfig(
  input: SettingProxyInfo | undefined | null,
): ProxyConfig {
  if (!input || input.mode === "off") return { enabled: false };
  const str = (value: string | undefined): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  return {
    enabled: true,
    httpProxy: str(input.httpProxy),
    httpsProxy: str(input.httpsProxy),
    noProxy: str(input.noProxy),
    username: str(input.username),
    password: str(input.password),
  };
}

/** 校验代理 URL：支持 http/https，缺省 scheme 时自动补 http:// */
function normalizeProxyUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    try {
      url = new URL(`http://${trimmed}`);
    } catch {
      return undefined;
    }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return url.toString().replace(/\/+$/, "");
}

/** 把认证信息拼进代理 URL（URL 属性会自动做百分号编码） */
function withAuth(url: string, username?: string, password?: string): string {
  if (!username) return url;
  try {
    const parsed = new URL(url);
    parsed.username = username;
    if (password) parsed.password = password;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return url;
  }
}

/**
 * 基于当前代理配置构建子进程环境变量（HTTP_PROXY / HTTPS_PROXY / NO_PROXY，大小写都设）。
 * 未启用代理或没有可用 URL 时返回空对象，调用方无需清理旧值（applyProxy 已处理 process.env）。
 *
 * 注意：manual 模式带认证时，用户名/密码会拼进代理 URL 并写入子进程环境变量，
 * 子进程与 /proc/<pid>/environ 均可读取，这是 env 代理方案的固有权衡；
 * Chromium 层不采用该方式（走 app 'login' 事件认证，见 electron/main.ts）。
 */
export function buildProxyEnv(): Record<string, string> {
  const config = currentConfig;
  if (config.enabled === false) return {};

  const httpProxy = normalizeProxyUrl(config.httpProxy);
  const httpsProxy = normalizeProxyUrl(config.httpsProxy ?? config.httpProxy);
  if (!httpProxy && !httpsProxy) return {};

  const noProxy = config.noProxy?.trim();
  const env: Record<string, string> = {};

  if (httpProxy) {
    const httpUrl = withAuth(httpProxy, config.username, config.password);
    if (httpUrl) {
      env.HTTP_PROXY = httpUrl;
      env.http_proxy = httpUrl;
    }
  }
  if (httpsProxy) {
    const httpsUrl = withAuth(httpsProxy, config.username, config.password);
    if (httpsUrl) {
      env.HTTPS_PROXY = httpsUrl;
      env.https_proxy = httpsUrl;
    }
  }
  if (noProxy) {
    env.NO_PROXY = noProxy;
    env.no_proxy = noProxy;
  }
  return env;
}

function setProcessEnv(env: Record<string, string>) {
  for (const key of PROXY_ENV_KEYS) {
    if (env[key]) {
      process.env[key] = env[key];
    } else {
      delete process.env[key];
    }
  }
}

function resetGlobalDispatchers() {
  setGlobalDispatcher(new UndiciAgent());
  http.globalAgent = new http.Agent();
  https.globalAgent = new https.Agent();
}

function enableGlobalDispatchers() {
  // EnvHttpProxyAgent / NodeProxyAgent 在每次请求时按 env 动态匹配
  // 目标 URL 与 NO_PROXY，因此只需在 env 就绪后各构造一次。
  setGlobalDispatcher(new EnvHttpProxyAgent());
  http.globalAgent = new NodeProxyAgent();
  https.globalAgent = new NodeProxyAgent();
}

/** 应用代理配置 */
export function applyProxy(config: ProxyConfig): void {
  currentConfig = config;

  if (config.enabled === false) {
    setProcessEnv({});
    resetGlobalDispatchers();
    return;
  }

  const env = buildProxyEnv();
  if (Object.keys(env).length === 0) {
    // manual 但 URL 不合法，或 system 但无可用代理 → 直连
    setProcessEnv({});
    resetGlobalDispatchers();
    return;
  }

  setProcessEnv(env);
  enableGlobalDispatchers();
}

/**
 * 探测系统代理（无头 server 场景；Electron 场景优先使用 session.resolveProxy）。
 * 优先级：环境变量 → macOS scutil --proxy → Windows netsh winhttp show proxy。
 * PAC（ProxyAutoConfig）不解析，仅识别显式代理；探测失败时返回 off。
 * 同步实现：scutil / netsh 均为本机毫秒级命令，仅在启动早期调用，阻塞无副作用。
 */
export function detectSystemProxy(): ProxyConfig {
  const envHttp =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (envHttp) {
    return {
      enabled: true,
      httpProxy: process.env.HTTP_PROXY || process.env.http_proxy || undefined,
      httpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy || undefined,
      noProxy: process.env.NO_PROXY || process.env.no_proxy || undefined,
    };
  }

  try {
    if (process.platform === "darwin") {
      const stdout = execFileSync("scutil", ["--proxy"], { timeout: 3000 }).toString();
      return parseScutilProxy(stdout);
    }
    if (process.platform === "win32") {
      const stdout = execFileSync("netsh", ["winhttp", "show", "proxy"], {
        timeout: 3000,
      }).toString();
      return parseNetshProxy(stdout);
    }
  } catch {
    // 探测命令不可用/超时 → 回退直连
  }
  return { enabled: false };
}

function parseScutilProxy(stdout: string): ProxyConfig {
  const get = (key: string): string | undefined => {
    const m = stdout.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "m"));
    return m ? m[1].trim() : undefined;
  };
  const host = (key: string): string | undefined => {
    const value = get(key);
    if (!value || value === "<null>") return undefined;
    return value.replace(/^"|"$/g, "");
  };
  const port = (key: string): string | undefined => {
    const value = get(key);
    return value && value !== "0" ? value : undefined;
  };
  const build = (enableKey: string, hostKey: string, portKey: string): string | undefined => {
    if (get(enableKey) !== "1") return undefined;
    const h = host(hostKey);
    if (!h) return undefined;
    const p = port(portKey);
    let proxyUrl = `http://${h}`;
    if (p) {
      proxyUrl += `:${p}`;
    }
    return proxyUrl;
  };

  const httpProxy = build("HTTPEnable", "HTTPProxy", "HTTPPort");
  const httpsProxy = build("HTTPSEnable", "HTTPSProxy", "HTTPSPort");
  if (!httpProxy && !httpsProxy) return { enabled: false };
  return { enabled: true, httpProxy, httpsProxy };
}

function parseNetshProxy(stdout: string): ProxyConfig {
  const match = stdout.match(/Proxy\s*Server\(s\)\s*:\s*(.+)$/m);
  if (!match) return { enabled: false };

  const raw = match[1].trim();
  if (!raw || raw === "<none>") return { enabled: false };

  let httpProxy: string | undefined;
  let httpsProxy: string | undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      // 形如 "127.0.0.1:7890"，同时作为 http/https 代理
      httpProxy = `http://${trimmed}`;
      httpsProxy = `http://${trimmed}`;
    } else {
      const scheme = trimmed.slice(0, eq).trim().toLowerCase();
      const value = trimmed.slice(eq + 1).trim();
      if (scheme === "http") httpProxy = `http://${value}`;
      else if (scheme === "https") httpsProxy = `http://${value}`;
    }
  }

  const bypass = stdout.match(/Bypass\s*List\s*:\s*(.+)$/m);
  const noProxy = bypass ? bypass[1].trim().replace(/<local>/g, "localhost,127.0.0.1") : undefined;

  if (!httpProxy && !httpsProxy) return { enabled: false };
  return { enabled: true, httpProxy, httpsProxy, noProxy };
}
