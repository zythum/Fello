/**
 * ATVV 语音通道：把遥控器的语音链路包装成「按住 → 麦克风打开 → ADPCM → 16k PCM」。
 *
 * 这一段从 xiaomi-remote-control 的 `index.html` 语音状态机移植而来，但把 renderer 侧的
 * 状态与写入全部搬到主进程，并去掉了 WAV / ASR 职责：本通道**只输出 PCM**，
 * 转写由 Fello 既有的 speech/manager.ts 负责。
 *
 * 与来源一致的关键约束：
 * - 可选的 ATVV `INITIALIZE` 命令失败**不能**覆盖已经建立的连接状态；
 * - `MIC_CLOSE` 之后要给遥控器时间发出 `AUDIO_STOP` 与最后一个通知，不能立刻收尾；
 * - 半连接（未订阅完成）时写入必须被拒绝，而不是静默丢包。
 *
 * 比来源更强的部分：按住/松手是**跨进程**的（按键在渲染层、写入在主进程），
 * 因此这里显式处理「打开命令还在路上就松手」的竞态：`stopCapture()` 会等打开流程走完，
 * 并复用同一个关闭流程，不会出现「麦克风打开后没人关」的悬挂状态。
 */

import { ATVV_COMMAND, ATVV_CONTROL_OPCODE } from "./xiaomi-rc003/atvv-protocol";
import { ImaAdpcmDecoder } from "./xiaomi-rc003/adpcm";
import { createAtvvSession } from "./atvv-session";

/** MIC_CLOSE 之后等待遥控器发出 AUDIO_STOP 与最后一个通知的时间。 */
const AUDIO_FLUSH_TIMEOUT_MS = 800;

export interface AtvvVoiceStatus {
  state: string;
  message: string;
}

export interface AtvvVoiceChannelOptions {
  getManager: () => Promise<unknown>;
  onStatus: (status: AtvvVoiceStatus) => void;
  /**
   * 已解码的 16k/16-bit/mono PCM。
   *
   * `captureId` 标识这一帧属于哪一次「按住」：渲染层据此丢弃上一次采集在
   * 收尾 flush 期间迟到的帧，避免它们被误算到新的语音会话上。
   */
  onAudio: (pcm: Uint8Array, captureId: number) => void;
  onAudioState: (state: "started" | "stopped", captureId: number, reason?: string) => void;
}

export interface AtvvVoiceChannel {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** @returns 本次采集的 captureId（随每一帧音频一起上报）。 */
  startCapture: () => Promise<number>;
  stopCapture: () => Promise<void>;
  isReady: () => boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 解析 Control 0x0B 能力响应（布局与 xiaomi 台架一致）：
 *   byte0 = opcode, byte1..2 = version, byte3(≥0x0100)/byte4 = codec 位掩码,
 *   byte5..6 = frame size
 * codec 0x02 → 16 kHz，否则 8 kHz。
 */
function parseCapabilities(
  value: number[],
): { codec: number; sampleRate: number; frameSize: number } | null {
  if (value.length < 7) return null;
  const version = (value[1] << 8) | value[2];
  const codecs = version >= 0x0100 ? value[3] : value[4];
  const frameSize = (value[5] << 8) | value[6];
  const codec = codecs & 0x02 ? 0x02 : 0x01;
  return {
    codec,
    sampleRate: codec === 0x02 ? 16000 : 8000,
    frameSize: frameSize || 120,
  };
}

export function createAtvvVoiceChannel({
  getManager,
  onStatus,
  onAudio,
  onAudioState,
}: AtvvVoiceChannelOptions): AtvvVoiceChannel {
  const controlListeners = new Set<(bytes: number[]) => void>();
  const audioListeners = new Set<(bytes: number[]) => void>();

  const session = createAtvvSession({
    getManager: () => getManager() as never,
    notifyStatus: onStatus,
    controlListeners,
    audioListeners,
  });

  let decoder: ImaAdpcmDecoder | null = null;
  let capturing = false;
  let captureFinalized = false;
  let openSent = false;
  /** 打开命令的 in-flight promise；用于串行化「打开 → 关闭」。 */
  let openPromise: Promise<void> | null = null;
  /** 关闭流程的 in-flight promise；stopCapture 复用它，避免重复关闭。 */
  let closePromise: Promise<void> | null = null;
  /** 打开期间就已经被要求关闭。 */
  let closeRequested = false;
  /**
   * 采集序号：每次 `startCapture` 递增，用来给音频帧打标。
   *
   * 收尾 flush 期间的帧仍然属于**正在关闭的那一次采集**（`activeCaptureId` 到
   * `finalizeCapture` 才清零），所以它们是「上一次」的帧，不会污染下一次录音。
   */
  let captureCounter = 0;
  let activeCaptureId = 0;

  /**
   * 开始一次采集。
   *
   * **captureId 在这里分配**，而不是在 `startCapture` 里 —— 因为遥控器可能在我们
   * 还没按下语音键时就先自发上报音频（`AUDIO_START` / 游离的 Audio 通知）。
   * 那种情况下如果不分配 id，就会出现「capturing = true 但 activeCaptureId = 0」，
   * 之后每次 `startCapture()` 都会返回 0，音频帧因为不匹配而被全部丢弃。
   */
  function beginCapture(reason: string): number {
    if (!capturing) {
      capturing = true;
      captureFinalized = false;
      decoder = new ImaAdpcmDecoder();
      if (activeCaptureId === 0) {
        captureCounter += 1;
        activeCaptureId = captureCounter;
      }
      onAudioState("started", activeCaptureId, reason);
    }
    return activeCaptureId;
  }

  function finalizeCapture(reason: string) {
    if (captureFinalized) return;
    captureFinalized = true;
    capturing = false;
    decoder = null;
    const captureId = activeCaptureId;
    // 采集结束：之后的迟到帧不再属于任何一次采集。
    activeCaptureId = 0;
    onAudioState("stopped", captureId, reason);
  }

  const handleControl = (value: number[]) => {
    const opcode = value[0];
    if (opcode === ATVV_CONTROL_OPCODE.CAPABILITIES) {
      // 解析 codec / 采样率：遥控器的能力响应决定它实际发的是 8k 还是 16k ADPCM。
      // 若它与 ASR 侧固定的 16 kHz 不一致，识别结果会是空或乱码，
      // 所以把结论直接显示在状态里，省得靠猜。
      const capability = parseCapabilities(value);
      onStatus({
        state: "capabilities",
        message: capability
          ? `ATVV 能力：codec 0x${capability.codec.toString(16)} / ${capability.sampleRate} Hz / frame ${capability.frameSize} bytes`
          : `ATVV 能力响应：${value.length} bytes（长度不足，无法解析）`,
      });
      return;
    }
    if (opcode === ATVV_CONTROL_OPCODE.VOICE_REQUEST) {
      // 遥控器侧的语音请求：按住期间的 PTT 仍由键盘事件驱动，这里只做状态提示，
      // 不重复打开麦克风。
      onStatus({ state: "voice-request", message: "遥控器请求语音（Control 0x08）" });
      return;
    }
    if (opcode === ATVV_CONTROL_OPCODE.AUDIO_START) {
      session.setSessionId(value.length >= 4 ? value[3] : 0);
      beginCapture("AUDIO_START");
      return;
    }
    if (opcode === ATVV_CONTROL_OPCODE.AUDIO_STOP) {
      session.setSessionId(0);
      finalizeCapture("AUDIO_STOP");
    }
  };

  const handleAudio = (value: number[]) => {
    if (!decoder) beginCapture("Audio notification");
    if (!decoder) return;
    const pcm = decoder.decode(Uint8Array.from(value));
    onAudio(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength).slice(), activeCaptureId);
  };

