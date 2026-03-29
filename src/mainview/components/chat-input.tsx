import { useState, useRef, useCallback } from "react";
import { useAppStore, useActiveSessionState, type ChatMessage } from "../store";
import { request } from "../backend";
import { flushStreaming } from "../lib/process-event";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUp, Square, Zap } from "lucide-react";

export function ChatInput() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    activeSessionId,
    isConnecting,
    addMessage,
    setIsStreaming,
    clearToolCalls,
    availableModels,
    currentModelId,
    setCurrentModelId,
  } = useAppStore();
  const { isStreaming, usage } = useActiveSessionState();

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeSessionId || isStreaming) return;

    setInput("");
    addMessage(activeSessionId, { role: "user", content: text });
    setIsStreaming(activeSessionId, true);
    clearToolCalls(activeSessionId);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      await request.sendMessage(text);
      flushStreaming(activeSessionId);

      const messages = useAppStore.getState().getSessionState(activeSessionId).messages;
      if (messages.filter((m: ChatMessage) => m.role === "user").length === 1) {
        const title = text.length > 40 ? text.slice(0, 40) + "..." : text;
        await request.updateSessionTitle({ sessionId: activeSessionId, title });
        const sessions = await request.listSessions();
        useAppStore.getState().setSessions((sessions as never[]) ?? []);
      }
    } catch (err) {
      console.error("Prompt error:", err);
      addMessage(activeSessionId, {
        role: "system",
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsStreaming(activeSessionId, false);
    }
  }, [input, activeSessionId, isStreaming, addMessage, setIsStreaming, clearToolCalls]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  const disabled = !activeSessionId || isConnecting;

  return (
    <div className="border-t border-border p-3">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-input bg-card shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled ? "Start a new chat to begin..." : "Ask anything... (Enter to send)"
            }
            disabled={disabled}
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
            aria-label="Message input"
          />
          {/* Bottom bar: model selector + send button */}
          <div className="flex items-center justify-end gap-2 px-2 pb-2">
            {usage && (
              <span
                className="flex items-center gap-1 text-[10px] text-muted-foreground"
                title={`In: ${usage.inputTokens} Out: ${usage.outputTokens} Total: ${usage.totalTokens}${usage.thoughtTokens ? ` Think: ${usage.thoughtTokens}` : ""}`}
              >
                <Zap className="size-3" />
                {((usage.totalTokens ?? 0) / 1000).toFixed(1)}k tokens
              </span>
            )}
            {availableModels.length > 0 ? (
              <Select
                value={currentModelId ?? ""}
                onValueChange={async (modelId) => {
                  setCurrentModelId(modelId as string);
                  try {
                    await request.setModel(modelId as string);
                  } catch (err) {
                    console.error("Failed to set model:", err);
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-6 w-auto border-none bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((m) => (
                    <SelectItem key={m.modelId} value={m.modelId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {isStreaming ? (
              <Button
                variant="destructive"
                size="icon"
                className="size-7 rounded-lg"
                onClick={() => request.cancelPrompt()}
                aria-label="Stop"
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="size-7 rounded-lg"
                onClick={handleSubmit}
                disabled={disabled || !input.trim()}
                aria-label="Send"
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
