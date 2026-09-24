import { useCallback, useEffect, useRef, useState } from "react";
import { clientId, request, subscribe } from "../../backend";
import { electron } from "../../electron";
import { useAppStore } from "../../store";

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 320;

/**
 * 外设（含遥控器）音频源的**电平底噪门限**，作用在开方压缩之后。
 *
 * 遥控器送来的 PCM 没有任何 AGC，静音时仍有明显底噪；而开方压缩会把底噪一起抬高，
 * 表现为「没说话柱子也在跳」。低于该门限的信号统一归零，再线性重映射回 1.0
 * （上限仍是满格）。数值变大 = 更不容易被底噪顶起来。
 */
const PERIPHERAL_LEVEL_FLOOR = 0.15;

/**
 * 外设音频源的**起始电平静默期**。
 *
 * 遥控器开麦瞬间的头几帧是连接噪声与 ADPCM 收敛过程（不是人声），电平会先「炸」一下；
 * 这段时间把电平强制为 0，波形从静止开始爬。只影响**电平显示**，
 * 音频帧照常上行给 ASR（不想因此吃掉用户开口的第一个字）。
 */
const PERIPHERAL_LEVEL_WARMUP_MS = 300;

const workletSource = `
class FelloPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.position = 0;
    this.output = [];
    this.ratio = sampleRate / ${TARGET_SAMPLE_RATE};
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    if (input) {
      for (let i = 0; i < input.length; i++) this.buffer.push(input[i]);
      while (this.position + 1 < this.buffer.length) {
        const index = Math.floor(this.position);
        const fraction = this.position - index;
        const sample = this.buffer[index] * (1 - fraction) + this.buffer[index + 1] * fraction;
        const clamped = Math.max(-1, Math.min(1, sample));
        this.output.push(clamped < 0 ? clamped * 32768 : clamped * 32767);
        this.position += this.ratio;
        if (this.output.length >= ${FRAME_SAMPLES}) {
          const pcm = new Int16Array(${FRAME_SAMPLES});
          for (let i = 0; i < ${FRAME_SAMPLES}; i++) pcm[i] = this.output[i];
          this.output = this.output.slice(${FRAME_SAMPLES});
          this.port.postMessage(pcm.buffer, [pcm.buffer]);
        }
      }
      const remove = Math.max(0, Math.floor(this.position));
      if (remove > 0) {
        this.buffer = this.buffer.slice(remove);
        this.position -= remove;
      }
    }
    const output = outputs[0] && outputs[0][0];
    if (output) output.fill(0);
    return true;
  }
}
registerProcessor("fello-pcm-processor", FelloPcmProcessor);
`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export interface RealtimeAsrTranscript {
  text: string;
  isFinal: boolean;
  id?: string;
  index?: number;
  /**
   * 产生这条转写的 ASR 会话标识（一次「按住」= 一条会话）。
   *
   * 累积文本的消费方**必须按它隔离**：服务商的 `id` / `index` 只在**会话内**唯一，
   * 新会话会从 1 重新开始；而上一条会话的尾音定稿会在松手后（收尾 flush 期间）
   * 继续到达，若不区分会话就会被当成新句子追加，出现「上一段内容重复出现」。
   */
  asrSessionId?: string;
}

export interface RealtimeAsrInputDevice {
  deviceId: string;
  label: string;
}

/**
 * 音频来源：
 * - `microphone`（默认）：`getUserMedia` + AudioWorklet，48k → 16k 降采样后上行；
 * - `peripheral`：音频不来自本机麦克风，而是由主进程的外设通道（BLE / ATVV ADPCM）
 *   解码成 16k/16-bit/mono PCM 后经 `peripheral-audio` 事件推上来。
 *   该分支跳过 `getUserMedia` / AudioWorklet，但**复用同一条 ASR 上行与事件契约**，
 *   因此服务商配置、转写事件与既有麦克风路径完全一致。
 */
export type RealtimeAsrSource = "microphone" | "peripheral";

export interface UseRealtimeAsrOptions {
  onTranscript?: (transcript: RealtimeAsrTranscript) => void;
  onError?: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  source?: RealtimeAsrSource;
}