  controlListeners.add(handleControl);
  audioListeners.add(handleAudio);

  async function connect(): Promise<void> {
    const info = await session.connect();
    onStatus({ state: "connected", message: `已连接：${info.name}` });
    try {
      // 可选初始化命令：失败只上报，不影响已经建立的连接。
      await session.write(ATVV_COMMAND.INITIALIZE);
    } catch (error) {
      onStatus({
        state: "notice",
        message: `ATVV 初始化命令失败，连接仍可用：${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  async function disconnect(): Promise<void> {
    capturing = false;
    decoder = null;
    openSent = false;
    closeRequested = false;
    closePromise = null;
    activeCaptureId = 0;
    await session.disconnect();
  }

  /** 真正的关闭流程：写 MIC_CLOSE、等遥控器收尾、再结束采集。 */
  async function closeCapture(reason: string): Promise<void> {
    closeRequested = false;
    if (!openSent) {
      finalizeCapture(reason);
      return;
    }
    openSent = false;
    const sessionId = session.getSessionId();
    try {
      await session.write(ATVV_COMMAND.micClose(sessionId));
      onStatus({ state: "mic-closed", message: "遥控器麦克风已关闭" });
    } catch (error) {
      onStatus({
        state: "error",
        message: `关闭麦克风失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
    session.setSessionId(0);
    // 给遥控器时间发出 AUDIO_STOP 与最后一个通知，再收尾。
    await delay(AUDIO_FLUSH_TIMEOUT_MS);
    finalizeCapture(reason);
  }

  async function startCapture(): Promise<number> {
    // 打开命令已经在路上：沿用本次采集的 id（它一定非 0）。
    if (openPromise || openSent) return activeCaptureId;
    if (!session.isReady()) {
      throw new Error("遥控器尚未连接；无法开始语音采集");
    }
    // 上一次关闭还在收尾时先等它结束，避免新旧会话的写入交错。
    if (closePromise) await closePromise.catch(() => undefined);

    closeRequested = false;
    // 先确保有 id：正常情况下这里是 0（由本函数分配）；如果遥控器已经自发开始了
    // 一次采集（capturing = true），就复用它的 id，避免开头几帧因为换号被丢掉。
    // 两种情况都必须返回非 0 值。
    const captureId = activeCaptureId !== 0 ? activeCaptureId : beginCapture("按下语音键");
    const writePromise = session.write(ATVV_COMMAND.MIC_OPEN);
    openPromise = writePromise;
    try {
      await writePromise;
      openSent = true;
      onStatus({ state: "mic-open", message: "遥控器麦克风已打开，等待音频" });
      // 打开命令完成前用户已经松手：立刻补一次关闭。
      if (closeRequested && !closePromise) {
        closePromise = closeCapture("松手");
        await closePromise;
        closePromise = null;
      }
      return captureId;
    } catch (error) {
      activeCaptureId = 0;
      throw error;
    } finally {
      if (openPromise === writePromise) openPromise = null;
    }
  }

  async function stopCapture(): Promise<void> {
    closeRequested = true;
    // 等打开流程走完：它要么已经关掉，要么会在这里的 closeCapture 里关掉。
    if (openPromise) await openPromise.catch(() => undefined);
    if (closePromise) {
      await closePromise.catch(() => undefined);
      return;
    }
    if (!closeRequested) return;
    closePromise = closeCapture("松手");
    try {
      await closePromise;
    } finally {
      closePromise = null;
    }
  }

  return {
    connect,
    disconnect,
    startCapture,
    stopCapture,
    isReady: () => session.isReady(),
  };
}
