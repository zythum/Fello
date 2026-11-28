import { execFile, spawn, type ChildProcess } from "child_process";
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

/**
 * 管理命令（list / delete）的单条调用超时。删除会发生在「关闭开关」与「退出应用」路径上，
 * 必须够快：超时就放弃（进程已被杀掉，隧道地址已经不可用），留给下次创建时的兜底处理。
 */
const CLEANUP_TIMEOUT_MS = 2_500;

/** 创建被账号隧道配额挡住时，最多「删一条遗留隧道 + 重试」的次数。 */
const QUOTA_RETRY_LIMIT = 2;

/**
 * devtunnel 每次 `host` 都会隐式创建一条临时隧道，而进程被 SIGTERM / SIGKILL 结束时
 * CLI 不会把它删掉，它会一直占用「每用户 10 条」的配额。打上标签后 Fello 才能在停止 /
 * 退出时认出并删除「自己创建的那一条」，配额被占满时也知道该清理谁。
 */
const DEV_TUNNEL_LABEL = "fello";

/**
 * 隧道描述。CLI 不提供 owner / createdAt 这类元数据，标签和描述是 Fello 唯一能留下的
 * 「自证」记号；清理时两者必须同时匹配，尽量避免误删别的工具碰巧打了同名标签的隧道。
 */
