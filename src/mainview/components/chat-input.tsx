import { useState, useRef, useCallback, useEffect } from "react";
import { MentionsInput, Mention } from "react-mentions";
import { useAppStore, useActiveSessionState, type ChatMessage, type SessionInfo } from "../store";
import { request, subscribe } from "../backend";
import { flushStreaming } from "../lib/process-event";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUp, Square, Zap, Folder } from "lucide-react";

/** Markup format used by react-mentions: @[display](id) */
const MENTION_MARKUP = "@[__display__](__id__)";
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Replace all mention markup with the raw absolute path */
function resolveMentions(value: string): string {
  return value.replace(MENTION_REGEX, (_match, _display: string, id: string) => id);
}

export function ChatInput() {
  const [input, setInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    sessions,
    activeSessionId,
    isConnecting,
    addMessage,
    setIsStreaming,
    clearToolCalls,
    availableModels,
    currentModelId,
    setCurrentModelId,
    setSessions,
  } = useAppStore();
  const { isStreaming, usage } = useActiveSessionState();

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;

  /** Fetch file suggestions from backend (called by react-mentions on each keystroke) */
  const fetchFileSuggestions = useCallback(
    (search: string, callback: (data: Array<{ id: string; display: string }>) => void) => {
      if (!session) {
        callback([]);
        return;
      }
      request
        .searchFiles({ cwd: session.cwd, query: search || undefined })
        .then((results) => callback(results as Array<{ id: string; display: string }>))
        .catch(() => callback([]));
    },
    [session],
  );

  const handleChangeCwd = useCallback(async () => {
    if (!session) return;
    try {
      const result = (await request.changeWorkDir({ sessionId: session.id })) as {
        ok: boolean;
        cwd: string | null;
      };
      if (result.ok && result.cwd) {
        const updated = ((await request.listSessions()) as SessionInfo[]) ?? [];
        setSessions(updated);
      }
    } catch (err) {
      console.error("Failed to change work dir:", err);
    }
  }, [session, setSessions]);

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
          flushStreaming(sid);
          useAppStore.getState().setIsStreaming(sid, false);
          useAppStore.getState().addMessage(sid, {
            role: "system",
            content: "Agent stopped responding (timed out after 30s).",
          });
        }
      }, STREAMING_TIMEOUT_MS);
    };
    subscribe.on("session-update", handleUpdate);
    return () => subscribe.off("session-update", handleUpdate);
  }, [clearStreamingTimer]);

  const handleSubmit = useCallback(async () => {
    const resolved = resolveMentions(input).trim();
    if (!resolved || !activeSessionId || isStreaming) return;

    setInput("");
    addMessage(activeSessionId, { role: "user", content: resolved });
    setIsStreaming(activeSessionId, true);
    clearToolCalls(activeSessionId);

    // Start the streaming inactivity timeout
    clearStreamingTimer();
    streamingTimer.current = setTimeout(() => {
      if (useAppStore.getState().getSessionState(activeSessionId).isStreaming) {
        flushStreaming(activeSessionId);
        useAppStore.getState().setIsStreaming(activeSessionId, false);
        useAppStore.getState().addMessage(activeSessionId, {
          role: "system",
          content: "Agent stopped responding (timed out after 30s).",
        });
      }
    }, STREAMING_TIMEOUT_MS);

    try {
      await request.sendMessage(resolved);
      flushStreaming(activeSessionId);

      const messages = useAppStore.getState().getSessionState(activeSessionId).messages;
      if (messages.filter((m: ChatMessage) => m.role === "user").length === 1) {
        const title = resolved.length > 40 ? resolved.slice(0, 40) + "..." : resolved;
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
      clearStreamingTimer();
      setIsStreaming(activeSessionId, false);
    }
  }, [
    input,
    activeSessionId,
    isStreaming,
    addMessage,
    setIsStreaming,
    clearToolCalls,
    clearStreamingTimer,
  ]);

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

  const disabled = !activeSessionId || isConnecting;

  return (
    <div className="border-t border-border p-3">
      <div className="mx-auto max-w-3xl">
        <div
          ref={containerRef}
          className={`rounded-xl border bg-card shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring ${
            isDragOver ? "border-primary ring-1 ring-primary bg-primary/5" : "border-input"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {/* MentionsInput */}
          <MentionsInput
            value={input}
            onChange={(_e, newValue) => setInput(newValue)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled ? "Start a new chat to begin..." : "Ask anything... (Enter to send)"
            }
            disabled={disabled}
            aria-label="Message input"
            style={mentionsInputStyle}
            allowSuggestionsAboveCursor
            a11ySuggestionsListLabel="Suggestions"
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
            className="flex cursor-text items-center gap-2 px-2 pb-2"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest("button, select, [role='combobox']")) return;
              containerRef.current?.querySelector("textarea")?.focus();
            }}
          >
            {session && (
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                title={`${session.cwd} (click to change)`}
                onClick={handleChangeCwd}
              >
                <Folder className="size-3 shrink-0" />
                <span className="max-w-[200px] truncate">
                  {(() => {
                    const parts = session.cwd.split("/").filter(Boolean);
                    if (parts.length <= 5) return session.cwd;
                    return "/" + [...parts.slice(0, 2), "...", ...parts.slice(-2)].join("/");
                  })()}
                </span>
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
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
                  className="size-7 cursor-default rounded-lg"
                  onClick={() => request.cancelPrompt()}
                  aria-label="Stop"
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
                    aria-label="Send"
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
    fontSize: 14,
    lineHeight: "1.5",
  },
  "&multiLine": {
    control: {
      minHeight: 36,
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
      fontSize: 14,
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
  borderRadius: 4,
  padding: "1px 1px",
  margin: "-1px -1px",
};
