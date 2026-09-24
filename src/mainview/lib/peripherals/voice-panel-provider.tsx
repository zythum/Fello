import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useRealtimeAsr } from "../../components/common/use-realtime-asr";
import { useMessage } from "../../components/providers/message";
import type { ChatTextareaVoicePanel } from "../../components/session/chat/chat-textarea";

/**
 * 外设语音面板（PTT 面板）。
 *
 * 与既有麦克风按钮的区别（需求明确要求）：
 * - **不写入输入框**、不写 store：语音文本只存在于本面板的局部状态里，
 *   直到用户点「发送」才通过注册方的 `submit(text)` 交出去；
 * - **接管**当前输入区（由 ChatTextarea 让位，输入区 display:none），录音期间完全不可交互；
 * - 松手后进入复核态，显示「取消 / 发送」两个**图标**按钮，默认焦点在「发送」
 *   （遥控器 OK 即发送），←/→ 可在两者之间切换；
 * - **松手不清空**：复核态再按住语音键就继续往后追加（多次按住累积成一段，
 *   每次按住是一条新的 ASR 会话，累积时按会话隔离句 id），只有「取消」才丢弃；
 * - **松手即收尾**：松手时停音频后**立刻关会话**（`stopAsr()` → `close()` 会给服务商发
 *   `finish-task`，DashScope 适配器还会等到 `task-finished`），尾句定稿因此在复核态里到达并
 *   原地替换文本。
 *   早期实现是「只停音频、会话留 5 秒等迟到的 delta / final」，但那只对**会自行定稿**的服务商
 *   成立：DashScope（默认识别 provider）的 VAD 断句按「音频流里真的出现静音」判定
 *   （`max_sentence_silence`，默认 1300ms），松手后不再送音频就不会定稿，会话只会一直停在
 *   partial —— 表现为「松手后内容不再被修正，直到下一次按住时 `start()` 先关掉旧会话，
 *   服务端才补发尾句 final 把文本改掉」。
 *
 * 转写按**句**累积（见 `useTranscriptSegments`）：服务商每条 transcript 是当前句的文本
 * （DashScope 每句带稳定的 `id` 与 1-based `index`），只取最新一条会把前面的句子冲掉。
 *
 * **本文件只负责状态**：状态机（recording / review）、ASR 会话、输入区注册与提交。
 * 面板的**结构与样式在 `chat-textarea.tsx`**（`ChatTextareaVoicePanelView`），
 * 这样版式与字号 / 颜色 / 内边距天然和输入区一致，本模块也不必再碰 UI。
 * 文件名带 `-provider` 正是为了说明这一点：provider + hooks，自己不渲染任何结构。
 */

/** 与既有麦克风按钮一致的单次录音上限。 */
const DEFAULT_MAX_DURATION = 5 * 60 * 1000;

type PanelPhase = "idle" | "recording" | "review";

/**
 * 已注册的输入区。
 *
 * 只需要「是否可用」：面板的**提交与取消都由 ChatTextarea 自己处理**（它才知道输入值、
 * 附件与调用方的 `onSubmit`），因此这里不再持有 submit / onCancel 回调。
 */
interface TargetRecord {
  enabled: boolean;
}

interface VoicePanelContextValue {
  registerTarget: (id: symbol, record: TargetRecord) => () => void;
  /** 由外设运行时在「按住」时调用；面板已激活时忽略。 */
  start: (peripheralId: string) => void;
  /** 由外设运行时在「松开」时调用。 */
  stop: () => void;
  active: boolean;
}

interface VoicePanelDataContextValue {
  /** 当前这一「段」的面板数据；未激活时为 null。渲染一律交给 ChatTextarea。 */
  panel: ChatTextareaVoicePanel | null;
  activeTargetId: symbol | null;
  phase: PanelPhase;
}

const VoicePanelContext = createContext<VoicePanelContextValue | null>(null);
const VoicePanelDataContext = createContext<VoicePanelDataContextValue | null>(null);

