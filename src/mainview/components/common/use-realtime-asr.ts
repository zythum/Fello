import { useCallback, useEffect, useRef, useState } from "react";
import { clientId, request, subscribe } from "../../backend";
import { useAppStore } from "../../store";

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 320;

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

export interface RealtimeAsrTranscript {
  text: string;
  isFinal: boolean;
  id?: string;
  index?: number;
}

export interface RealtimeAsrInputDevice {
  deviceId: string;
  label: string;
}

export interface UseRealtimeAsrOptions {
  onTranscript?: (transcript: RealtimeAsrTranscript) => void;
  onError?: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
}

export interface UseRealtimeAsrResult {
  recording: boolean;
  audioLevel: number;
  configured: boolean;
  inputDevices: RealtimeAsrInputDevice[];
  refreshInputDevices: () => Promise<RealtimeAsrInputDevice[]>;
  start: (deviceId?: string) => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => void;
}

export function useRealtimeAsr(options: UseRealtimeAsrOptions): UseRealtimeAsrResult {
  const { onTranscript, onError, onRecordingChange } = options;
  const configured = useAppStore((state) => state.speechToText.some((provider) => provider.active));
  const [recording, setRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [inputDevices, setInputDevices] = useState<RealtimeAsrInputDevice[]>([]);
  const asrSessionIdRef = useRef<string | null>(null);
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
  const callbacksRef = useRef({ onTranscript, onError, onRecordingChange });
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

  const updateAudioLevel = useCallback((buffer: ArrayBuffer) => {
    const samples = new Int16Array(buffer);
    if (samples.length === 0) return;
    let sumSquares = 0;
    for (const sample of samples) {
      const normalized = sample / 32768;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    audioLevelValueRef.current = Math.min(1, rms * 4);
    if (audioLevelFrameRef.current !== null) return;
    audioLevelFrameRef.current = requestAnimationFrame(() => {
      audioLevelFrameRef.current = null;
      setAudioLevel(audioLevelValueRef.current);
    });
  }, []);

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
      if (recordingRef.current || !configured) return;
      const asrSessionId = `asr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      asrSessionIdRef.current = asrSessionId;
      stoppedRef.current = false;
      stoppingRef.current = false;

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
    [cleanupAudio, configured, setRecordingState, updateAudioLevel],
  );

  const stop = useCallback(async () => {
    const asrSessionId = asrSessionIdRef.current;
    if (!asrSessionId) return;
    stoppedRef.current = true;
    stoppingRef.current = true;
    await cleanupAudio();
    await request.stopRealtimeAsr({ clientId, asrSessionId }).catch((error: unknown) => {
      callbacksRef.current.onError?.(errorMessage(error));
    });
    asrSessionIdRef.current = null;
    stoppingRef.current = false;
    setRecordingState(false);
  }, [cleanupAudio, setRecordingState]);

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
    toggle,
  };
}
