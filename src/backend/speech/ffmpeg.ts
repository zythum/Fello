import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

/**
 * 系统 ffmpeg 的定位与调用。
 *
 * 音频文件转写不做任何解码器内置：直接用用户机器上的 ffmpeg 把任意音频文件
 * 转成语音识别需要的 **16kHz / mono / 16-bit little-endian PCM**。
 * 未安装时由 {@link ffmpegInstallHint} 给出安装指引，交由调用方（Agent）
 * 自行安装后重试。
 */

const FFMPEG_BIN = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

/** stderr 只用于报错提示，超过这个长度就不再累积，避免异常输出把内存撑爆。 */
const MAX_STDERR_BYTES = 8192;

/** PATH 之外再兜底几个常见安装目录（GUI 应用不一定继承完整的 shell PATH）。 */
function fallbackDirs(): string[] {
  switch (process.platform) {
    case "darwin":
      return ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"];
    case "win32": {
      // 环境变量缺失时不要拼出相对路径候选（会相对 cwd 去探测）。
      const dirs = ["C:\\ffmpeg\\bin"];
      if (process.env.ProgramFiles) dirs.unshift(join(process.env.ProgramFiles, "ffmpeg", "bin"));
      if (process.env.LOCALAPPDATA) {
        dirs.push(join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"));
      }
      return dirs;
    }
    default:
      return ["/usr/bin", "/usr/local/bin", "/snap/bin", "/var/lib/flatpak/exports/bin"];
  }
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    // Windows 没有可执行位概念，只看文件是否存在。
    await access(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** ffmpeg 缺失时的提示：包含各平台安装命令，供 Agent 直接执行后重试。 */
export function ffmpegInstallHint(): string {
  const howTo =
    process.platform === "darwin"
      ? "  macOS:   brew install ffmpeg"
      : process.platform === "win32"
        ? "  Windows: winget install --id Gyan.FFmpeg -e    (或 choco install ffmpeg)"
        : "  Linux:   sudo apt install ffmpeg    (或 sudo dnf install ffmpeg)";
  return [
    "未找到 ffmpeg，无法解码音频文件。",
    "请先安装 ffmpeg，然后重新调用本工具：",
    howTo,
    "也可以用 FFMPEG_PATH 环境变量指定 ffmpeg 可执行文件的绝对路径。",
  ].join("\n");
}

/** 显式指定的 ffmpeg 路径不可用时的提示（不会再退回自动探测）。 */
export function ffmpegPathUnusableHint(explicitPath: string): string {
  return [
    `指定的 ffmpeg 路径不可用：${explicitPath}`,
    "该文件不存在或没有执行权限。",
    "请传入正确的 ffmpegPath，或者不传该参数、由工具自动探测（FFMPEG_PATH 环境变量 → 系统 PATH → 常见安装目录）。",
  ].join("\n");
}

/**
 * 解析可用的 ffmpeg 可执行文件路径。
 *
 * `explicitPath`（工具参数）优先级最高，且一旦指定就**只认它**：路径不可用时返回 null
 * 并交由调用方给出针对性提示，而不是悄悄退回自动探测 —— 免得用户指了 A 却跑了 B。
 *
 * 不做缓存：安装动作可能发生在两次工具调用之间，缓存未命中的结果会让
 * “装完再试一次”永远失败。
 */
export async function resolveFfmpegPath(explicitPath?: string): Promise<string | null> {
  const explicit = explicitPath?.trim();
  if (explicit) {
    return (await isExecutable(explicit)) ? explicit : null;
  }

  const candidates: string[] = [];
  const envPath = process.env.FFMPEG_PATH?.trim();
  if (envPath) candidates.push(envPath);

  const dirs = [
    ...(envPath ? [dirname(envPath)] : []),
    ...(process.env.PATH ?? "").split(delimiter),
    ...fallbackDirs(),
  ];
  for (const dir of dirs) {
    if (dir) candidates.push(join(dir, FFMPEG_BIN));
  }

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

export interface DecodeAudioOptions {
  ffmpegPath: string;
  inputPath: string;
  /** 按到达顺序消费解码后的 PCM；await 期间会自然形成回压（不读下一块）。 */
  onChunk: (chunk: Buffer) => Promise<void> | void;
  /** 中止解码（超时等），会直接 kill ffmpeg。 */
  signal?: AbortSignal;
}

function decodeArgs(inputPath: string): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-f",
    "s16le",
    "-acodec",
    "pcm_s16le",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-",
  ];
}

/**
 * 用 ffmpeg 把音频文件解码为 16k/mono/s16le PCM，按流式分块交给 `onChunk`。
 *
 * 全程不落地中间文件：stdout 直读直喂，长音频的内存占用是一块 PCM 而不是整个文件。
 */
export async function decodeAudioToPcm16k(options: DecodeAudioOptions): Promise<void> {
  const { ffmpegPath, inputPath, onChunk, signal } = options;

  const child = spawn(ffmpegPath, decodeArgs(inputPath), {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < MAX_STDERR_BYTES) stderr += chunk;
  });

  const abort = () => child.kill("SIGKILL");
  // signal 可能在我们起进程之前就已 abort（例如 connect() 阶段就超时），
  // 这种情况 addEventListener 不会再触发，必须直接补一次 kill。
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, closeSignal) => resolve({ code, signal: closeSignal }));
    },
  );

  try {
    for await (const chunk of child.stdout) {
      await onChunk(chunk as Buffer);
    }
  } catch (error) {
    child.kill("SIGKILL");
    await exited.catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }

  const { code, signal: closeSignal } = await exited;
  if (code !== 0) {
    const detail = stderr.trim() || `进程被终止（${closeSignal ?? "unknown"}）`;
    throw new Error(`ffmpeg 解码音频失败：${detail}`);
  }
}
