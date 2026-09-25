import { Buffer } from "node:buffer";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createTTSClient } from "unified-realtime-asr";
import { buildTtsConfig, getActiveTtsProvider } from "./tts-config";
import { errorMessage } from "./util";
import { encodePcmToMp3, ffmpegInstallHint, resolveFfmpegPath } from "./ffmpeg";
import type { BackendContext } from "../types";

/**
 * 文字转语音：provider 实时合成 → 内存里的 PCM → 落地成一个音频文件。
 *
 * 与朗读（`tts-manager.ts`）共用同一份 provider 配置与同一套 PCM 输出，区别只在
 * 音频的去向：那边经 `tts-audio` 推给渲染层流式播放，这边攒齐写盘，供 Agent
 * 把音频分享给用户（`share_to_user` 的 `project` / `link` 类型）。
 *
 * 容器由我们决定（provider 只给裸 PCM）：
 * - `wav`：自己拼 RIFF 头，零外部依赖；
 * - `mp3`：交给系统 ffmpeg 编码，未安装时给出安装指引。
 */

/** 单次合成的文本长度上限（字符）。超长整段灌进实时通道会顶到 provider 的单轮上限。 */
const MAX_TEXT_LENGTH = 10000;

/** provider 未回传采样率时的兜底值：四个适配器的默认输出都是 24kHz。 */
const FALLBACK_SAMPLE_RATE = 24000;
const FALLBACK_CHANNELS = 1;

const DEFAULT_TIMEOUT_SECONDS = 600;

export type SpeechAudioFormat = "wav" | "mp3";

export interface SynthesizeSpeechOptions {
  /** 待合成文本。 */
  text: string;
  /** 输出文件绝对路径（调用方已按项目目录解析）。 */
  output: string;
  format: SpeechAudioFormat;
  timeoutSeconds?: number;
}

export interface SynthesizeSpeechOutcome {
  output: string;
  format: SpeechAudioFormat;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  bytes: number;
}

/** 给裸 PCM 套一个 44 字节的 RIFF/WAVE 头（16-bit little-endian、交织声道）。 */
function encodeWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt 块长度
  header.writeUInt16LE(1, 20); // 编码方式：1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** 解析 ffmpeg；不可用时直接抛出安装指引（与音频转写同一套话术）。 */
async function requireFfmpegPath(): Promise<string> {
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) throw new Error(ffmpegInstallHint());
  return ffmpegPath;
}

export async function synthesizeSpeechToFile(
  ctx: BackendContext,
  options: SynthesizeSpeechOptions,
): Promise<SynthesizeSpeechOutcome> {
  const text = options.text.trim();
  if (!text) throw new Error("待合成的文本为空。");
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `待合成文本过长（${text.length} 字，上限 ${MAX_TEXT_LENGTH} 字）：请拆成几段分别合成。`,
    );
  }
  // provider（DashScope）对「没有任何可朗读字符」的输入直接拒收：
  // `InvalidParameter: Please ensure input text is valid.`（实测 `：` / `.` / `—` /
  // 单空格 / `--- ---` 均被拒）。这条链路是 Agent 直接给文本、不经过朗读链路的分句器，
  // 所以在这里按同一口径拦掉——否则只会白花一次调用再收一个 provider 报错。
  // 判定与 `mainview/lib/tts/tts-text.ts` 的 `SPEAKABLE_RE` 一致（那边是每句一判）。
  if (!/[\p{L}\p{N}]/u.test(text)) {
    throw new Error("待合成的文本没有可朗读内容（全是符号 / 空白 / emoji）。");
  }

  // 只有 mp3 需要 ffmpeg：wav 全程不碰外部命令，机器上没有 ffmpeg 也不该影响它。
  const ffmpegPath = options.format === "mp3" ? await requireFfmpegPath() : null;

  // 先把落盘路径准备好：合成一次是有成本的（额度 / 时长），不该在合成完之后
  // 才发现目录不存在，白花一次调用。
  await mkdir(dirname(options.output), { recursive: true });

  // 未启用 provider / 缺凭据在这里就抛错（带「去设置里配置」的指引）。
  const client = createTTSClient(buildTtsConfig(getActiveTtsProvider(ctx)));

  const chunks: Buffer[] = [];
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let lastError: string | null = null;
  client.on("audio", (chunk) => {
    chunks.push(Buffer.from(chunk.audio));
    sampleRate ??= chunk.sampleRate;
    channels ??= chunk.channels;
  });
  // provider 侧的报错（额度、音色未授权、文本不合法）走事件，比 connect/flush 抛出的更具体。
  client.on("error", (error) => {
    lastError = errorMessage(error);
  });

  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  let timer: NodeJS.Timeout | undefined;

  try {
    await client.connect();
    // 整段一次性交给 provider（不做分句：这里要的是一个完整文件，不是低延迟出声）。
    // `flush()` resolve 即「本轮音频已全部经 audio 事件发出」，攒完再落盘。
    await Promise.race([
      (async () => {
        client.sendText(text);
        await client.flush();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`语音合成超时（超过 ${timeoutSeconds} 秒）。`)),
          timeoutSeconds * 1000,
        );
      }),
    ]);
  } catch (error) {
    if (lastError) throw new Error(lastError);
    throw error;
  } finally {
    clearTimeout(timer);
    client.removeAllListeners();
    // 超时 / 出错时连接可能还开着，关掉避免泄漏（失败已上报过，不再重复报）。
    await client.close().catch(() => {});
  }

  const pcm = Buffer.concat(chunks);
  if (pcm.length === 0) {
    throw new Error(lastError ?? "语音合成没有返回任何音频数据。");
  }
  const rate = sampleRate || FALLBACK_SAMPLE_RATE;
  const channelCount = channels || FALLBACK_CHANNELS;

  if (ffmpegPath) {
    await encodePcmToMp3({
      ffmpegPath,
      pcm,
      sampleRate: rate,
      channels: channelCount,
      outputPath: options.output,
    });
  } else {
    await writeFile(options.output, encodeWav(pcm, rate, channelCount));
  }

  const { size } = await stat(options.output);
  return {
    output: options.output,
    format: options.format,
    sampleRate: rate,
    channels: channelCount,
    durationSeconds: Math.round((pcm.length / (rate * channelCount * 2)) * 10) / 10,
    bytes: size,
  };
}