function useVoicePanelContext(): VoicePanelContextValue {
  const context = useVoicePanelContextOptional();
  if (!context) {
    throw new Error("Voice panel hooks must be used within VoicePanelProvider");
  }
  return context;
}

/**
 * 非抛错版本：`ChatTextarea` 会用它注册自己，而输入区理论上也能在没有
 * Provider 的环境里渲染（测试、Storybook 等），那种情况下外设功能整体静默不可用。
 */
function useVoicePanelContextOptional(): VoicePanelContextValue | null {
  return useContext(VoicePanelContext);
}

interface TranscriptSegment {
  key: string;
  text: string;
}

/**
 * 把逐句的转写累积成完整文本（段落 key 的构成见 `append` 的说明）。
 */
function useTranscriptSegments() {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const currentKeyRef = useRef<string | null>(null);
  const streamSeqRef = useRef(0);

  /**
   * 文本的 ref 镜像。
   *
   * 收尾（`await stopAsr()`）之后要判断「这一段有没有识别到东西」，那时读 state 会拿到
   * 过期闭包，所以结果必须同步写进 ref。
   */
  const textRef = useRef("");

  /**
   * 累积转写。
   *
   * 段落 key = **ASR 会话 + 句标识**。会话这一层是必需的：
   * - 服务商的 `id` / `index` 只在会话内唯一，新会话会从 1 重新开始 → 不加会话前缀会撞上
   *   上一段的 key，把已定稿的句子**覆盖掉**；
   * - 反过来更要命：上一段的收尾（尾音 flush / `finish-task` 之后的尾句定稿）是**异步**
   *   到达的，若把它们算到「新的那一次」里，就会以新句子的形式**重复追加**到末尾 ——
   *   表现为「第二次按 F5 时冒出第一次的一部分内容」。
   *
   * 句内 partial 原地替换（不追加新行），final 后重置，于是后一句接着往前长。
   */
  const append = useCallback(
    (transcript: {
      text: string;
      isFinal: boolean;
      id?: string;
      index?: number;
      asrSessionId?: string;
    }) => {
      const scope = transcript.asrSessionId ?? "session";
      const key =
        transcript.id !== undefined
          ? `${scope}:id:${transcript.id}`
          : transcript.index !== undefined
            ? `${scope}:index:${transcript.index}`
            : (currentKeyRef.current ?? `${scope}:stream:${streamSeqRef.current++}`);
      currentKeyRef.current = transcript.isFinal ? null : key;

      const list = segmentsRef.current;
      const at = list.findIndex((segment) => segment.key === key);
      if (at >= 0) list[at] = { key, text: transcript.text };
      else list.push({ key, text: transcript.text });
      textRef.current = list.map((segment) => segment.text).join("");
      setSegments([...list]);
    },
    [],
  );

  const clear = useCallback(() => {
    segmentsRef.current = [];
    currentKeyRef.current = null;
    textRef.current = "";
    setSegments([]);
  }, []);

  const text = segments.map((segment) => segment.text).join("");
  return { text, textRef, append, clear };
}

