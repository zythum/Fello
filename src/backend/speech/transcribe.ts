import { stat } from "node:fs/promises";
import { createASRClient, type Transcript } from "unified-realtime-asr";
import { buildAsrConfig, getActiveAsrProvider } from "./asr-config";
import { errorMessage } from "./util";
import {
  decodeAudioToPcm16k,
  ffmpegInstallHint,
  ffmpegPathUnusableHint,
  resolveFfmpegPath,
} from "./ffmpeg";
import type { BackendContext } from "../types";

/**
 * 音频文件转文字：ffmpeg 解码 → `unified-realtime-asr` 实时通道 → 文本。
 *
 * `unified-realtime-asr` 只有实时接口（没有批量/文件 API），所以这里把解码后的
 * PCM 按帧喂进实时客户端，收集 `isFinal` 的句子拼接成全文。语义与实时语音输入
 * 完全一致：同一份 provider 配置、同一套 16k/mono 上行格式。
 */

/** 单帧 20ms @16k/mono/s16le，与渲染层麦克风采集粒度一致。 */
const FEED_FRAME_BYTES = 320 * 2;
const FEED_FRAME_MS = 20;

/**
 * 喂入速率上限（相对实时）。
 *
 * `sendAudio()` 内部直接 `ws.send()`，没有回压接口；不限速会让整个文件瞬间堆进
 * 发送缓冲，长音频会把内存吃光。限速到 20× 实时：几分钟的语音备忘录秒级返回，
 * 一小时的录音也只需约 3 分钟，同时约束住缓冲增长。
 */
const FEED_SPEED = 20;

/**
 * 音频发完后的静默等待。
 *
 * 多数 provider 的 `close()` 会等服务端回传最终结果，但 OpenAI 的 `closeImpl()`
 * 是立刻断连的，最后一句只可能在此之前定稿；这里统一留一小段静默让服务端收尾。
 */
const FLUSH_WAIT_MS = 1500;

const DEFAULT_TIMEOUT_SECONDS = 600;

export interface TranscribeAudioOptions {
  /** 音频文件路径（绝对路径，或已按项目目录解析过的路径）。 */
  path: string;
  /** 覆盖 provider 上配置的识别语言（BCP-47）。 */
  language?: string;
  /**
   * 显式指定 ffmpeg 可执行文件路径（自定义安装位置、不在 PATH 里时使用）。
   * 指定后不再自动探测，路径不可用会直接报错。
   */
  ffmpegPath?: string;
  timeoutSeconds?: number;
}

export interface TranscribeAudioOutcome {
  text: string;
  durationSeconds: number;
  segments: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `Transcript.index` 缺失时的本地兜底序号起点。
 *
 * provider 的真实句序号从 1 开始且量级很小；拉开量级可以避免「同一会话里有的句子
 * 带 index、有的不带」时两种 key 相撞，导致已收集的整句被覆盖丢失。
 */
const LOCAL_INDEX_BASE = 1_000_000;

/** 按句序号拼接 final 片段：ASR 的 final 是连续的流式分段，直接相连即可。 */
function joinFinals(finals: Map<number, string>): string {
  return [...finals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, text]) => text)
    .join("");
}

export async function transcribeAudioFile(
  ctx: BackendContext,
  options: TranscribeAudioOptions,
): Promise<TranscribeAudioOutcome> {
  const provider = getActiveAsrProvider(ctx);

  await stat(options.path).catch(() => {
    throw new Error(`音频文件不存在：${options.path}`);
  });

  const explicitFfmpegPath = options.ffmpegPath?.trim();
  const ffmpegPath = await resolveFfmpegPath(explicitFfmpegPath);
  if (!ffmpegPath) {
    throw new Error(
      explicitFfmpegPath ? ffmpegPathUnusableHint(explicitFfmpegPath) : ffmpegInstallHint(),
    );
  }

  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const timeoutError = () => new Error(`音频文件转写超时（超过 ${timeoutSeconds} 秒）。`);
  const client = createASRClient(buildAsrConfig(provider, { language: options.language }));

  const finals = new Map<number, string>();
  let seq = 0;
  let lastError: string | null = null;
  client.on("transcript", (transcript: Transcript) => {
    if (!transcript.isFinal) return;
    finals.set(transcript.index ?? LOCAL_INDEX_BASE + ++seq, transcript.text);
  });
  client.on("error", (error) => {
    lastError = errorMessage(error);
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  let fedBytes = 0;
  let pending: Buffer = Buffer.alloc(0);
  let closed = false;
  let startedAt = 0;
  let fedMs = 0;

  const sendFrame = (frame: Buffer): void => {
    if (controller.signal.aborted) return;
    try {
      client.sendAudio(frame);
    } catch (error) {
      throw new Error(`语音识别连接已断开：${errorMessage(error)}`);
    }
    fedBytes += frame.length;
  };

  /**
   * 把缓冲切成 20ms 的帧喂给客户端，并按 {@link FEED_SPEED} 限速。
   *
   * 等待的这段时间不读 stdout，ffmpeg 会被管道反压住，因此内存占用与文件时长无关。
   */
  const feed = async (chunk: Buffer): Promise<void> => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    while (pending.length >= FEED_FRAME_BYTES) {
      if (controller.signal.aborted) return;
      const frame = pending.subarray(0, FEED_FRAME_BYTES);
      pending = pending.subarray(FEED_FRAME_BYTES);
      sendFrame(frame);
      fedMs += FEED_FRAME_MS;
      const wait = startedAt + fedMs / FEED_SPEED - Date.now();
      if (wait > 1) await sleep(wait);
    }
  };

  try {
    await client.connect();
    startedAt = Date.now();

    try {
      await decodeAudioToPcm16k({
        ffmpegPath,
        inputPath: options.path,
        signal: controller.signal,
        onChunk: feed,
      });
    } catch (error) {
      // 超时会 kill ffmpeg，表现出来是「解码失败」；还原成超时错误，避免误导。
      if (controller.signal.aborted) throw timeoutError();
      throw error;
    }

    if (controller.signal.aborted) throw timeoutError();

    // 不足一帧的尾巴直接补发，不要丢掉。
    if (pending.length > 0) sendFrame(pending);

    await sleep(FLUSH_WAIT_MS);
    await client.close();
    closed = true;

    if (finals.size === 0 && lastError) throw new Error(lastError);

    return {
      text: joinFinals(finals),
      durationSeconds: Math.round((fedBytes / 2 / 16000) * 10) / 10,
      segments: finals.size,
    };
  } finally {
    clearTimeout(timer);
    client.removeAllListeners();
    if (!closed) await client.close().catch(() => {});
  }
}