const DEV_TUNNEL_DESCRIPTION = "Fello WebUI";

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
  /** 输出命中登录 / 鉴权失败特征时附加的提示。 */
  loginHint: string;
  /** 输出命中限流 / 配额特征时附加的提示。 */
  rateLimitHint: string;
  /** provider 特有的失败特征 → 追加提示（在通用的鉴权 / 限流判断之外）。 */
  failureHints?: { pattern: RegExp; hint: string }[];
  /** 从 host 输出里解析本次创建的隧道 ID（停止时用来定点删除）。 */
  parseTunnelId?: (output: string) => string | null;
  /** 停止时删除本次创建的隧道：只删自己建的，不影响同账号下的其它隧道。 */
  releaseTunnel?: (options: { binaryPath: string; tunnelId: string }) => Promise<void>;
  /** 创建被配额挡住时，释放一条本应用遗留的旧隧道；返回是否真的释放了。 */
  freeQuota?: (binaryPath: string) => Promise<boolean>;
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
    // 带上标签与描述：停止 / 退出时靠它定点删除自己创建的隧道，用户在 `devtunnel list` 里也能认出来。
    args: (port) => [
      "host",
      "-p",
      String(port),
      "--allow-anonymous",
      "-l",
      DEV_TUNNEL_LABEL,
      "-d",
      DEV_TUNNEL_DESCRIPTION,
    ],
    parseUrl: parseDevtunnelUrl,
    loginHint: "Make sure you are logged in: run `devtunnel user login`.",
    rateLimitHint:
      "Dev Tunnels is throttling this account (rate limit or the 10-tunnels-per-user quota). Fello already tried releasing one of its own leftover tunnels — if it still fails, review `devtunnel list` for other leftover tunnels, remove the unused ones with `devtunnel delete <id>`, and retry in about a minute.",
    parseTunnelId: parseDevtunnelTunnelId,
    releaseTunnel: ({ binaryPath, tunnelId }) => deleteDevtunnel(binaryPath, tunnelId),
    freeQuota: deleteOldestIdleDevtunnel,
  },
  ngrok: {
    command: "ngrok",
    startTimeoutMs: 45_000,
    args: (port) => ["http", "--log=stdout", "--log-format=json", `http://127.0.0.1:${port}`],
    parseUrl: parseNgrokUrl,
    loginHint: "Make sure ngrok is authenticated: run `ngrok config add-authtoken <token>`.",
    rateLimitHint: "The tunnel provider is throttling this account. Wait about a minute and retry.",
    failureHints: [
      {
        // 免费版的静态域名绑定在同一条 endpoint 上：另一个 ngrok 进程或另一个 Fello
        // 实例还在宿主时，新会话会直接失败（新版 ERR_NGROK_334 / 旧版 ERR_NGROK_108）。
        pattern:
          /ERR_NGROK_(?:334|108)\b|endpoint .*already online|simultaneous (?:agent )?sessions?/i,
        hint: "That ngrok endpoint is already online in another session. Stop the other ngrok process (or quit the other Fello instance) and retry: the free plan allows only one session per endpoint.",
      },
    ],
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

// ── Devtunnel cleanup ────────────────────────────────────────────────

/** 跑一条一次性的 CLI 命令（用于 list / delete 这类管理命令，而不是长期宿主进程）。 */
function runCli(binaryPath: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      args,
      { env: buildSpawnEnv(), timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

/**
 * `devtunnel host` 打印的隧道 ID 行：
 *   Ready to accept connections for tunnel: <tunnel-id>
 * 拿到 ID 之后，停止隧道时才能「只删这一条」，不影响同账号下的其它隧道。
 */
function parseDevtunnelTunnelId(output: string): string | null {
  const match = stripAnsi(output).match(/Ready to accept connections for tunnel:\s*([\w.-]+)/i);
  return match?.[1] ?? null;
}

type IdleFelloTunnel = {
  tunnelId: string;
  /** 剩余有效期（毫秒）：越小说明创建得越早，用于挑「最早的一条」。 */
  remainingMs: number;
};

/** 把 `tunnelExpiration`（`30 days` / `29.6 days` / `2 hours`）解析成剩余毫秒数。 */
function parseRemainingMs(value: unknown): number {
  if (typeof value !== "string") return Number.POSITIVE_INFINITY;
  const match = value.match(/([\d.]+)\s*(day|hour|minute|second)/i);
  if (!match) return Number.POSITIVE_INFINITY;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return Number.POSITIVE_INFINITY;
  const unit = match[2].toLowerCase();
  const scale =
    unit === "day" ? 86_400_000 : unit === "hour" ? 3_600_000 : unit === "minute" ? 60_000 : 1_000;
  return amount * scale;
}

/**
 * 列出「Fello 自己创建、且当前没有宿主连接」的隧道。
 *
 * CLI 没有 owner / createdAt 元数据，标签 + 描述是 Fello 唯一能留下的归属记号，
 * 所以两者必须同时匹配才认领；`hostConnections !== 0` 的一律排除，避免打断正在使用的隧道。
 */
async function listIdleFelloTunnels(binaryPath: string): Promise<IdleFelloTunnel[]> {
  let stdout: string;
  try {
    stdout = await runCli(binaryPath, ["list", "-l", DEV_TUNNEL_LABEL, "-j"], CLEANUP_TIMEOUT_MS);
  } catch {
    return []; // 未登录 / 超时：交给 start 的失败提示，清理不额外报错
  }

  const start = stdout.indexOf("{");
  if (start < 0) return [];

  let tunnels: unknown[];
  try {
    const parsed: unknown = JSON.parse(stdout.slice(start));
    const listed =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { tunnels?: unknown }).tunnels
        : undefined;
    tunnels = Array.isArray(listed) ? listed : [];
  } catch {
    return [];
  }

  const idle: IdleFelloTunnel[] = [];
  for (const entry of tunnels) {
    if (typeof entry !== "object" || entry === null) continue;
    const { tunnelId, hostConnections, labels, description, tunnelExpiration } = entry as {
      tunnelId?: unknown;
      hostConnections?: unknown;
      labels?: unknown;
      description?: unknown;
      tunnelExpiration?: unknown;
    };
    const isFelloTunnel =
      Array.isArray(labels) &&
      labels.includes(DEV_TUNNEL_LABEL) &&
      description === DEV_TUNNEL_DESCRIPTION;
    if (typeof tunnelId === "string" && hostConnections === 0 && isFelloTunnel) {
      idle.push({ tunnelId, remainingMs: parseRemainingMs(tunnelExpiration) });
    }
  }
  return idle;
}

/** 删除指定隧道（管理操作）。只删这一条，不影响其它隧道。 */
async function deleteDevtunnel(binaryPath: string, tunnelId: string): Promise<void> {
  await runCli(binaryPath, ["delete", tunnelId], CLEANUP_TIMEOUT_MS);
}

/**
 * 创建被账号隧道配额挡住时调用：删掉一条最早的 Fello 遗留隧道，腾出一个名额。
 *
 * 返回是否真的删掉了。没有可删的遗留隧道时返回 false，让上层把原始的配额错误抛给用户，
 * 避免「删了别人的/正在用的隧道」这种副作用。
 */
async function deleteOldestIdleDevtunnel(binaryPath: string): Promise<boolean> {
  const idle = await listIdleFelloTunnels(binaryPath);
  if (idle.length === 0) return false;
  // 取剩余有效期最小的一条；相同时保留 list 里的先后顺序（list 顺序与创建时间无关，只是兜底）。
  const oldest = idle.reduce((a, b) => (b.remainingMs < a.remainingMs ? b : a));
  await deleteDevtunnel(binaryPath, oldest.tunnelId);
  return true;
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

/**
 * 只有输出真的像「没登录 / 鉴权失败」时才提示去登录：以前不管什么原因都拼上
 * `devtunnel user login`，把限流、配额之类的真实原因盖住了，反而误导用户。
 */
const AUTH_FAILURE_PATTERN =
  /\blog ?in\b|\bsign in\b|authenticat|\bunauthori[sz]ed\b|\bforbidden\b|access denied|\b40[13]\b|token (?:is )?(?:invalid|expired)/i;

/**
 * 限流 / 配额上限：输出里通常只给一句「Rate limit exceeded」，需要额外给出排查方向。
 * 不匹配裸的 `429`：ngrok 的 JSON 日志里有 `"dur":429` 这类耗时字段，会误判成限流。
 */
const RATE_LIMIT_PATTERN =
  /rate limit|too many requests|too many connections|\bquota\b|429 too many requests/i;

function failureHints(provider: TunnelProvider, output: string): string {
  const config = PROVIDER_CONFIG[provider];
  const hints: string[] = [];
  if (RATE_LIMIT_PATTERN.test(output)) hints.push(config.rateLimitHint);
  if (AUTH_FAILURE_PATTERN.test(output)) hints.push(config.loginHint);
  for (const extra of config.failureHints ?? []) {
    if (extra.pattern.test(output)) hints.push(extra.hint);
  }
  return hints.join(" ");
}

function exitMessage(
  provider: TunnelProvider,
  code: number | null,
  signal: NodeJS.Signals | null,
  output: string,
): string {
  const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
  const hints = failureHints(provider, output);
  const detail = formatOutput(output);
  return `${provider} exited (${reason}) before the tunnel was ready.${hints ? ` ${hints}` : ""}${detail ? `\n${detail}` : ""}`;
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
  /** 停止指定提供方的隧道，并尽力删除本次创建的隧道。 */
  stop: (provider: TunnelProvider) => Promise<TunnelStatus>;
  /** 停止所有隧道（WebUI 关闭 / 应用退出）。 */
  stopAll: () => Promise<void>;
}

type ProviderRuntime = {
  status: TunnelStatus;
  child: ChildProcess | null;
  /** 每次 start / stop 都自增；过期进程的事件据此被忽略。 */
  runId: number;
  abortPending: (() => void) | null;
  /** 本次启动创建的隧道 ID 与其 CLI 路径：停止时用来定点删除，不影响其它隧道。 */
  tunnelId: string | null;
  binaryPath: string | null;
};

export function createTunnelModule(
  deps: { onChange?: (status: TunnelStatus) => void } = {},
): TunnelModule {
  const createRuntime = (provider: TunnelProvider): ProviderRuntime => ({
    status: { provider, state: "stopped", url: null, error: null },
    child: null,
    runId: 0,
    abortPending: null,
    tunnelId: null,
    binaryPath: null,
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

  /**
   * 停止隧道。
   *
   * 状态立刻切到 stopped（设置页开关马上回位），随后尽力删除「本次创建的那一条」隧道：
   * 只删自己建的，不影响同账号下的其它隧道。删除失败（断网 / 超时 / 已被清理）不影响
   * 停止结果，下次创建遇到配额限制时还有 freeQuota 兜底。
   */
  async function stop(provider: TunnelProvider): Promise<TunnelStatus> {
    const runtime = runtimes[provider];
    runtime.runId += 1;
    runtime.abortPending?.();
    runtime.abortPending = null;
    killChild(runtime);

    const { tunnelId, binaryPath } = runtime;
    runtime.tunnelId = null;
    runtime.binaryPath = null;
    if (runtime.status.state !== "stopped" || runtime.status.url || runtime.status.error) {
      update(runtime, { state: "stopped", url: null, error: null });
    }
    // 删除期间用户可能已经重新打开隧道：返回值固定为「本次停止后」的状态，不要回传新状态。
    const result = { ...runtime.status };

    const release = PROVIDER_CONFIG[provider].releaseTunnel;
    if (release && tunnelId && binaryPath) {
      await release({ binaryPath, tunnelId }).catch(() => {
        // 尽力而为：应用退出、断网、隧道已过期都会失败，交给下次创建的兜底逻辑
      });
    }
    return result;
  }

  async function stopAll() {
    await Promise.all(PROVIDERS.map((provider) => stop(provider)));
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
      runtime.abortPending = () => finish(() => reject(new Error("Tunnel start was cancelled.")));

      const config = PROVIDER_CONFIG[provider];

      // 每次启动都重新落一份路径与 ID：停止时只删本次创建的隧道。
      runtime.binaryPath = binaryPath;
      runtime.tunnelId = null;

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
        if (run !== runtime.runId) return;

        // 隧道 ID 出现在公网地址之后（`Ready to accept connections for tunnel: <id>`），
        // 所以 settled 之后仍要继续解析：停止时靠它「只删这一条」。
        const tunnelId = config.parseTunnelId?.(output);
        if (tunnelId) runtime.tunnelId = tunnelId;

        if (settled) return;
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

  /**
   * 启动隧道；创建被账号配额挡住时（Dev Tunnels 每账号 10 条隧道），先删掉一条最早的
   * Fello 遗留隧道再重试，而不是让用户自己去清理。
   *
   * 只在「确实有 Fello 遗留隧道可删」时才重试：没有可删的遗留隧道，或失败原因是未登录 /
   * 纯限流，就把原始错误抛出去，避免无意义地删除资源。
   */
  async function launchWithQuotaRetry(options: {
    runtime: ProviderRuntime;
    provider: TunnelProvider;
    binaryPath: string;
    port: number;
    run: number;
  }): Promise<string> {
    const { runtime, binaryPath, run } = options;
    const freeQuota = PROVIDER_CONFIG[options.provider].freeQuota;

    for (let attempt = 0; ; attempt++) {
      try {
        return await launch(options);
      } catch (err) {
        const quotaBlocked =
          freeQuota !== undefined &&
          attempt < QUOTA_RETRY_LIMIT &&
          RATE_LIMIT_PATTERN.test(extractErrorMessage(err));
        if (!quotaBlocked) throw err;

        // 重试间隙用户可能已经关掉了开关：runId 变了就不再创建新隧道。
        if (run !== runtime.runId) throw new Error("Tunnel start was cancelled.");
        const freed = await freeQuota(binaryPath).catch(() => false);
        if (run !== runtime.runId) throw new Error("Tunnel start was cancelled.");
        if (!freed) throw err;
      }
    }
  }

  async function getProviderInfos(options?: { refresh?: boolean }): Promise<TunnelProviderInfo[]> {
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

    // stop 可能会等一次隧道删除（最长 CLEANUP_TIMEOUT_MS）。这期间用户若又关掉了开关，
    // runId 会被外部 stop 再自增一次：此时必须放弃启动，不能把隧道重新拉起来。
    const runIdBeforeStop = runtime.runId;
    await stop(provider);
    if (runtime.runId !== runIdBeforeStop + 1) return { ...runtime.status };

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

      const baseUrl = await launchWithQuotaRetry({
        runtime,
        provider,
        binaryPath,
        port,
        run: myRun,
      });
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
