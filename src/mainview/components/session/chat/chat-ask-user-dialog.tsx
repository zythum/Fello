import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSessionAskUserRequests } from "../../../lib/session-selectors";
import * as backend from "../../../backend";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HelpCircle, ArrowLeft, ArrowUp } from "lucide-react";
import { stringify as toYaml } from "json-to-pretty-yaml";
import type { AskUserRequest } from "../../../../shared/schema";

interface Props {
  sessionId: string;
}

export function AskUserDialog({ sessionId }: Props) {
  const { t } = useTranslation();
  const askUserRequests = useSessionAskUserRequests(sessionId);
  const [activeIndex, setActiveIndex] = useState(0);
  const [animState, setAnimState] = useState<"enter" | "idle" | "exit" | "hidden">("hidden");

  // 当 askUserRequests 变化时，管理排队和动画
  useEffect(() => {
    if (!askUserRequests || askUserRequests.length === 0) {
      // 全部处理完 → 隐藏
      setAnimState("hidden");
      setActiveIndex(0);
      return;
    }

    if (animState === "hidden") {
      // 首次出现
      setAnimState("enter");
      const timer = setTimeout(() => setAnimState("idle"), 300);
      return () => clearTimeout(timer);
    }

    // activeIndex 超出范围（最后一个被 resolve 了）→ 下一个或隐藏
    if (activeIndex >= askUserRequests.length) {
      setAnimState("exit");
      const timer = setTimeout(() => {
        setAnimState("hidden");
        setActiveIndex(0);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [askUserRequests, askUserRequests?.length, activeIndex]);

  const currentRequest = askUserRequests ? askUserRequests[activeIndex] : null;

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
      }`}
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
        <div className="grid grid-rows-[auto_1fr_auto] rounded-xl border border-border bg-card p-4 shadow-lg shadow-primary/5 max-h-[90vh] overflow-hidden">
          {/* 标题 — 固定不折叠 */}
          <div className="flex items-center gap-2 mb-3 min-h-0">
            <HelpCircle className="size-4.5 shrink-0 text-sky-500" />
            <h3 className="text-sm font-medium leading-snug truncate">
              {currentRequest.title || t("askUser.title", "Request")}
            </h3>
          </div>

          {/* description — 可滚动 */}
          {currentRequest.description && (
            <div className="min-h-0 overflow-hidden">
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
          <div className="pt-3 min-h-0">
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

  const handleSelectOption = (value: string) => {
    backend.request
      .respondAskUser({
        sessionId: request.sessionId,
        askUserId: request.askUserId,
        value,
      })
      .catch(() => {})
      .then(() => onResolved());
  };

  // 数字键快捷键选择选项（仅在选项模式且无输入框聚焦时触发）
  useEffect(() => {
    if (mode !== "options" || !hasOptions) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable)
        return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= request.options.length) {
        e.preventDefault();
        setHighlightedIndex(num - 1);
        setTimeout(() => {
          setHighlightedIndex(null);
          handleSelectOption(request.options[num - 1].value);
        }, 200);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, hasOptions, request.options]);

  // 否则作为自定义回复
  const handleSubmitInput = () => {
    const trimmed = inputValue.trim();
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitInput();
    }
  };

  return (
    <>
      {/* 选项模式 */}
      {mode === "options" && (
        <div className="flex flex-col gap-2">
          {request.options.map((option, index) => (
            <div
              key={option.value}
              role="button"
              tabIndex={0}
              className={`relative flex w-full min-h-8 py-2 px-2 text-xs text-left rounded-lg border transition-all select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px ${
                highlightedIndex === index
                  ? "ring-1 ring-sky-500 bg-sky-500/10 border-sky-500/30"
                  : option.danger
                    ? "bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"
                    : "bg-secondary/50 hover:bg-secondary hover:text-foreground"
              }`}
              onClick={() => handleSelectOption(option.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelectOption(option.value);
                }
              }}
            >
              <span className="inline-flex items-start gap-1.5 w-full">
                <span className="inline-flex size-5 items-center justify-center rounded bg-muted-foreground/10 text-[10px] font-mono shrink-0 self-start mt-0.5">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 whitespace-normal self-start py-1">
                  {option.label}
                </span>
              </span>
              <div className="absolute top-0.5 right-1 text-[9px] leading-none text-muted-foreground/30 shrink-0 self-start font-mono">
                {option.priority}
              </div>
            </div>
          ))}
          {showOther && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start h-8 px-3 text-xs text-muted-foreground mt-1"
              onClick={() => setMode("input")}
            >
              {t("askUser.other", "Other...")}
            </Button>
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
              <ArrowLeft className="size-3.5 mr-1" />
              {t("askUser.back", "Back")}
            </Button>
          )}
          <div className="rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-ring relative">
            <Textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("askUser.inputPlaceholder", "Type your response... (Enter to send)")}
              className="min-h-19 max-h-50 block resize-none border-none shadow-none focus-visible:ring-0 leading-relaxed p-2 pb-8 text-foreground/80 placeholder:text-muted-foreground/50 break-all"
              autoFocus
            />
            <div className="absolute bottom-1.5 right-1.5">
              <Button
                size="icon"
                className="size-7 rounded-lg"
                onClick={handleSubmitInput}
                aria-label={t("askUser.submit", "Submit")}
              >
                <ArrowUp className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
