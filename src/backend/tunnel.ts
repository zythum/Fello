import { spawn, type ChildProcess } from "child_process";
import { stat } from "fs/promises";
import { homedir } from "os";
import { delimiter, join } from "path";
import type { TunnelProvider, TunnelProviderInfo, TunnelStatus } from "../shared/schema";
import { extractErrorMessage } from "./utils";

// ── Constants ────────────────────────────────────────────────────────

/** 检测结果缓存时间：安装 CLI 后最多等这么久就能在设置页看到「已检测到」。 */
const DETECT_CACHE_MS = 15_000;

/** 只保留输出末尾一段，避免长时间运行把整段日志留在内存里。 */
const OUTPUT_BUFFER_LIMIT = 16 * 1024;

const KILL_GRACE_MS = 3_000;

// ── Provider registry ────────────────────────────────────────────────

type ProviderConfig = {
  /** 本机可执行文件名（检测与 spawn 都用它）。 */
  command: string;
  /** 进程启动到打印公网地址的最长等待时间（devtunnel 首次可能要完成登录）。 */
  startTimeoutMs: number;
  /** 启动隧道的 CLI 参数。 */
  args: (port: number) => string[];
  /** 从 CLI 输出中解析公网地址。 */
  parseUrl: (output: string, port: number) => string | null;
  /** 启动失败时附加的登录 / 鉴权提示。 */
  loginHint: string;
};

/**
 * provider 之间的差异集中在这里。使用 Record<TunnelProvider, ...> 而不是
 * 三元判断：新增 TunnelProvider 时 TypeScript 会强制补齐配置，不会静默落到
 * 某个 else 分支；PROVIDERS 也由它派生，避免「检测列表」与「运行配置」不同步。
 */
const PROVIDER_CONFIG: Record<TunnelProvider, ProviderConfig> = {
  devtunnel: {
    command: "devtunnel",
    startTimeoutMs: 90_000,
    // 匿名访问由 WebUI 自身的 token 保护；否则外部设备还需要登录 Microsoft 账号。
    args: (port) => ["host", "-p", String(port), "--allow-anonymous"],
    parseUrl: parseDevtunnelUrl,
    loginHint: "Make sure you are logged in: run `devtunnel user login`.",
  },
  ngrok: {
    command: "ngrok",
    startTimeoutMs: 45_000,
    args: (port) => ["http", "--log=stdout", "--log-format=json", `http://127.0.0.1:${port}`],
    parseUrl: parseNgrokUrl,
    loginHint: "Make sure ngrok is authenticated: run `ngrok config add-authtoken <token>`.",
  },
};

/** 提供方顺序由注册表派生（Object.keys 保持字面量插入顺序）。 */
const PROVIDERS = Object.keys(PROVIDER_CONFIG) as TunnelProvider[];

// ── Executable discovery ─────────────────────────────────────────────

/**
 * 从 GUI 启动的 Electron 往往拿不到 shell 的完整 PATH（macOS 只有
 * /usr/bin:/bin:/usr/sbin:/sbin），Homebrew、dotnet tool、手工安装的 CLI 都会找不到。
 * 这里在 PATH 基础上补上常见安装目录，保证「已安装就能检测到」。
 */
function searchDirs(): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const push = (dir: string) => {
    const trimmed = dir.trim();
    if (!trimmed) return;
    const key = process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) return;
    seen.add(key);
    dirs.push(trimmed);
  };

  for (const entry of (process.env.PATH ?? process.env.Path ?? "").split(delimiter)) {
    push(entry);
  }

  const home = homedir();
  if (process.platform === "win32") {
    push(join(home, ".dotnet", "tools"));
    if (process.env.LOCALAPPDATA) {
      push(join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"));
    }
    if (process.env.APPDATA) push(join(process.env.APPDATA, "npm"));
    if (process.env.ProgramFiles) push(join(process.env.ProgramFiles, "ngrok"));
  } else {
    push("/opt/homebrew/bin");
    push("/usr/local/bin");
    push("/opt/local/bin");
    push("/usr/bin");
    push("/bin");
    push("/snap/bin");
    push(join(home, ".local", "bin"));
    push(join(home, ".dotnet", "tools"));
    push(join(home, "bin"));
  }
  return dirs;
}

