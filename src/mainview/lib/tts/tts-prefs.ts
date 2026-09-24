import { create } from "zustand";

/**
 * TTS 播放偏好（自动朗读 / 音量）。
 *
 * 这些是**渲染层自己用的播放偏好**，主进程完全不需要知道（对比：语音 Provider 凭据
 * 必须存在主进程 settings.json，因为只有主进程拿它们建连接），因此存 localStorage
 * 而不是全局设置：不进 settings.json、不走 IPC、改完立即生效。
 */

const STORAGE_KEY = "fello.tts.prefs";

export interface TtsPrefs {
  /** 自动朗读流式回复 */
  autoRead: boolean;
  /** 播放音量 0-100（挂 AudioContext 的 master GainNode） */
  volume: number;
}

const DEFAULT_PREFS: TtsPrefs = { autoRead: false, volume: 100 };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PREFS.volume;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** 读 localStorage；坏数据 / 不可用（隐私模式）都退回默认值。 */
function readPrefs(): TtsPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return DEFAULT_PREFS;
    return {
      autoRead: typeof parsed.autoRead === "boolean" ? parsed.autoRead : DEFAULT_PREFS.autoRead,
      volume: clampVolume(parsed.volume),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: TtsPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 隐私模式 / 配额写满：偏好只在本次会话生效，不值得打断播放
  }
}

interface TtsPrefsState extends TtsPrefs {
  setAutoRead: (autoRead: boolean) => void;
  setVolume: (volume: number) => void;
}

export const useTtsPrefsStore = create<TtsPrefsState>((set, get) => ({
  ...readPrefs(),
  setAutoRead: (autoRead) => {
    set({ autoRead });
    writePrefs({ autoRead, volume: get().volume });
  },
  setVolume: (volume) => {
    const next = clampVolume(volume);
    set({ volume: next });
    writePrefs({ autoRead: get().autoRead, volume: next });
  },
}));

/** 非 React 场景（播放器、朗读会话）读取当前偏好。 */
export function getTtsPrefs(): TtsPrefs {
  const { autoRead, volume } = useTtsPrefsStore.getState();
  return { autoRead, volume };
}
