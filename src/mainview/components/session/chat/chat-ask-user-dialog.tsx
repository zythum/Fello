import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSessionState } from "../../../store";
import * as backend from "../../../backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpCircle, ArrowLeft } from "lucide-react";
import { stringify as toYaml } from "json-to-pretty-yaml";
import type { AskUserRequest } from "../../../../shared/schema";

interface Props {
  sessionId: string;
}

export function AskUserDialog({ sessionId }: Props) {
  const { t } = useTranslation();
  const { askUserRequests } = useSessionState(sessionId);
  const [activeIndex, setActiveIndex] = useState(0);
  const [animState, setAnimState] = useState<"enter" | "idle" | "exit" | "hidden">("hidden");

  // 当 askUserRequests 变化时，管理排队和动画
  useEffect(() => {
    if (askUserRequests.length === 0) {
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
  }, [askUserRequests, askUserRequests.length, activeIndex]);

  const currentRequest = askUserRequests[activeIndex];

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
      <div className="mx-auto w-full max-w-5xl px-6 pb-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-lg shadow-primary/5">
          {/* 标题 */}
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="size-4.5 shrink-0 text-sky-500" />
            <h3 className="text-sm font-medium leading-snug truncate">
              {currentRequest.title || t("askUser.title", "Request")}
            </h3>
          </div>
          {currentRequest.description && (
            <pre className="text-xs text-muted-foreground my-3 overflow-x-auto rounded-md bg-muted/40 p-2 leading-relaxed whitespace-pre-wrap">
              <code>{formatDescription(currentRequest.description)}</code>
            </pre>
          )}

          <AskUserOptions
            key={currentRequest.askUserId}
            request={currentRequest}
            onResolved={handleResolved}
          />
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
                option.danger
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
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("askUser.inputPlaceholder", "Type your response...")}
              className="h-8 text-xs"
              autoFocus
            />
            <Button size="sm" className="h-8 text-xs shrink-0" onClick={handleSubmitInput}>
              {t("askUser.submit", "Submit")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
