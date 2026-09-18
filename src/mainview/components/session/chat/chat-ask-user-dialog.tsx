import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSessionAskUserRequests } from "../../../lib/session-selectors";
import * as backend from "../../../backend";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  HelpCircle,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Clock,
  Keyboard,
} from "lucide-react";
import { stringify as toYaml } from "json-to-pretty-yaml";
import { resolveMentions } from "../../../lib/mention-utils";
import type { AskUserRequest, AskUserRequestOption } from "../../../../shared/schema";
import type { VoiceInputButtonRef } from "../../common/voice-input-button";
import { useFocusTarget } from "../../../lib/keyboard";
import { ChatTextarea, IMAGE_MIME_TYPES } from "./chat-textarea";

interface Props {
  sessionId: string;
}

export function AskUserDialog({ sessionId }: Props) {
  const { t } = useTranslation();
  const askUserRequests = useSessionAskUserRequests(sessionId);
  const [activeIndex, setActiveIndex] = useState(0);
  const [animState, setAnimState] = useState<"enter" | "idle" | "exit" | "hidden">("hidden");
  // 收起（下降）状态：折叠 description 与选项区，仅保留标题行，让下方聊天区露出来
  const [collapsed, setCollapsed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const currentRequest = askUserRequests ? askUserRequests[activeIndex] : null;

  // 请求切换时：复位收起状态
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setCollapsed(false);
  }, [currentRequest?.askUserId]);

  // 当 askUserRequests 变化时，管理排队和动画
  useEffect(() => {
    if (!askUserRequests || askUserRequests.length === 0) {
      // eslint-disable-next-line react/set-state-in-effect
      setAnimState("hidden");
      setActiveIndex(0);
      return;
    }

    // activeIndex 超出范围（最后一个被 resolve 了）→ 隐藏
    if (activeIndex >= askUserRequests.length) {
      setAnimState("exit");
      const timer = setTimeout(() => {
        setAnimState("hidden");
        setActiveIndex(0);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [askUserRequests, askUserRequests?.length, activeIndex]);

  // 单独处理 enter → idle 的动画过渡，避免 animState 变化导致 timer 被清除
  useEffect(() => {
    if (animState === "enter") {
      const timer = setTimeout(() => setAnimState("idle"), 300);
      return () => clearTimeout(timer);
    }
  }, [animState]);

  // hidden → enter 的触发：当有请求且当前隐藏时
  useEffect(() => {
    if (askUserRequests && askUserRequests.length > 0 && animState === "hidden") {
      // eslint-disable-next-line react/set-state-in-effect
      setAnimState("enter");
    }
  }, [askUserRequests, askUserRequests?.length, animState]);

  // 当前请求被 resolve 后，进入下一个
  const handleResolved = () => {
    setAnimState("exit");
    setTimeout(() => {
      setActiveIndex((i) => i + 1);
      setAnimState("enter");
      setTimeout(() => setAnimState("idle"), 300);
    }, 200);
  };

  if (animState === "hidden" || !currentRequest) return null;

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 z-20 flex flex-col justify-end pointer-events-auto transition-all duration-300 ease-out ${
        animState === "enter"
          ? "translate-y-4 opacity-0"
          : animState === "exit"
            ? "translate-y-4 opacity-0"
            : "translate-y-0 opacity-100"
      } ${collapsed ? "translate-y-full mb-35" : ""}`}
    >
      <div className="w-full max-w-6xl px-6 pb-4 mx-auto">
        {/*
          使用 CSS Grid 布局替代 flex 来解决高度链问题。
          grid-rows-[auto_1fr_auto] 的三行结构：
            - auto: title（固定高度）
            - 1fr : description（占满剩余空间，有 max-h 约束）
            - auto: options（固定高度）
          max-h-[90vh] 约束整体高度，1fr 行在内容超出时会获得明确高度，
          使内部的 ScrollArea → Viewport(height:100%) 高度链生效。
        */}
        <div
          ref={cardRef}
          role="dialog"
          aria-labelledby="ask-user-dialog-title"
          aria-describedby={currentRequest.description ? "ask-user-dialog-description" : undefined}
          onClick={() => setCollapsed(false)}
          className="grid grid-rows-[auto_1fr_auto] rounded-xl border border-border bg-card p-4 shadow-lg shadow-primary/5 max-h-[90vh]"
        >
          {/* 标题 — 固定不折叠 */}
          <div className="flex items-center gap-2 mb-3 min-h-0 overflow-hidden">
            <HelpCircle className="size-4.5 shrink-0 text-sky-500" />
            <h3 id="ask-user-dialog-title" className="text-sm font-medium leading-snug truncate">
              {currentRequest.title || t("askUser.title", "Request")}
            </h3>
            <div className="flex items-center ml-auto gap-1">
              {currentRequest.timeoutAt != null && (
                <AskUserCountdown timeoutAt={currentRequest.timeoutAt} />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6 rounded-md shrink-0 text-muted-foreground hover:bg-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsed((c) => !c);
                }}
                aria-label={
                  collapsed ? t("askUser.expand", "Expand") : t("askUser.collapse", "Collapse")
                }
                aria-expanded={!collapsed}
                title={
                  collapsed ? t("askUser.expand", "Expand") : t("askUser.collapse", "Collapse")
                }
              >
                {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </Button>
            </div>
          </div>

          {/* description — 可滚动 */}
          {currentRequest.description && (
            <div id="ask-user-dialog-description" className="min-h-0 overflow-hidden">
              <ScrollArea className="h-full rounded-md bg-muted/40">
                <div className="py-3 px-2">
                  <pre className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    <code>{formatDescription(currentRequest.description)}</code>
                  </pre>
                </div>
              </ScrollArea>
            </div>
          )}

          {/* 选项 / 输入 — 固定不折叠 */}
          <div className={cn("pt-3 min-h-0", collapsed ? "pointer-events-none" : "")}>
            <AskUserOptions
              key={currentRequest.askUserId}
              request={currentRequest}
              onResolved={handleResolved}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDescription(text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      return toYaml(parsed);
    }
  } catch {
    // not JSON, use as-is
  }
  return text;
}

/**
 * 文件选择 / 拖拽 / 补全的 #image / #file / #folder / #resource 标记统一复用 mention-utils 的
 * insertPathsAsMentions / absPathToMention / searchFileItemToSuggestItem，
 * 优先级与 chat-input 完全一致：图片 → #image:，项目内 → #file:/#folder:，项目外 → #resource:。
 */

function AskUserCountdown({ timeoutAt }: { timeoutAt: number }) {
  const { t } = useTranslation();
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, timeoutAt - Date.now()));

  useEffect(() => {
    const update = () => setRemainingMs(Math.max(0, timeoutAt - Date.now()));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [timeoutAt]);

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const urgent = totalSeconds <= 30;

  return (
    <span
      className={`ml-auto inline-flex shrink-0 items-center h-5 rounded-full px-1.5 text-[10px] font-mono tabular-nums leading-none ${
        urgent ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
      }`}
      title={t("askUser.autoClose", "Auto closes on timeout")}
    >
      <Clock className="size-3 mr-1 -ml-px" />
      <span>{minutes.toString().padStart(2, "0")}</span>
      <span className="text-[8px] mx-0.5">:</span>
      <span>{seconds.toString().padStart(2, "0")}</span>
    </span>
  );
}

/** 选项与「自定义回复」共用的按钮外壳，保证两者视觉一致 */
const ASK_USER_OPTION_CLASS =
  "relative flex w-full min-h-8 py-2 px-2 text-xs text-left rounded-lg border transition-all select-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 active:translate-y-px";
const ASK_USER_OPTION_IDLE_CLASS = "bg-secondary/50 hover:bg-secondary hover:text-foreground";
const ASK_USER_OPTION_HIGHLIGHT_CLASS = "ring-1 ring-sky-500 bg-sky-500/10 border-sky-500/30";
/**
 * 「自定义回复」沿用同一套外壳（尺寸 / 内边距 / 圆角 / 焦点环都一致，保证视觉对齐），
 * 但层级更弱：透明底 + 更浅的边框 + 次要文字色，避免抢走主选项的注意力。
 */
const ASK_USER_OTHER_CLASS =
  "bg-transparent text-muted-foreground border-border/60 hover:bg-secondary/40 hover:text-foreground";

/** 序号方块的通用外壳（尺寸 / 圆角 / 字号 / 对齐） */
const ASK_USER_BADGE_CLASS =
  "inline-flex size-5 items-center justify-center rounded text-[10px] font-mono shrink-0 self-start mt-0.5";
/** 序号方块按优先级递减醒目度：high > medium > low >（自定义回复见下） */
const ASK_USER_BADGE_PRIORITY_CLASS = {
  high: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  medium: "bg-foreground/15 text-foreground/85",
  low: "bg-muted-foreground/10 text-muted-foreground",
} satisfies Record<AskUserRequestOption["priority"], string>;
/** 自定义回复排在优先级序列之后，用最弱的一档 */
const ASK_USER_BADGE_OTHER_CLASS = "bg-muted-foreground/5 text-muted-foreground/60";

function AskUserOptions({
  request,
  onResolved,
}: {
  request: AskUserRequest;
  onResolved: () => void;
}) {
  const { t } = useTranslation();
  const hasOptions = request.options.length > 0;
  const showOther = request.allowCustomInput !== false;
  const [mode, setMode] = useState<"options" | "input">(hasOptions ? "options" : "input");
  const [inputValue, setInputValue] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [highlightedOther, setHighlightedOther] = useState(false);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const otherButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceInputRef = useRef<VoiceInputButtonRef>(null);
  // 数字键高亮反馈的延时句柄：再次按键以最后一次为准，卸载/依赖变化时清除
  const digitTimerRef = useRef<number | null>(null);

  const focusAskUser = useCallback(() => {
    const target = mode === "input" ? textareaRef.current : optionRefs.current[0];
    if (!target || target.disabled) return false;

    target.focus({ preventScroll: true });
    return document.activeElement === target;
  }, [mode]);
  useFocusTarget("ask-user-dialog", focusAskUser);

  const handleSelectOption = useCallback(
    (value: string) => {
      backend.request
        .respondAskUser({
          sessionId: request.sessionId,
          askUserId: request.askUserId,
          value,
        })
        .catch(() => {})
        .then(() => onResolved());
    },
    [request, onResolved],
  );

  // 数字键快捷键：1..n 选择选项，0 进入自定义回复（仅在选项模式且无输入框聚焦时触发）
  useEffect(() => {
    if (mode !== "options" || !hasOptions) return;
    const handler = (e: KeyboardEvent) => {
      // 带修饰键的组合键（Cmd/Ctrl/Alt+数字）不属于本快捷键；长按重复只响应首次
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      // 严格只接受单个数字，避免 parseInt 把 "1abc" 之类解析成数字
      if (!/^[0-9]$/.test(e.key)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable)
        return;
      const num = Number(e.key);
      const isOption = num >= 1 && num <= request.options.length;
      const isOther = num === 0 && showOther;
      if (!isOption && !isOther) return;
      e.preventDefault();
      setHighlightedIndex(isOption ? num - 1 : null);
      setHighlightedOther(isOther);
      // 200ms 高亮反馈后再执行；期间再次按键则取消上一次，避免并发响应
      if (digitTimerRef.current !== null) window.clearTimeout(digitTimerRef.current);
      digitTimerRef.current = window.setTimeout(() => {
        digitTimerRef.current = null;
        setHighlightedIndex(null);
        setHighlightedOther(false);
        if (isOther) setMode("input");
        else handleSelectOption(request.options[num - 1].value);
      }, 200);
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (digitTimerRef.current !== null) {
        window.clearTimeout(digitTimerRef.current);
        digitTimerRef.current = null;
      }
    };
  }, [mode, hasOptions, showOther, request.options, handleSelectOption]);

  // 否则作为自定义回复
  const handleSubmitInput = async () => {
    await voiceInputRef.current?.stop();
    const trimmed = resolveMentions(inputValue).trim();
    backend.request
      .respondAskUser({
        sessionId: request.sessionId,
        askUserId: request.askUserId,
        value: null,
        reason: trimmed || "",
      })
      .catch(() => {})
      .then(() => onResolved());
  };

  // 切换到输入模式时聚焦（@types/react-mentions 未声明 autoFocus，手动聚焦）
  useEffect(() => {
    if (mode !== "input") return;
    textareaRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode !== "options" || !hasOptions) return;
    const frame = window.requestAnimationFrame(() => optionRefs.current[0]?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [hasOptions, mode]);

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const { key } = event;
    // 空格会触发 button 的原生 click（等于确认选择），容易误触；确认只保留 Enter 与数字键
    if (key === " ") {
      event.preventDefault();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      event.stopPropagation();

      if (key === "Home") {
        optionRefs.current[0]?.focus();
      } else if (key === "End") {
        if (showOther) otherButtonRef.current?.focus();
        else optionRefs.current[request.options.length - 1]?.focus();
      } else if (key === "ArrowDown") {
        if (index < request.options.length - 1) {
          optionRefs.current[index + 1]?.focus();
        } else if (showOther) {
          otherButtonRef.current?.focus();
        }
      } else if (index > 0) {
        optionRefs.current[index - 1]?.focus();
      }
    }
  };

  const handleOtherKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    // 同选项：空格不作为确认触发，避免误触
    if (key === " ") {
      event.preventDefault();
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      optionRefs.current[request.options.length - 1]?.focus();
    } else if (key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      optionRefs.current[0]?.focus();
    }
  };

  return (
    <>
      {/* 选项模式 */}
      {mode === "options" && (
        <div className="flex flex-col gap-2">
          {request.options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              className={cn(
                ASK_USER_OPTION_CLASS,
                highlightedIndex === index
                  ? ASK_USER_OPTION_HIGHLIGHT_CLASS
                  : option.danger
                    ? "bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"
                    : ASK_USER_OPTION_IDLE_CLASS,
              )}
              onClick={() => handleSelectOption(option.value)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
            >
              <span className="inline-flex items-start gap-1.5 w-full">
                <span
                  className={cn(
                    ASK_USER_BADGE_CLASS,
                    ASK_USER_BADGE_PRIORITY_CLASS[option.priority],
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 whitespace-normal self-start py-1">
                  {option.label}
                </span>
              </span>
              <span className="absolute top-0.5 right-1 text-[9px] leading-none text-muted-foreground/30 shrink-0 self-start font-mono">
                {option.priority}
              </span>
            </button>
          ))}
          {showOther && (
            <button
              ref={otherButtonRef}
              type="button"
              className={cn(
                ASK_USER_OPTION_CLASS,
                highlightedOther ? ASK_USER_OPTION_HIGHLIGHT_CLASS : ASK_USER_OTHER_CLASS,
              )}
              onClick={() => setMode("input")}
              onKeyDown={handleOtherKeyDown}
            >
              <span className="inline-flex items-start gap-1.5 w-full">
                <span className={cn(ASK_USER_BADGE_CLASS, ASK_USER_BADGE_OTHER_CLASS)}>0</span>
                <span className="min-w-0 flex-1 whitespace-normal self-start py-1 pr-5">
                  {t("askUser.other", "Custom reply")}
                </span>
              </span>
              <Keyboard className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/40 shrink-0" />
            </button>
          )}
        </div>
      )}

      {/* 输入模式 */}
      {mode === "input" && (
        <div className="flex flex-col gap-2">
          {hasOptions && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start h-6 px-1 text-xs text-muted-foreground -ml-1"
              onClick={() => setMode("options")}
            >
              <ArrowLeft className="size-3" />
              <span>{t("askUser.back", "Use options")}</span>
            </Button>
          )}
          {/* variant="compact" 内含输入区底部留白与悬浮工具栏的定位 */}
          <ChatTextarea
            sessionId={request.sessionId}
            variant="compact"
            textValue={inputValue}
            onTextValueChange={setInputValue}
            attachments={null} // 没有附件概念：不渲染附件区，图片一律走 #image: mention
            inputRef={textareaRef}
            voiceInputRef={voiceInputRef}
            // 每次渲染重建：handleSubmitInput 依赖当前 inputValue
            onSubmit={() => void handleSubmitInput()}
            placeholder={t("askUser.inputPlaceholder", "Type your response... (Enter to send)")}
            // attachments 为 null → 命中的图片也只是 #image: mention，不会成为附件
            attachmentAccepts={IMAGE_MIME_TYPES}
            primaryAction={
              <Button
                size="icon"
                className="size-7 rounded-lg"
                onClick={handleSubmitInput}
                aria-label={t("askUser.submit", "Submit")}
              >
                <ArrowUp className="size-3.5" />
              </Button>
            }
          />
        </div>
      )}
    </>
  );
}
