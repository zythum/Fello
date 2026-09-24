import { create } from "zustand";

import { getTtsPrefs, useTtsPrefsStore } from "./tts-prefs";

/**
 * TTS 播放：全局共享的单一 AudioContext + master GainNode + 单一播放队列。
 *
 * - 所有 TTS 音频走同一个 AudioContext（懒创建，suspended 时 resume）
 * - **互斥**：全局同一时刻只有一个 TTS 会话在播；新会话的音频到达时
 *   立即停掉旧会话并切换队列（自动朗读与手动朗读共用这一套抢占逻辑）
 * - 音量统一挂在 master GainNode 上，取值来自渲染层偏好（localStorage: `fello.tts.prefs`）
 * - 只接受 PCM16（主进程恒按 pcm 请求）；各家 provider 输出采样率不同，
 *   AudioBufferSourceNode 会自动按 context 采样率重采样，无需我们处理
 */

export interface TtsPlaybackState {
  /** 当前正在出声的 TTS 会话 id；null = 未在播 */
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
}

export const useTtsPlaybackStore = create<TtsPlaybackState>((set) => ({
  activeSessionId: null,
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
}));

interface PlaybackSession {
  sessionId: string;
  /** 最后一个已调度 source 的结束时刻（context.currentTime 时基） */
  nextStartTime: number;
  sources: Set<AudioBufferSourceNode>;
}

class TtsPlayer {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private session: PlaybackSession | null = null;
  /** master GainNode 的目标增益（0-1），来自渲染层音量偏好 */
  private gain = getTtsPrefs().volume / 100;

  constructor() {
    // 音量偏好存在 localStorage，改完立即作用于当前播放
    useTtsPrefsStore.subscribe((state) => this.applyVolume(state.volume));
  }

  private applyVolume(volume: number): void {
    this.gain = Math.min(1, Math.max(0, volume / 100));
    if (this.masterGain) this.masterGain.gain.value = this.gain;
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.gain;
      this.masterGain.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    return this.context;
  }

  private stopSession(playback: PlaybackSession): void {
    for (const source of playback.sources) {
      try {
        source.stop();
      } catch {
        // 已自然结束的 source 再 stop() 会抛 InvalidStateError，忽略
      }
      source.disconnect();
    }
    playback.sources.clear();
  }

  /**
   * 追加一段 PCM16（base64）到播放队列。
   * 新会话到达时抢占：停旧会话、清队列、切换。
   */
  enqueueChunk(params: { sessionId: string; audioB64: string; sampleRate: number }): void {
    const { sessionId, audioB64, sampleRate } = params;
    const context = this.ensureContext();
    const masterGain = this.masterGain!;

    if (!this.session || this.session.sessionId !== sessionId) {
      if (this.session) this.stopSession(this.session);
      this.session = { sessionId, nextStartTime: 0, sources: new Set() };
      useTtsPlaybackStore.getState().setActiveSessionId(sessionId);
    }
    const playback = this.session;

    const bytes = Uint8Array.from(atob(audioB64), (c) => c.charCodeAt(0));
    if (bytes.length % 2 !== 0) return; // 半样本脏数据，丢弃
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);

    const buffer = context.createBuffer(1, pcm.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(masterGain);
    // 50ms 起播间隔：避免相邻片之间因调度抖动出现咔哒声
    const startAt = Math.max(context.currentTime + 0.05, playback.nextStartTime);
    playback.nextStartTime = startAt + buffer.duration;
    source.onended = () => {
      playback.sources.delete(source);
      source.disconnect();
      // 最后一个 source 自然播完且队列已空 → 清「正在朗读」状态
      if (
        playback.sources.size === 0 &&
        this.session === playback &&
        playback.nextStartTime <= (this.context?.currentTime ?? 0) + 0.02
      ) {
        this.session = null;
        useTtsPlaybackStore.getState().setActiveSessionId(null);
      }
    };
    playback.sources.add(source);
    source.start(startAt);
  }

  /** 停止当前播放（清队列 + 清状态）。 */
  stop(): void {
    if (!this.session) return;
    this.stopSession(this.session);
    this.session = null;
    useTtsPlaybackStore.getState().setActiveSessionId(null);
  }
}

export const ttsPlayer = new TtsPlayer();