export interface UseRealtimeAsrResult {
  recording: boolean;
  audioLevel: number;
  configured: boolean;
  inputDevices: RealtimeAsrInputDevice[];
  refreshInputDevices: () => Promise<RealtimeAsrInputDevice[]>;
  start: (deviceId?: string) => Promise<void>;
  /** 完全停止：停音频 + 关闭 ASR 会话。 */
  stop: () => Promise<void>;
  /**
   * 只停音频上行、**保留 ASR 会话**。
   *
   * 用于「松手」这种场景：音频不再发送，但服务商可能还有 delta / final 在路上，
   * 会话留着它们才能继续替换文本；随后由 `stop()`（提交 / 取消 / 下一次按住）收尾。
   */
  stopStreaming: () => Promise<void>;
  toggle: () => void;
}

export function useRealtimeAsr(options: UseRealtimeAsrOptions): UseRealtimeAsrResult {
  const { onTranscript, onError, onRecordingChange, source = "microphone" } = options;
  const configured = useAppStore((state) =>
    state.speechProviders.some((provider) => provider.asrEnabled),
  );
  const [recording, setRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [inputDevices, setInputDevices] = useState<RealtimeAsrInputDevice[]>([]);
  const asrSessionIdRef = useRef<string | null>(null);
  /** 外设音频源：当前正在采集的外设 id（由 `start(peripheralId)` 传入）。 */
  const peripheralIdRef = useRef<string | null>(null);
  /**
   * 外设音频源：当前这次采集的 captureId。
   *
   * 只在 `peripheralVoiceStart` 返回后写入 —— 这样「上一次采集收尾 flush 期间迟到的帧」
   * （它们带的是上一个 captureId，而且会早于本次 start 完成）一定会被丢弃，不会喂给
   * 还在 connecting 的 ASR 客户端。
   */
  const captureIdRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const stoppedRef = useRef(false);
  const stoppingRef = useRef(false);
  const recordingRef = useRef(false);
  const audioLevelValueRef = useRef(0);
  const audioLevelFrameRef = useRef<number | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  /** 上一次停止的收尾链（见 `stop`）：`start` 会先 await 它，避免这一次按住被丢弃。 */
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const callbacksRef = useRef({ onTranscript, onError, onRecordingChange });
  // eslint-disable-next-line react/refs
  callbacksRef.current = { onTranscript, onError, onRecordingChange };

  const setRecordingState = useCallback((value: boolean) => {
    recordingRef.current = value;
    setRecording(value);
    callbacksRef.current.onRecordingChange?.(value);
  }, []);

  useEffect(() => {
    const handleTranscript = (event: {
      clientId: string;
      asrSessionId: string;
      text: string;
      isFinal: boolean;
      id?: string;
      index?: number;
    }) => {
      if (event.clientId !== clientId || event.asrSessionId !== asrSessionIdRef.current) return;
      callbacksRef.current.onTranscript?.({
        text: event.text,
        isFinal: event.isFinal,
        id: event.id,
        index: event.index,
        // 交给消费方做「会话隔离」用，见 RealtimeAsrTranscript.asrSessionId
        asrSessionId: event.asrSessionId,
      });
    };
    const handleError = (event: { clientId: string; asrSessionId: string; message: string }) => {
      if (event.clientId !== clientId || event.asrSessionId !== asrSessionIdRef.current) return;
      callbacksRef.current.onError?.(event.message);
    };
    const handleClosed = (event: { clientId: string; asrSessionId: string }) => {
      if (event.clientId !== clientId || event.asrSessionId !== asrSessionIdRef.current) return;
      if (recordingRef.current && !stoppingRef.current) {
        callbacksRef.current.onError?.("实时语音识别连接已关闭。");
        void stopRef.current();
      }
    };
    subscribe.on("asr-transcript", handleTranscript);
    subscribe.on("asr-error", handleError);
    subscribe.on("asr-closed", handleClosed);
    return () => {
      subscribe.off("asr-transcript", handleTranscript);
      subscribe.off("asr-error", handleError);
      subscribe.off("asr-closed", handleClosed);
    };
  }, [setRecordingState]);

  /** 外设音频源：起始电平静默期的截止时间（见 `PERIPHERAL_LEVEL_WARMUP_MS`）。 */
  const levelGateUntilRef = useRef(0);

  const updateAudioLevel = useCallback(
    (buffer: ArrayBuffer) => {
      const samples = new Int16Array(buffer);
      if (samples.length === 0) return;
      // 起始静默期：这几帧是开麦噪声，电平直接归零（UI 侧的 0 已在 start 里设过）。
      if (source === "peripheral" && Date.now() < levelGateUntilRef.current) {
        audioLevelValueRef.current = 0;
        return;
      }
      let sumSquares = 0;
      for (const sample of samples) {
        const normalized = sample / 32768;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      // RMS 计算两条路径完全一致，差别只在**映射到显示值**这一步：
      // - 麦克风：`getUserMedia` 已做降噪并带自动增益，幅度接近满量程，`rms * 4` 就够用；
      // - 外设：BLE 原始 PCM（ATVV ADPCM 解码）**没有任何 AGC**，绝对幅度通常低一个数量级，
      //   套同一个线性映射柱子会几乎不动。这里做一次开方压缩（≈ 感知曲线），
      //   让弱信号也有可见起伏。想在真机上更接近麦克风那种幅度，调这里即可。
      const amplified = Math.min(1, rms * 4);
      const compressed = Math.sqrt(amplified);
      audioLevelValueRef.current =
        source === "peripheral"
          ? Math.max(0, (compressed - PERIPHERAL_LEVEL_FLOOR) / (1 - PERIPHERAL_LEVEL_FLOOR))
          : amplified;
      if (audioLevelFrameRef.current !== null) return;
      audioLevelFrameRef.current = requestAnimationFrame(() => {
        audioLevelFrameRef.current = null;
        setAudioLevel(audioLevelValueRef.current);
      });
    },
    [source],
  );

  // 外设音频源：主进程已完成 ADPCM 解码，这里只做电平计算与上行转发。
  // 帧与 ASR 会话通过 `asrSessionIdRef` / `peripheralIdRef` 校验，stop 之后的迟到帧不再发送。
  useEffect(() => {
    if (source !== "peripheral") return;
    const handleAudio = (event: { peripheralId: string; captureId: number; audioB64: string }) => {
      const asrSessionId = asrSessionIdRef.current;
      if (!asrSessionId || stoppedRef.current) return;
      if (event.peripheralId !== peripheralIdRef.current) return;
      // 必须是本次采集的帧：captureIdRef 在 voiceStart 返回后才赋值，
      // 因此既排除了上一次采集的迟到帧，也排除了「还在 connecting」的窗口。
      if (event.captureId === 0 || event.captureId !== captureIdRef.current) return;
      updateAudioLevel(base64ToArrayBuffer(event.audioB64));
      void request
        .sendRealtimeAsrFrame({ clientId, asrSessionId, audioB64: event.audioB64 })
        .catch((error: unknown) => callbacksRef.current.onError?.(errorMessage(error)));
    };
    subscribe.on("peripheral-audio", handleAudio);
    return () => subscribe.off("peripheral-audio", handleAudio);
  }, [source, updateAudioLevel]);

  const cleanupAudio = useCallback(async () => {
    if (audioLevelFrameRef.current !== null) {
      cancelAnimationFrame(audioLevelFrameRef.current);
      audioLevelFrameRef.current = null;
    }
    audioLevelValueRef.current = 0;
    setAudioLevel(0);
    nodeRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    nodeRef.current = null;
    sourceRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    await context?.close().catch(() => undefined);
  }, []);

  const refreshInputDevices = useCallback(async (): Promise<RealtimeAsrInputDevice[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      if (devices.length > 0 && devices.every((device) => !device.label)) {
        try {
          const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          permissionStream.getTracks().forEach((track) => track.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
        } catch {
          // The device list can still be shown with generic labels.
        }
      }
      const audioInputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));
      setInputDevices(audioInputs);
      return audioInputs;
    } catch (error) {
      callbacksRef.current.onError?.(errorMessage(error));
      return [];
    }
  }, []);

  const start = useCallback(
    async (deviceId = "default") => {
      // 上一次录音还在收尾时先等它结束：每一次按住都必须是**独立的一次录音实例**
      // （新的 ASR 会话 + 新的 BLE 采集），而不是被上一次的收尾吞掉。
      if (stopPromiseRef.current) await stopPromiseRef.current.catch(() => undefined);
      // 复核期间会话是**故意留着的**（好接住迟到的 final），这里要把它收掉再开新的一次，
      // 否则两次按住会共用同一条会话 —— 服务商的句 id 会互相污染。
      if (asrSessionIdRef.current) await stopRef.current().catch(() => undefined);
      if (recordingRef.current || !configured) return;
      const asrSessionId = `asr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      asrSessionIdRef.current = asrSessionId;
      stoppedRef.current = false;
      stoppingRef.current = false;

      if (source === "peripheral") {
        // `deviceId` 在外设音频源下承载的是外设 id（面板不选设备）。
        const peripheralId = deviceId;
        peripheralIdRef.current = peripheralId;
        captureIdRef.current = 0;
        try {
          await request.startRealtimeAsr({ clientId, asrSessionId });
          const captureId = await electron.peripherals.voiceStart(peripheralId);
          // 没有 captureId 就无法把音频帧对上号（帧会被全部丢掉，表现为「录了但没识别」），
          // 所以这里必须显式失败，而不是安静地录一段没人要的音频。
          if (!Number.isFinite(captureId) || captureId <= 0) {
            // 带上实际收到的值：这类问题必须一眼看出是「没返回」还是「返回了 0」。
            throw new Error(
              `外设音频通道未返回有效的采集标识（captureId=${String(captureId)}），本次录音已取消。`,
            );
          }
          captureIdRef.current = captureId;
          // 电平从这个「真正开始收音频」的时刻起算静默期，波形从静止开始爬。
          levelGateUntilRef.current = Date.now() + PERIPHERAL_LEVEL_WARMUP_MS;
          audioLevelValueRef.current = 0;
          setAudioLevel(0);
          setRecordingState(true);
        } catch (error) {
          await request.stopRealtimeAsr({ clientId, asrSessionId }).catch(() => undefined);
          await electron.peripherals.voiceStop(peripheralId).catch(() => undefined);
          asrSessionIdRef.current = null;
          peripheralIdRef.current = null;
          captureIdRef.current = 0;
          callbacksRef.current.onError?.(errorMessage(error));
          setRecordingState(false);
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            ...(deviceId !== "default" ? { deviceId: { exact: deviceId } } : {}),
          },
        });
        streamRef.current = stream;

        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        await audioContext.resume();
        const workletUrl = URL.createObjectURL(
          new Blob([workletSource], { type: "application/javascript" }),
        );
        try {
          await audioContext.audioWorklet.addModule(workletUrl);
        } finally {
          URL.revokeObjectURL(workletUrl);
        }
        const source = audioContext.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(audioContext, "fello-pcm-processor");
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        node.port.onmessage = (message: MessageEvent<ArrayBuffer>) => {
          if (stoppedRef.current || asrSessionIdRef.current !== asrSessionId) return;
          updateAudioLevel(message.data);
          void request
            .sendRealtimeAsrFrame({
              clientId,
              asrSessionId,
              audioB64: arrayBufferToBase64(message.data),
            })
            .catch((error: unknown) => callbacksRef.current.onError?.(errorMessage(error)));
        };
        sourceRef.current = source;
        nodeRef.current = node;

        await request.startRealtimeAsr({ clientId, asrSessionId });
        source.connect(node);
        node.connect(silentGain);
        silentGain.connect(audioContext.destination);
        setRecordingState(true);
      } catch (error) {
        await cleanupAudio();
        await request.stopRealtimeAsr({ clientId, asrSessionId }).catch(() => undefined);
        asrSessionIdRef.current = null;
        callbacksRef.current.onError?.(errorMessage(error));
        setRecordingState(false);
      }
    },
    [cleanupAudio, configured, setRecordingState, updateAudioLevel, source],
  );

  /**
   * **只停音频上行，保留 ASR 会话**（松手 / 关闭麦克风）。
   *
   * 这是「松手」的正确语义：不再送新音频，但服务商可能还有 delta / final 在路上，
   * 会话必须留着，那些定稿才能继续替换文本。会话的关闭交给 `stop()`。
   */
  const runStopStreaming = useCallback(async () => {
    if (!asrSessionIdRef.current) return;
    // 「本次采集结束」在松手当下就成立，**不能等尾音 flush 收完再置位**：
    // 那 800ms 里若用户又按住语音键，界面会先读到上一次残留的 `recording = true` 画一次波形，
    // 随后被置假显示加载态，等新会话起来再显示波形 —— 就是「波形 → loading → 波形」的抖动。
    setRecordingState(false);
    audioLevelValueRef.current = 0;
    setAudioLevel(0);

    if (source === "peripheral") {
      const peripheralId = peripheralIdRef.current;
      // 注意：这里**不能**提前把 stoppedRef 置为 true。
      // 关麦克风后遥控器还会发出最后几个音频通知，flush 期间它们仍要上行，否则丢尾音。
      if (peripheralId) {
        await electron.peripherals.voiceStop(peripheralId).catch(() => undefined);
      }
      // 音频（含尾音 flush）已经收完：之后的迟到帧不再转发，但转写事件不受影响。
      stoppedRef.current = true;
      return;
    }
    stoppedRef.current = true;
    await cleanupAudio();
  }, [cleanupAudio, setRecordingState, source]);

  /** 关闭 ASR 会话（真正结束一次识别）。 */
  const runCloseSession = useCallback(async () => {
    const asrSessionId = asrSessionIdRef.current;
    if (!asrSessionId) return;
    stoppingRef.current = true;
    await request.stopRealtimeAsr({ clientId, asrSessionId }).catch((error: unknown) => {
      callbacksRef.current.onError?.(errorMessage(error));
    });
    asrSessionIdRef.current = null;
    peripheralIdRef.current = null;
    captureIdRef.current = 0;
    stoppingRef.current = false;
  }, []);

  const runStop = useCallback(async () => {
    await runStopStreaming();
    await runCloseSession();
    setRecordingState(false);
  }, [runCloseSession, runStopStreaming, setRecordingState]);

  /**
   * 停止一次录音。
   *
   * 收尾链会登记到 `stopPromiseRef`，**下一次 `start` 必须先等它结束** ——
   * 外设路径的收尾包含约 800ms 的音频 flush 与 ASR 关闭，若这期间用户又按住语音键，
   * 旧逻辑会因为 `recordingRef` 仍为 true 而静默 return：既不建新的 ASR 会话、
   * 也不重新开麦，听感上就是「复用了上一次录音」（而那一次其实已经关了）。
   */
  const stop = useCallback(async () => {
    const run = runStop();
    stopPromiseRef.current = run;
    try {
      await run;
    } finally {
      if (stopPromiseRef.current === run) stopPromiseRef.current = null;
    }
  }, [runStop]);

  /** 松手：停音频、保留会话（见 `runStopStreaming` 的说明），返回的 Promise 供调用方等待音频收尾。 */
  const stopStreaming = useCallback(async () => {
    const run = runStopStreaming();
    stopPromiseRef.current = run;
    try {
      await run;
    } finally {
      if (stopPromiseRef.current === run) stopPromiseRef.current = null;
    }
  }, [runStopStreaming]);

  // eslint-disable-next-line react/refs
  stopRef.current = stop;
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      void stopRef.current();
    };
  }, []);

  const toggle = useCallback(() => {
    void (recordingRef.current ? stop() : start());
  }, [start, stop]);

  return {
    recording,
    audioLevel,
    configured,
    inputDevices,
    refreshInputDevices,
    start,
    stop,
    stopStreaming,
    toggle,
  };
}