export function VoicePanelProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const [phase, setPhase] = useState<PanelPhase>("idle");
  const [error, setErrorState] = useState<string | null>(null);
  /** 错误的 ref 镜像：收尾后的判断同样要读最新值，不能读过期闭包。 */
  const errorRef = useRef<string | null>(null);
  const setError = useCallback((next: string | null) => {
    errorRef.current = next;
    setErrorState(next);
  }, []);
  const [activeTargetId, setActiveTargetId] = useState<symbol | null>(null);
  const targetsRef = useRef(new Map<symbol, TargetRecord>());
  const phaseRef = useRef<PanelPhase>("idle");
  const activeTargetRef = useRef<symbol | null>(null);
  const stopAsrRef = useRef<() => Promise<void>>(async () => {});
  const transcript = useTranscriptSegments();

  const setPhaseBoth = useCallback((next: PanelPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const resolveTarget = useCallback((): [symbol, TargetRecord] | null => {
    // 取「最后一个注册且 enabled」：输入区挂载/卸载顺序不稳定，取最靠近当前界面的那个。
    let found: [symbol, TargetRecord] | null = null;
    for (const [id, record] of targetsRef.current) {
      if (record.enabled) found = [id, record];
    }
    return found;
  }, []);

  const asr = useRealtimeAsr({
    source: "peripheral",
    onTranscript: (result) => transcript.append(result),
    onError: (message) => setError(message),
  });
  const { start: startAsr, stop: stopAsr } = asr;
  const { clear: clearTranscript, text: transcriptText, textRef } = transcript;

  const reset = useCallback(() => {
    clearTranscript();
    setError(null);
    setActiveTargetId(null);
    activeTargetRef.current = null;
    setPhaseBoth("idle");
  }, [clearTranscript, setError, setPhaseBoth]);

  /**
   * 收起面板（取消 / 提交 / 判定为空 都走它）。
   *
   * 只负责结束这一「段」：关 ASR 会话、清空转写、回到 idle。
   * **是否真的提交由 ChatTextarea 决定** —— 它拿得到输入值、附件与调用方的 `onSubmit`，
   * 而语音模块不该知道这些。
   */
  const close = useCallback(() => {
    if (phaseRef.current === "idle") return;
    void stopAsr();
    reset();
  }, [reset, stopAsr]);

  /**
   * 松手：停音频 → **立刻收尾关会话**（见文件头「松手即收尾」）。
   *
   * 关会话这一步不能推迟：尾句定稿本来就只在 `finish-task` 之后才产生，把会话留着等
   * 「迟到的 delta / final」是等不到的（服务端的静音判定需要音频流继续有静音）。
   * `stopAsr()` 内部先停音频（等完遥控器的尾音 flush）再关会话，close 期间到达的 final
   * 走的是同一条会话，会被就地应用 —— 复核态因此一定拿得到定稿。
   */
  const stop = useCallback(() => {
    if (phaseRef.current === "idle") return;

    // 松手时**一个字的文本都没接到**（含之前累积的）→ 直接判定为空收掉，不用再等。
    // 依据：正常识别时 partial 在说话期间就会持续到达，松手仍是空基本等于这段没识别到。
    // 只有「有错误」时例外 —— 那要留着面板，否则用户看不到失败原因。
    if (textRef.current.trim().length === 0 && !errorRef.current) {
      close();
      return;
    }

    setPhaseBoth("review");
    void stopAsr();
  }, [close, setPhaseBoth, stopAsr, textRef]);

  const start = useCallback(
    (peripheralId: string) => {
      // 已经在录音时忽略（同一次按住的重复 keydown）；
      // 但**复核态允许再次按住**：松手后不清空，继续按语音键就往后面追加，多次累积成一段。
      if (phaseRef.current === "recording") return;
      const appending = phaseRef.current === "review";
      const target = resolveTarget();
      if (!target) return;
      // 没有启用任何语音识别服务商时，面板一旦打开就会「录而不识」，
      // 因此这里直接给出提示并且不开面板。
      if (!asr.configured) {
        toast.error(t("chatInput.voiceInputNotConfigured", "Configure voice input in Settings"));
        return;
      }
      // 只有「新开一段」才清空文本；追加时保留已有内容。
      // 错误则每次都清掉（属于上一段的残留，新一段会重新上报自己的错误）。
      if (!appending) clearTranscript();
      setError(null);
      // 注意：这里**不能**切换「段」的作用域 —— 上一段的收尾（尾音 flush + finish-task 等
      // 尾句定稿）可能还在路上，提前换段会把它算成新内容。转写的隔离由 ASR 会话 id 天然
      // 保证（见 useTranscriptSegments）；开新会话前也会先 await 掉上一次的收尾链。
      activeTargetRef.current = target[0];
      setActiveTargetId(target[0]);
      setPhaseBoth("recording");
      void startAsr(peripheralId);
    },
    [asr.configured, clearTranscript, resolveTarget, setError, setPhaseBoth, startAsr, t, toast],
  );

  const registerTarget = useCallback(
    (id: symbol, record: TargetRecord) => {
      targetsRef.current.set(id, record);
      return () => {
        if (targetsRef.current.get(id) !== record) return;
        targetsRef.current.delete(id);
        // 正在录音的宿主被卸载（切会话 / 输入区禁用）→ 放弃这次录音，避免面板失去宿主。
        if (activeTargetRef.current === id) {
          void stopAsrRef.current();
          clearTranscript();
          setError(null);
          activeTargetRef.current = null;
          setActiveTargetId(null);
          setPhaseBoth("idle");
        }
      };
    },
    [clearTranscript, setError, setPhaseBoth],
  );

  // stopAsr 经 ref 暴露给卸载清理，避免 registerTarget 的依赖随每次渲染变化。
  useEffect(() => {
    stopAsrRef.current = stopAsr;
  }, [stopAsr]);

  // 录音超时保护（与麦克风按钮一致）。
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setTimeout(() => stop(), DEFAULT_MAX_DURATION);
    return () => clearTimeout(timer);
  }, [phase, stop]);

  // 面板激活期间的 Escape = 取消（遥控器「返回」键的语义入口）。
  useEffect(() => {
    if (phase === "idle") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [phase, close]);

  const value = useMemo<VoicePanelContextValue>(
    () => ({ registerTarget, start, stop, active: phase !== "idle" }),
    [registerTarget, start, stop, phase],
  );

  /**
   * 交给 ChatTextarea 渲染的纯数据。
   *
   * `audioActive` 表示音频是否真的在采集：`phase === "recording"` 只说明「用户按着语音键」，
   * 而从按下到真正能收音频还要经过 ASR 连接 + 遥控器开麦，这段窗口由渲染层显示加载态
   * （与麦克风按钮的 `starting` 同义）。`asr.recording` 恰好在 `voiceStart` 返回后才置位。
   */
  const dataValue = useMemo<VoicePanelDataContextValue>(
    () => ({
      panel:
        phase === "idle"
          ? null
          : {
              phase,
              transcript: transcriptText,
              error,
              audioLevel: asr.audioLevel,
              audioActive: asr.recording,
              close,
            },
      activeTargetId,
      phase,
    }),
    [phase, transcriptText, error, asr.audioLevel, asr.recording, close, activeTargetId],
  );

  return (
    <VoicePanelContext.Provider value={value}>
      <VoicePanelDataContext.Provider value={dataValue}>{children}</VoicePanelDataContext.Provider>
    </VoicePanelContext.Provider>
  );
}

/**
 * 把当前输入区注册为语音面板的宿主（由 `ChatTextarea` 自己调用）。
 *
 * @returns 面板数据；未被选中 / 面板未激活时为 null
 */
export function useVoicePanelTarget(options: { enabled: boolean }): ChatTextareaVoicePanel | null {
  const registerTarget = useVoicePanelContextOptional()?.registerTarget;
  const dataValue = useContext(VoicePanelDataContext);
  const [id] = useState(() => Symbol("VoicePanelTarget"));
  const recordRef = useRef<TargetRecord>({ enabled: false });

  // 不在渲染期写 ref：最新值同步放到 effect 阶段。
  useEffect(() => {
    recordRef.current.enabled = options.enabled;
  }, [options.enabled]);

  useEffect(() => {
    if (!registerTarget) return;
    return registerTarget(id, recordRef.current);
  }, [id, registerTarget]);

  if (!dataValue || dataValue.phase === "idle" || dataValue.activeTargetId !== id) {
    return null;
  }
  return dataValue.panel;
}

/** 供外设运行时使用：启动 / 停止面板（不因此重新渲染调用方）。 */
export function useVoicePanelController() {
  const { start, stop, active } = useVoicePanelContext();
  return { start, stop, active };
}
