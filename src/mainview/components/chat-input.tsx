import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { MentionsInput, Mention } from "react-mentions";
import { useAppStore, useActiveSessionState } from "../store";
import type { ChatMessage } from "../chat-message";
import { request, subscribe } from "../backend";
import { reduceFlushStreaming } from "../lib/session-state-reducer";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUp, Square } from "lucide-react";
import { extractErrorMessage } from "@/lib/utils";

/** Markup format used by react-mentions: @[display](id) */
const MENTION_MARKUP = "@[__display__](__id__)";
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Replace all mention markup with the raw absolute path */
function resolveMentions(value: string): string {
  return value.replace(MENTION_REGEX, (_match, _display: string, id: string) => id);
}

const getSummaryTitle = (text: string) => {
  return text.length > 40 ? text.slice(0, 40) + "..." : text;
};

export function ChatInput() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sessions, activeSessionId, addMessage, setIsStreaming } = useAppStore();
  const { isStreaming, availableModels, currentModelId, availableModes, currentModeId } =
    useActiveSessionState();

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;

  /** Fetch file suggestions from backend (called by react-mentions on each keystroke) */
  const fetchFileSuggestions = useCallback(
    (search: string, callback: (data: Array<{ id: string; display: string }>) => void) => {
      const projectId = session?.projectId;
      if (!projectId) {
        callback([]);
        return;
      }
      request
        .searchFiles({ projectId, query: search || undefined })
        .then((results) => callback(results as Array<{ id: string; display: string }>))
        .catch(() => callback([]));
    },
    [session],
  );

  const STREAMING_TIMEOUT_MS = 30_000;
  const streamingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStreamingTimer = useCallback(() => {
    if (streamingTimer.current) {
      clearTimeout(streamingTimer.current);
      streamingTimer.current = null;
    }
  }, []);

  // Reset the streaming timeout whenever a session update arrives
  useEffect(() => {
    const handleUpdate = () => {
      if (!streamingTimer.current) return;
      clearStreamingTimer();
      streamingTimer.current = setTimeout(() => {
        const sid = useAppStore.getState().activeSessionId;
        if (sid && useAppStore.getState().getSessionState(sid).isStreaming) {
          const currentState = useAppStore.getState().getSessionState(sid);
          useAppStore.getState().updateSessionState(sid, () => reduceFlushStreaming(currentState));
          useAppStore.getState().addMessage(sid, {
            role: "system_message",
            contents: [
              {
                type: "text",
                text: t(
                  "chatInput.timeoutError",
                  "Agent stopped responding (timed out after 30s).",
                ),
              },
            ],
          });
        }
      }, STREAMING_TIMEOUT_MS);
    };
    subscribe.on("session-update", handleUpdate);
    return () => subscribe.off("session-update", handleUpdate);
  }, [clearStreamingTimer]);

  const loadHistorySessions = async () => {
    try {
      const result = await request.listSessions();
      useAppStore.getState().setSessions((result as never[]) ?? []);
    } catch (error) {
      console.error("Failed to load sessions", error);
    }
  };

  const handleSubmit = useCallback(async () => {
    const resolved = resolveMentions(input).trim();
    if (!resolved || !activeSessionId || isStreaming) return;

    const optimisticId = crypto.randomUUID();
    const userMessage = {
      role: "user_message",
      contents: [{ type: "text", text: resolved }],
      _meta: { optimistic_id: optimisticId },
    } satisfies ChatMessage;

    // 1. Optimistic Update: clear input and add message to screen instantly
    setInput("");
    addMessage(activeSessionId, userMessage);
    setIsStreaming(activeSessionId, true);

    // Start the streaming inactivity timeout
    clearStreamingTimer();
    streamingTimer.current = setTimeout(() => {
      if (useAppStore.getState().getSessionState(activeSessionId).isStreaming) {
        const currentState = useAppStore.getState().getSessionState(activeSessionId);
        useAppStore
          .getState()
          .updateSessionState(activeSessionId, () => reduceFlushStreaming(currentState));
        useAppStore.getState().addMessage(activeSessionId, {
          role: "system_message",
          contents: [
            {
              type: "text",
              text: t("chatInput.timeoutError", "Agent stopped responding (timed out after 30s)."),
            },
          ],
        });
      }
    }, STREAMING_TIMEOUT_MS);

    try {
      // 2. Fire and Forget (wait for network only, UI is already updated)
      await request.sendMessage({
        sessionId: activeSessionId,
        text: resolved,
        _meta: { optimistic_id: optimisticId },
      });
    } catch (err) {
      // 3. Rollback on Network Failure
      // Only rollback if the message is STILL optimistic (meaning backend never echoed it back).
      // If it was echoed, the optimistic flag was stripped by the reducer, and it's a real message now.
      const currentState = useAppStore.getState().getSessionState(activeSessionId);
      const isStillOptimistic = currentState.messages.some(
        (m) => m._meta?.optimistic_id === optimisticId,
      );

      if (isStillOptimistic) {
        console.error("Prompt error (network failure):", err);

        // Remove the optimistically added message
        const newMessages = currentState.messages.filter(
          (m) => m._meta?.optimistic_id !== optimisticId,
        );
        useAppStore
          .getState()
          .updateSessionState(activeSessionId, () => ({ messages: newMessages }));
      } else {
        // Backend received the user message, but Agent failed to generate a response.
        console.error("Prompt error (generation failure):", err);
        useAppStore.getState().addMessage(activeSessionId, {
          role: "system_message",
          contents: [
            {
              type: "text",
              text: `${t("message.errorTitle", "Error")}: ${extractErrorMessage(err) || t("chatInput.generationFailed", "Generation failed")}`,
            },
          ],
        } satisfies ChatMessage);
      }
    } finally {
      // 4. Final cleanup
      clearStreamingTimer();
      const currentState = useAppStore.getState().getSessionState(activeSessionId);

      // Force finalize streaming if we were in a streaming state
      if (currentState.isStreaming) {
        useAppStore
          .getState()
          .updateSessionState(activeSessionId, () => reduceFlushStreaming(currentState));
      }

      // 5. Update Title if it's the first message
      // We check this in finally to ensure it runs even if stream is interrupted
      const messages = useAppStore.getState().getSessionState(activeSessionId).messages;
      if (messages.filter((m: ChatMessage) => m.role === "user_message").length === 1) {
        await request
          .updateSessionTitle({
            sessionId: activeSessionId,
            title: getSummaryTitle(resolved),
          })
          .catch((e) => console.error("Failed to update title", e));
        loadHistorySessions();
      }
    }
  }, [input, activeSessionId, isStreaming, addMessage, setIsStreaming, clearStreamingTimer]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  /** Insert mention markup for each dropped tree node */
  const handleDrop = useCallback((e: React.DragEvent) => {
    const raw = e.dataTransfer.getData("application/x-fello-tree-nodes");
    if (!raw) return; // not from file-tree, ignore
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    try {
      const nodes: { id: string; name: string; isFolder: boolean }[] = JSON.parse(raw);
      if (nodes.length === 0) return;
      const mentions = nodes.map((n) => `@[${n.name}](${n.id})`).join(" ");
      setInput((prev) => (prev ? `${prev} ${mentions} ` : `${mentions} `));

      // Focus the textarea after drop
      requestAnimationFrame(() => {
        containerRef.current?.querySelector("textarea")?.focus();
      });
    } catch {
      // ignore malformed data
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Must always preventDefault on dragover to allow drop
    if (e.dataTransfer.types.includes("application/x-fello-tree-nodes")) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      // Clear any pending drag-leave timeout (child→child transitions fire leave+enter)
      if (dragLeaveTimer.current) {
        clearTimeout(dragLeaveTimer.current);
        dragLeaveTimer.current = null;
      }
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Debounce to avoid flicker when moving between child elements
    dragLeaveTimer.current = setTimeout(() => setIsDragOver(false), 50);
  }, []);

  const { isLoading } = useActiveSessionState();
  const disabled = !activeSessionId || isLoading;

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData("text/plain");
      if (!text || !session) return;

      const trimmed = text.trim();
      if (trimmed.includes("\n") || trimmed.length > 1024) return;

      const target = e.target as HTMLElement;
      if (target.tagName !== "TEXTAREA") return;
      const textarea = target as HTMLTextAreaElement;

      const isLikelyPath = trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes(".");
      if (!isLikelyPath) return;

      // We only want to intercept if it might be a path.
      // To avoid blocking the UI, we prevent default and stop propagation, then do async check.
      e.preventDefault();
      e.stopPropagation();

      (async () => {
        let insertText = text;
        try {
          // Attempt to resolve as absolute or relative path
          const isAbsolutePath = trimmed.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(trimmed);
          const absPath = isAbsolutePath
            ? trimmed
            : await request.getSystemFilePath({
                projectId: session.projectId,
                path: trimmed,
                isAbsolute: true,
              });

          const relPath = await request.getSystemFilePath({
            projectId: session.projectId,
            path: trimmed,
            isAbsolute: false,
          });
          const info = await request.getFileInfo({
            projectId: session.projectId,
            relativePath: relPath,
          });
          if (info) {
            const name = relPath.replace(/\\/g, "/").split("/").pop() || relPath;
            insertText = `@[${name}](${absPath}) `;
          }
        } catch {
          // ignore
        }

        // Restore focus and insert text natively so MentionsInput catches the onChange
        textarea.focus();
        document.execCommand("insertText", false, insertText);
      })();
    },
    [session],
  );

  return (
    <div className="border-t border-border p-3">
      <div className="mx-auto max-w-3xl">
        <div
          ref={containerRef}
          className={`rounded-xl border bg-card shadow-sm transition-colors focus-within:border-ring focus-within:ring-ring ${
            isDragOver ? "border-primary ring-0.5 ring-primary bg-primary/5" : "border-input"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onPasteCapture={handlePaste}
        >
          {/* MentionsInput */}
          <MentionsInput
            value={input}
            onChange={(_e, newValue) => setInput(newValue)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled ? t("chatInput.placeholderDisabled") : t("chatInput.placeholderActive")
            }
            disabled={disabled}
            aria-label={t("chatInput.messageInput", "Message input")}
            style={mentionsInputStyle}
            allowSuggestionsAboveCursor
            a11ySuggestionsListLabel={t("chatInput.suggestions", "Suggestions")}
          >
            <Mention
              trigger="#"
              data={fetchFileSuggestions}
              markup={MENTION_MARKUP}
              displayTransform={(_id, display) => `#${display}`}
              style={mentionStyle}
              appendSpaceOnAdd
            />
          </MentionsInput>
          {/* Bottom bar: model selector + send button */}
          <div
            className="flex cursor-text items-center justify-between gap-2 px-2 pb-2"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest("button, select, [role='combobox']")) return;
              containerRef.current?.querySelector("textarea")?.focus();
            }}
          >
            <div className="flex items-center gap-2">
              {availableModes.length > 0 && (
                <>
                  <Select
                    value={currentModeId ?? ""}
                    onValueChange={async (modeId) => {
                      const sid = useAppStore.getState().activeSessionId;
                      if (!sid) return;
                      useAppStore
                        .getState()
                        .updateSessionState(sid, () => ({ currentModeId: modeId as string }));
                      try {
                        await request.setMode({
                          sessionId: sid,
                          modeId: modeId as string,
                        });
                      } catch (err) {
                        console.error("Failed to set mode:", err);
                      }
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-6 w-auto bg-transparent text-xs text-muted-foreground hover:text-foreground"
                    >
                      <SelectValue placeholder={t("chatInput.mode", "Mode")} />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false} className="w-60 p-1">
                      {availableModes.map((mode) => (
                        <SelectItem
                          className="rounded-1 text-xs text-muted-foreground/90"
                          key={mode.id}
                          value={mode.id}
                        >
                          <div className="flex min-w-0 flex-col gap-1 whitespace-normal">
                            <span>{mode.name}</span>
                            <span className="wrap-break-word text-[10px] text-muted-foreground/50 line-clamp-2">
                              {mode.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {availableModels.length > 0 ? (
                <Select
                  value={currentModelId ?? ""}
                  onValueChange={async (modelId) => {
                    const sid = useAppStore.getState().activeSessionId;
                    if (!sid) return;
                    useAppStore
                      .getState()
                      .updateSessionState(sid, () => ({ currentModelId: modelId as string }));
                    try {
                      await request.setModel({
                        sessionId: sid,
                        modelId: modelId as string,
                      });
                    } catch (err) {
                      console.error("Failed to set model:", err);
                    }
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-6 w-auto bg-transparent text-xs text-muted-foreground hover:text-foreground"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} className="w-60 p-1">
                    {availableModels.map((m) => (
                      <SelectItem
                        className="rounded-1 text-xs text-muted-foreground/90"
                        key={m.modelId}
                        value={m.modelId}
                      >
                        <div className="flex min-w-0 flex-col gap-1 whitespace-normal">
                          <span>{m.name}</span>
                          <span className="wrap-break-word text-[10px] text-muted-foreground/45 line-clamp-2">
                            {m.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {isStreaming ? (
                <Button
                  variant="destructive"
                  size="icon"
                  className="size-7 cursor-default rounded-lg"
                  onClick={() => request.cancelPrompt({ sessionId: activeSessionId! })}
                  aria-label={t("chatInput.stop", "Stop")}
                >
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <span className="cursor-default">
                  <Button
                    size="icon"
                    className="size-7 rounded-lg"
                    onClick={handleSubmit}
                    disabled={disabled || !input.trim()}
                    aria-label={t("chatInput.send", "Send")}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Inline styles for MentionsInput to match the existing textarea look */
const mentionsInputStyle = {
  control: {
    fontSize: 13,
    lineHeight: "1.5",
  },
  "&multiLine": {
    control: {
      minHeight: 76,
    },
    highlighter: {
      padding: "12px 16px 8px",
      border: "none",
    },
    input: {
      padding: "12px 16px 8px",
      border: "none",
      outline: "none",
      overflow: "auto",
      maxHeight: 200,
      color: "var(--foreground)",
      fontSize: 13,
      lineHeight: "1.5",
    },
  },
  suggestions: {
    backgroundColor: "transparent",
    list: {
      backgroundColor: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      fontSize: 13,
      overflow: "hidden",
    },
    item: {
      padding: "6px 12px",
      "&focused": {
        backgroundColor: "var(--accent)",
      },
    },
  },
};

const mentionStyle = {
  backgroundColor: "color-mix(in srgb, var(--primary) 15%, transparent)",
  boxShadow: "0 0 0 0.5px var(--border)",
  borderRadius: 4,
  margin: -1,
  padding: 1,
};