function binaryNames(command: string): string[] {
  if (process.platform !== "win32") return [command];
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  const names = new Set<string>([command, `${command}.exe`]);
  for (const ext of exts) names.add(`${command}${ext}`);
  return [...names];
}

async function findExecutable(command: string): Promise<string | null> {
  const names = binaryNames(command);
  for (const dir of searchDirs()) {
    for (const name of names) {
      const candidate = join(dir, name);
      const info = await stat(candidate).catch(() => null);
      if (info?.isFile()) return candidate;
    }
  }
  return null;
}

type ProviderPaths = Record<TunnelProvider, string | null>;

let detectionCache: { at: number; paths: ProviderPaths } | null = null;

async function detectProviderPaths(force = false): Promise<ProviderPaths> {
  if (!force && detectionCache && Date.now() - detectionCache.at < DETECT_CACHE_MS) {
    return detectionCache.paths;
  }
  const paths: ProviderPaths = { devtunnel: null, ngrok: null };
  await Promise.all(
    PROVIDERS.map(async (provider) => {
      paths[provider] = await findExecutable(PROVIDER_CONFIG[provider].command);
    }),
  );
  detectionCache = { at: Date.now(), paths };
  return paths;
}

function buildSpawnEnv(): NodeJS.ProcessEnv {
  // Windows 上环境变量名大小写不敏感；先把原 PATH/Path 全部剔除，避免出现两个同名键。
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase() === "PATH") continue;
    env[key] = value;
  }
  env.PATH = searchDirs().join(delimiter);
  return env;
}

// ── Output parsing ───────────────────────────────────────────────────

/** 去掉 ANSI 颜色/光标控制序列和回车，便于解析 CLI 输出。 */
function stripAnsi(value: string): string {
  let output = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 27) {
      let j = i + 1;
      if (value[j] === "[") {
        j++;
        while (j < value.length) {
          const c = value.charCodeAt(j);
          if (c >= 0x40 && c <= 0x7e) break;
          j++;
        }
      }
      i = j;
      continue;
    }
    if (code === 13) continue;
    output += value[i];
  }
  return output;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.replace(/[),.;]+$/, "").replace(/\/+$/, "");
  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

/**
 * devtunnel 输出形如：
 *   Hosting port 8080 at https://abc123.usw2.devtunnels.ms:8080/, https://abc123-8080.usw2.devtunnels.ms/
 * 优先取带 `-<port>.` 的地址（不带显式端口，适合直接拼 token）。
 */
function parseDevtunnelUrl(output: string, port: number): string | null {
  const text = stripAnsi(output);
  const matches = text.match(/https:\/\/[^\s"'<>]+/g);
  if (!matches) return null;

  const candidates = matches
    .map((value) => normalizeBaseUrl(value))
    .filter((value) => {
      try {
        const host = new URL(value).hostname;
        return host.endsWith(".devtunnels.ms") && !host.includes("-inspect.");
      } catch {
        return false;
      }
    });
  if (candidates.length === 0) return null;

  const preferred = candidates.find((value) => {
    try {
      return new URL(value).hostname.includes(`-${port}.`);
    } catch {
      return false;
    }
  });
  return preferred ?? candidates[0];
}

function isNgrokSiteUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === "ngrok.com" || host.endsWith(".ngrok.com");
  } catch {
    return true;
  }
}

/**
 * ngrok 以 JSON 日志输出，隧道地址在 `{"msg":"started tunnel","url":"https://xxx.ngrok-free.app"}`
 * 这类事件里。优先匹配「started tunnel」，避免把日志里附带的 ngrok.com 官网/控制台链接当成隧道地址；
 * 顺便兼容 logfmt（`url=https://...`）输出。
 */
