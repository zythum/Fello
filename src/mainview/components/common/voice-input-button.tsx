import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, LoaderCircle, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAppStore } from "../../store";
import { useMessage } from "../providers/message";
import { useRealtimeAsr, type RealtimeAsrTranscript } from "./use-realtime-asr";

const ASR_WAVEFORM_BARS = [0.35, 0.65, 0.95, 0.55, 0.8, 0.45, 0.9, 0.6, 0.38];
const DEFAULT_MAX_DURATION = 5 * 60 * 1000;
const ALT_DOUBLE_PRESS_WINDOW = 350;
const VOICE_INPUT_DEVICE_STORAGE_KEY = "fello.voice-input.device-id";

type ActiveVoiceRecording = {
  owner: symbol;
  stop: () => Promise<void>;
};

// VoiceInputButton instances share the renderer process, so keep the active
// recording at module scope to prevent multiple microphones from recording at once.
let activeVoiceRecording: ActiveVoiceRecording | null = null;
let voiceRecordingStartChain = Promise.resolve();

function getInputCursor(input: HTMLInputElement | HTMLTextAreaElement): number {
  return input.selectionStart ?? input.value.length;
}

export interface VoiceInputButtonRef {
  stop: () => Promise<void>;
}

export interface VoiceInputButtonProps {
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  disabled?: boolean;
  className?: string;
  /** Maximum recording duration in milliseconds. Set to 0 or a negative value to disable. */
  maxDuration?: number;
  ref?: Ref<VoiceInputButtonRef>;
}