function parseNgrokUrl(output: string): string | null {
  const text = stripAnsi(output);
  let fallback: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const entry = JSON.parse(trimmed) as { msg?: unknown; url?: unknown };
      if (typeof entry.url !== "string" || !/^https?:\/\//.test(entry.url)) continue;
      if (isNgrokSiteUrl(entry.url)) continue;
      if (typeof entry.msg === "string" && /started tunnel/i.test(entry.msg)) {
        return normalizeBaseUrl(entry.url);
      }
      if (!fallback) fallback = normalizeBaseUrl(entry.url);
    } catch {
      // 尚未收全的日志行，等下一个 chunk
    }
  }
  if (fallback) return fallback;
  const logfmtMatch = text.match(/(?:^|\s)url=(https?:\/\/[^\s"]+)/);
  if (logfmtMatch?.[1] && !isNgrokSiteUrl(logfmtMatch[1])) {
    return normalizeBaseUrl(logfmtMatch[1]);
  }
  return null;
}

function formatOutput(output: string): string {
  const cleaned = stripAnsi(output).trim();
  if (!cleaned) return "";
  const tail = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-12)
    .join("\n");
  return tail.length > 1200 ? tail.slice(-1200) : tail;
}

function exitMessage(
  provider: TunnelProvider,
  code: number | null,
  signal: NodeJS.Signals | null,
  output: string,
): string {
  const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
  const hint = PROVIDER_CONFIG[provider].loginHint;
  const detail = formatOutput(output);
  return `${provider} exited (${reason}) before the tunnel was ready. ${hint}${detail ? `\n${detail}` : ""}`;
}

function buildAccessUrl(baseUrl: string, token: string | null): string {
  const url = new URL(baseUrl);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

// ── Module ───────────────────────────────────────────────────────────

export interface TunnelModule {
  /** 所有提供方的状态 + 本机安装情况。 */
  getProviderInfos: (options?: { refresh?: boolean }) => Promise<TunnelProviderInfo[]>;
  start: (options: {
    provider: TunnelProvider;
    port: number;
    token: string | null;
  }) => Promise<TunnelStatus>;
  /** 停止指定提供方的隧道。 */
  stop: (provider: TunnelProvider) => TunnelStatus;
  /** 停止所有隧道（WebUI 关闭 / 应用退出）。 */
  stopAll: () => void;
}

type ProviderRuntime = {
  status: TunnelStatus;
  child: ChildProcess | null;
  /** 每次 start / stop 都自增；过期进程的事件据此被忽略。 */
  runId: number;
  abortPending: (() => void) | null;
};

export function createTunnelModule(
  deps: { onChange?: (status: TunnelStatus) => void } = {},
): TunnelModule {
  const createRuntime = (provider: TunnelProvider): ProviderRuntime => ({
    status: { provider, state: "stopped", url: null, error: null },
    child: null,
    runId: 0,
    abortPending: null,
  });

  // 每个提供方各自一份运行态：devtunnel 与 ngrok 可以同时开启、互不影响。
  const runtimes: Record<TunnelProvider, ProviderRuntime> = {
    devtunnel: createRuntime("devtunnel"),
    ngrok: createRuntime("ngrok"),
  };

  function update(runtime: ProviderRuntime, patch: Partial<Omit<TunnelStatus, "provider">>) {
    runtime.status = { ...runtime.status, ...patch };
    deps.onChange?.(runtime.status);
  }

  function killChild(runtime: ProviderRuntime) {
    const proc = runtime.child;
    runtime.child = null;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    try {
      proc.kill("SIGTERM");
    } catch {
      // already gone
    }
    // 兜底定时器绑定到具体进程：紧接着 stop→start 时不会误清掉上一个进程的 SIGKILL 兜底。
    const timer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already gone
        }
      }
    }, KILL_GRACE_MS);
    timer.unref?.();
  }

  function stop(provider: TunnelProvider): TunnelStatus {
    const runtime = runtimes[provider];
    runtime.runId += 1;
    runtime.abortPending?.();
    runtime.abortPending = null;
    killChild(runtime);
    if (runtime.status.state !== "stopped" || runtime.status.url || runtime.status.error) {
      update(runtime, { state: "stopped", url: null, error: null });
    }
    return { ...runtime.status };
  }

  function stopAll() {
    for (const provider of PROVIDERS) stop(provider);
  }

  function launch(options: {
    runtime: ProviderRuntime;
    provider: TunnelProvider;
    binaryPath: string;
    port: number;
    run: number;
  }): Promise<string> {
    const { runtime, provider, binaryPath, port, run } = options;
    return new Promise((resolve, reject) => {
      let settled = false;
      let output = "";
      let timer: NodeJS.Timeout | null = null;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        runtime.abortPending = null;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        fn();
      };
      runtime.abortPending = () =>
        finish(() => reject(new Error("Tunnel start was cancelled.")));

      const config = PROVIDER_CONFIG[provider];

      let proc: ChildProcess;
      try {
        proc = spawn(binaryPath, config.args(port), {
          env: buildSpawnEnv(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        return;
      }
      runtime.child = proc;

      const onData = (chunk: Buffer) => {
        output = (output + chunk.toString("utf8")).slice(-OUTPUT_BUFFER_LIMIT);
        if (settled || run !== runtime.runId) return;
        const baseUrl = config.parseUrl(output, port);
        if (baseUrl) finish(() => resolve(baseUrl));
      };
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);

      proc.once("error", (err) => {
        if (runtime.child === proc) runtime.child = null;
        const detail = formatOutput(output);
        finish(() =>
          reject(
            new Error(
              `${provider} failed to start: ${extractErrorMessage(err)}${detail ? `\n${detail}` : ""}`,
            ),
          ),
        );
      });

      proc.once("exit", (code, signal) => {
        if (runtime.child === proc) runtime.child = null;
        if (run !== runtime.runId) return;
        const message = exitMessage(provider, code, signal, output);
        if (!settled) {
          finish(() => reject(new Error(message)));
          return;
        }
        // 只把「已经在运行」的进程退出视为错误；启动超时后我们主动 kill 的退出
        // 不应覆盖更准确的超时/失败信息（此时上层已把状态置为 error）。
        if (runtime.status.state === "running") {
          update(runtime, { state: "error", url: null, error: message });
        }
      });

      timer = setTimeout(() => {
        const detail = formatOutput(output);
        finish(() =>
          reject(
            new Error(
              `${provider} did not report a public URL in time.${detail ? `\n${detail}` : ""}`,
            ),
          ),
        );
        killChild(runtime);
      }, config.startTimeoutMs);
      timer.unref?.();
    });
  }

  async function getProviderInfos(options?: {
    refresh?: boolean;
  }): Promise<TunnelProviderInfo[]> {
    const paths = await detectProviderPaths(options?.refresh ?? false);
    return PROVIDERS.map((provider) => ({
      ...runtimes[provider].status,
      installed: Boolean(paths[provider]),
    }));
  }

  async function start(options: {
    provider: TunnelProvider;
    port: number;
    token: string | null;
  }): Promise<TunnelStatus> {
    const { provider, port, token } = options;
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error("WebUI is not running. Start the WebUI service before opening a tunnel.");
    }

    const runtime = runtimes[provider];
    if (runtime.status.state === "starting") {
      throw new Error(`${provider} tunnel is already starting.`);
    }
    if (runtime.status.state === "running") {
      return { ...runtime.status };
    }

    stop(provider);

    // 先同步把状态切到 starting：检测是异步的，否则双击 / 并发调用会同时通过上面的检查，
    // 各自 spawn 一个隧道进程，前一个就变成了无人回收的孤儿进程。
    const myRun = ++runtime.runId;
    update(runtime, { state: "starting", url: null, error: null });

    try {
      const paths = await detectProviderPaths(true);
      if (myRun !== runtime.runId) return { ...runtime.status };
      const binaryPath = paths[provider];
      if (!binaryPath) {
        throw new Error(
          `${provider} CLI was not found. Install it and make sure it is available on PATH.`,
        );
      }

      const baseUrl = await launch({ runtime, provider, binaryPath, port, run: myRun });
      if (myRun !== runtime.runId) return { ...runtime.status };
      update(runtime, { state: "running", url: buildAccessUrl(baseUrl, token), error: null });
      return { ...runtime.status };
    } catch (err) {
      if (myRun === runtime.runId) {
        update(runtime, { state: "error", url: null, error: extractErrorMessage(err) });
      }
      throw err;
    }
  }

  return {
    getProviderInfos,
    start,
    stop,
    stopAll,
  };
}