/** Reusable microphone control with device selection, waveform and transcript insertion. */
export function VoiceInputButton({
  inputRef,
  disabled = false,
  className,
  maxDuration = DEFAULT_MAX_DURATION,
  ref,
}: VoiceInputButtonProps) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const altDoublePressEnabled = useAppStore((state) => state.voiceInput.altDoublePress);
  const [instanceId] = useState(() => Symbol("VoiceInputButton"));
  const stopAsrRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const asrApplyingRef = useRef(false);
  const asrSegmentsRef = useRef(new Map<string, { start: number; length: number }>());
  const asrTailRef = useRef(0);
  const asrCurrentKeyRef = useRef<string | null>(null);
  const asrSequenceRef = useRef(0);
  const lastAltTapAtRef = useRef<number | null>(null);
  const suppressAltUntilRef = useRef(0);

  const freezeAsrSegments = useCallback(() => {
    asrSegmentsRef.current.clear();
    asrCurrentKeyRef.current = null;
    const textarea = inputRef.current;
    if (textarea) asrTailRef.current = getInputCursor(textarea);
  }, [inputRef]);

  const applyAsrTranscript = useCallback(
    (transcript: RealtimeAsrTranscript) => {
      const textarea = inputRef.current;
      if (!textarea) return;

      const key = transcript.id
        ? `id:${transcript.id}`
        : transcript.index !== undefined
          ? `index:${transcript.index}`
          : (asrCurrentKeyRef.current ?? `stream:${asrSequenceRef.current++}`);
      let segment = asrSegmentsRef.current.get(key);
      if (!segment) {
        segment = { start: asrTailRef.current, length: 0 };
        asrSegmentsRef.current.set(key, segment);
        asrCurrentKeyRef.current = key;
      }

      textarea.focus();
      textarea.setSelectionRange(segment.start, segment.start + segment.length);
      asrApplyingRef.current = true;
      try {
        document.execCommand("insertText", false, transcript.text);
      } finally {
        asrApplyingRef.current = false;
      }
      textarea.ownerDocument.dispatchEvent(new Event("selectionchange"));
      segment.length = transcript.text.length;
      asrTailRef.current = segment.start + segment.length;

      if (transcript.isFinal) {
        asrSegmentsRef.current.delete(key);
        asrCurrentKeyRef.current = null;
      }
    },
    [inputRef],
  );

  const handleRecordingChange = useCallback(
    (recording: boolean) => {
      if (recording) {
        activeVoiceRecording = {
          owner: instanceId,
          stop: () => stopAsrRef.current(),
        };
      } else {
        freezeAsrSegments();
        if (activeVoiceRecording?.owner === instanceId) {
          activeVoiceRecording = null;
        }
      }
    },
    [freezeAsrSegments, instanceId],
  );

  const asr = useRealtimeAsr({
    onTranscript: applyAsrTranscript,
    onError: (message) => toast.error(message),
    onRecordingChange: handleRecordingChange,
  });
  const { start: startAsr, stop: stopAsr, refreshInputDevices } = asr;

  const handleStop = useCallback(async () => {
    await stopAsr();
  }, [stopAsr]);
  stopAsrRef.current = handleStop;

  useImperativeHandle(
    ref,
    () => ({
      stop: handleStop,
    }),
    [handleStop],
  );

  const handleStart = useCallback(
    async (deviceId?: string) => {
      const startOperation = voiceRecordingStartChain.then(async () => {
        await activeVoiceRecording?.stop();

        const textarea = inputRef.current;
        if (!textarea) return;

        textarea.focus();
        const cursorPosition = getInputCursor(textarea);
        const before = textarea.value.slice(0, cursorPosition);
        if (before.length > 0 && !/\s$/.test(before)) {
          asrApplyingRef.current = true;
          try {
            document.execCommand("insertText", false, " ");
          } finally {
            asrApplyingRef.current = false;
          }
        }
        asrSegmentsRef.current.clear();
        asrCurrentKeyRef.current = null;
        asrTailRef.current = getInputCursor(textarea);
        await startAsr(deviceId);
      });
      voiceRecordingStartChain = startOperation.catch(() => undefined);
      await startOperation;
    },
    [startAsr, inputRef],
  );

  const [savedDeviceId, setSavedDeviceId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(VOICE_INPUT_DEVICE_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const rememberDevice = useCallback((deviceId: string) => {
    setSavedDeviceId(deviceId);
    try {
      localStorage.setItem(VOICE_INPUT_DEVICE_STORAGE_KEY, deviceId);
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
  }, []);

  const handleSelectDevice = useCallback(
    (deviceId: string) => {
      rememberDevice(deviceId);
      setDeviceMenuOpen(false);
    },
    [rememberDevice],
  );

  const handleMicClick = useCallback(async () => {
    if (disabled || !asr.configured || starting) return;
    setStarting(true);
    try {
      const devices = await refreshInputDevices();
      const hasSavedDevice =
        savedDeviceId != null && devices.some((device) => device.deviceId === savedDeviceId);
      if (hasSavedDevice) {
        await handleStart(savedDeviceId);
      } else {
        setDeviceMenuOpen(true);
      }
    } finally {
      setStarting(false);
    }
  }, [
    asr.configured,
    disabled,
    handleStart,
    refreshInputDevices,
    savedDeviceId,
    starting,
  ]);

  const handleShortcutToggle = useCallback(async () => {
    if (disabled || !asr.configured || starting) return;
    if (asr.recording) {
      await handleStop();
      return;
    }

    setStarting(true);
    try {
      const devices = await refreshInputDevices();
      const hasSavedDevice =
        savedDeviceId != null && devices.some((device) => device.deviceId === savedDeviceId);
      await handleStart(hasSavedDevice ? savedDeviceId : undefined);
    } finally {
      setStarting(false);
    }
  }, [
    asr.configured,
    asr.recording,
    disabled,
    handleStart,
    handleStop,
    refreshInputDevices,
    savedDeviceId,
    starting,
  ]);

  const handleDeviceMenuChange = useCallback(
    (open: boolean) => {
      setDeviceMenuOpen(open);
      if (open) void refreshInputDevices();
    },
    [refreshInputDevices],
  );

  useEffect(() => {
    lastAltTapAtRef.current = null;

    const handleKeyDown = (event: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input || document.activeElement !== input) {
        lastAltTapAtRef.current = null;
        return;
      }

      if (event.key === "Escape") {
        lastAltTapAtRef.current = null;
        suppressAltUntilRef.current = 0;
        if (
          !event.repeat &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          asr.recording
        ) {
          event.preventDefault();
          void handleStop();
        }
        return;
      }

      if (event.key !== "Alt") {
        lastAltTapAtRef.current = null;
        return;
      }
      if (!altDoublePressEnabled || event.repeat || event.ctrlKey || event.metaKey || event.shiftKey) {
        lastAltTapAtRef.current = null;
        return;
      }

      const now = Date.now();
      if (now < suppressAltUntilRef.current) {
        lastAltTapAtRef.current = null;
        return;
      }

      if (asr.recording) {
        lastAltTapAtRef.current = null;
        suppressAltUntilRef.current = now + ALT_DOUBLE_PRESS_WINDOW;
        event.preventDefault();
        void handleStop();
        return;
      }

      const lastTapAt = lastAltTapAtRef.current;
      if (lastTapAt !== null && now - lastTapAt <= ALT_DOUBLE_PRESS_WINDOW) {
        lastAltTapAtRef.current = null;
        event.preventDefault();
        void handleShortcutToggle();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return;

      const input = inputRef.current;
      if (!input || document.activeElement !== input) {
        lastAltTapAtRef.current = null;
        return;
      }
      if (Date.now() < suppressAltUntilRef.current) {
        lastAltTapAtRef.current = null;
        return;
      }
      lastAltTapAtRef.current = Date.now();
    };

    const resetAltTap = () => {
      lastAltTapAtRef.current = null;
      suppressAltUntilRef.current = 0;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", resetAltTap);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", resetAltTap);
    };
  }, [
    altDoublePressEnabled,
    asr.recording,
    handleShortcutToggle,
    handleStop,
    inputRef,
  ]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    const handleInput = () => {
      if (!asrApplyingRef.current && asr.recording) freezeAsrSegments();
    };
    textarea.addEventListener("input", handleInput);
    return () => textarea.removeEventListener("input", handleInput);
  }, [asr.recording, freezeAsrSegments, inputRef]);

  useEffect(() => {
    if (disabled && asr.recording) void handleStop();
  }, [asr.recording, disabled, handleStop]);

  useEffect(() => {
    if (!asr.recording || maxDuration <= 0 || !Number.isFinite(maxDuration)) return;
    const timer = setTimeout(() => void handleStop(), maxDuration);
    return () => clearTimeout(timer);
  }, [asr.recording, handleStop, maxDuration]);

  if (!asr.configured) return null;

  return (
    <div
      className={cn(
        "relative inline-flex h-7 transition-[width] duration-300 ease-out flex-none",
        asr.recording ? "w-18" : "w-12.5",
        className,
      )}
    >
      <div
        className={cn(
          "absolute inset-0 transition-[opacity,transform,visibility] duration-300 ease-out",
          asr.recording
            ? "visible scale-100 opacity-100"
            : "pointer-events-none invisible scale-90 opacity-0",
        )}
        aria-hidden={!asr.recording}
      >
        <Button
          variant="default"
          size="sm"
          className="h-full w-full rounded-lg bg-muted hover:bg-input border border-input text-amber-300/50 hover:text-amber-200"
          onClick={() => void handleStop()}
          aria-label={t("chatInput.stopVoiceInput", "Stop voice input")}
          aria-pressed="true"
          title={t("chatInput.stopVoiceInput", "Stop voice input")}
        >
          <Mic className="size-3.5 shrink-0 animate-pulse" />
          <span
            className="flex h-4 flex-1 items-center justify-center gap-0.5 overflow-hidden"
            aria-hidden="true"
          >
            {ASR_WAVEFORM_BARS.map((scale, index) => (
              <span
                key={index}
                className="border-l rounded-full bg-amber-300 transition-[height] duration-75"
                style={{
                  height: `${Math.max(2, Math.round(2 + asr.audioLevel * 16 * scale))}px`,
                }}
              />
            ))}
          </span>
        </Button>
      </div>
      <div
        className={cn(
          "absolute inset-0 transition-[opacity,transform,visibility] duration-300 ease-out",
          asr.recording
            ? "pointer-events-none invisible scale-90 opacity-0"
            : "visible scale-100 opacity-100",
        )}
        aria-hidden={asr.recording}
      >
        <DropdownMenu open={deviceMenuOpen} onOpenChange={handleDeviceMenuChange}>
          <div className="flex h-full items-stretch">
            <Button
              size="sm"
              className="h-full w-8 rounded-r-none border-r-0 bg-muted hover:bg-input border border-input text-amber-300/50 hover:text-amber-200"
              onClick={() => void handleMicClick()}
              disabled={disabled || !asr.configured || starting}
              aria-busy={starting}
              aria-label={
                starting
                  ? t("chatInput.startingVoiceInput", "Starting voice input")
                  : t("chatInput.voiceInput", "Voice input")
              }
              title={
                starting
                  ? t("chatInput.startingVoiceInput", "Starting voice input")
                  : asr.configured
                    ? t("chatInput.voiceInput", "Voice input")
                    : t("chatInput.voiceInputNotConfigured", "Configure voice input in Settings")
              }
            >
              {starting ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Mic className="size-3.5" />
              )}
            </Button>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon"
                  className="h-full w-4.5 rounded-l-none bg-muted hover:bg-input border border-input border-l-0 px-0 text-amber-300/50 hover:text-amber-200"
                  disabled={disabled || !asr.configured || starting}
                  aria-label={t("chatInput.selectVoiceInputDevice", "Select microphone")}
                  title={t("chatInput.selectVoiceInputDevice", "Select microphone")}
                />
              }
            >
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
          </div>
          <DropdownMenuContent
            side="top"
            align="center"
            className="w-auto! max-w-72 min-w-(--anchor-width)"
          >
            {asr.inputDevices.length > 0 ? (
              asr.inputDevices.map((device) => (
                <DropdownMenuItem
                  key={device.deviceId}
                  onClick={() => handleSelectDevice(device.deviceId)}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      "size-3 shrink-0",
                      device.deviceId === savedDeviceId ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                    <span className="truncate">{device.label}</span>
                  </div>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>
                {t("chatInput.noAudioInputDevices", "No audio input devices found")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
