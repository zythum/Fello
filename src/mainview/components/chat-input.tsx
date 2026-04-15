import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { MentionsInput, Mention } from "react-mentions";
import { useAppStore, useActiveSessionState } from "../store";
import type { ChatMessage } from "../chat-message";
import { request } from "../backend";
import { reduceFlushStreaming } from "../lib/session-state-reducer";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUp, Square, Paperclip, X, Image as ImageIcon, FileText } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { extractErrorMessage } from "@/lib/utils";
import type { ContentBlock } from "@agentclientprotocol/sdk";

// Define an interface for the staged file
interface StagedAttachment {
  id: string;
  file: File;
  type: "image" | "file";
  previewUrl?: string; // object URL for images
}

async function processAttachments(staged: StagedAttachment[]): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  for (const att of staged) {
    if (att.type === "image") {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Format: data:image/png;base64,...
          const b64 = result.split(",")[1];
          resolve(b64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(att.file);
      });
      blocks.push({
        type: "image",
        mimeType: att.file.type,
        data: base64,
      });
    } else {
      // For text files, read as text and send as embedded resource
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(att.file);
      });
      blocks.push({
        type: "resource",
        resource: {
          uri: `file://${att.file.name}`,
          text,
        },
      });
    }
  }
  return blocks;
}

/** Markup format used by react-mentions: @[display](id) */
const MENTION_MARKUP = "@[__display__](__id__)";
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Replace all mention markup with the raw absolute path */
function resolveMentions(value: string): string {
  return value.replace(MENTION_REGEX, (_match, _display: string, id: string) => id);
}

export function ChatInput() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sessions, activeSessionId, addMessage, setIsStreaming } = useAppStore();
  const { isStreaming, availableModels, currentModelId, availableModes, currentModeId, agentInfo } =
    useActiveSessionState();

  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const attachmentsRef = useRef<StagedAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync attachments to ref for cleanup
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Cleanup object URLs to avoid memory leaks when component unmounts
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((att) => {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      });
    };
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newAttachments = files.map((file) => {
      const isImage = file.type.startsWith("image/");

      let type: "image" | "file" = "file";
      if (isImage && agentInfo?.agentCapabilities?.promptCapabilities?.image) {
        type = "image";
      }

      return {
        id: crypto.randomUUID(),
        file,
        type,
        previewUrl: type === "image" ? URL.createObjectURL(file) : undefined,
      } satisfies StagedAttachment;
    });
    setAttachments((prev) => [...prev, ...newAttachments]);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

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
        .then((results) => callback(results))
        .catch(() => callback([]));
    },
    [session],
  );

  const handleSubmit = useCallback(async () => {
    const displayId = crypto.randomUUID();
    const resolved = resolveMentions(input).trim();
    if ((!resolved && attachments.length === 0) || !activeSessionId || isStreaming) return;

    // Process attachments before sending
    let attachmentBlocks: ContentBlock[] = [];
    if (attachments.length > 0) {
      try {
        attachmentBlocks = await processAttachments(attachments);
      } catch (err) {
        console.error("Failed to process attachments", err);
        return; // Handle error appropriately
      }
    }

    const contents: ContentBlock[] = [];
    if (resolved) {
      contents.push({
        type: "text",
        text: resolved,
        _meta: {
          display_id: displayId,
          optimistic_id: crypto.randomUUID(),
        },
      });
    }
    contents.push(
      ...attachmentBlocks.map((block) => {
        return Object.assign(
          {
            _meta: {
              display_id: displayId,
              optimistic_id: crypto.randomUUID(),
            },
          },
          block,
        );
      }),
    );

    const userMessage = {
      role: "user_message",
      contents,
      displayId: displayId,
    } satisfies ChatMessage;

    // 1. Optimistic Update: clear input and add message to screen instantly
    setInput("");
    setAttachments((current) => {
      // Clean up URLs for submitted attachments
      current.forEach((att) => {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      });
      return [];
    });
    addMessage(activeSessionId, userMessage);

    try {
      // 2. Wait for the generation to complete
      await request.sendMessage({
        sessionId: activeSessionId,
        contents,
      });

      // 3. Generation completed successfully.
      // The backend has already broadcasted isStreaming: false via session_info_update.
    } catch (err) {
      // 4. Rollback on Network Failure
      const currentState = useAppStore.getState().getSessionState(activeSessionId);
      const isStillOptimistic = currentState.messages.some((m) => m.displayId === displayId);

      if (isStillOptimistic) {
        console.error("Prompt error (network failure):", err);
        const newMessages = currentState.messages.filter((m) => m.displayId !== displayId);
        useAppStore
          .getState()
          .updateSessionState(activeSessionId, () => ({ messages: newMessages }));
      } else {
        console.error("Prompt error (generation failure):", err);
        useAppStore.getState().addMessage(activeSessionId, {
          role: "system_message",
          kind: "error",
          contents: [
            `${t("message.errorTitle", "Error")}: ${extractErrorMessage(err) || t("chatInput.generationFailed", "Generation failed")}`,
          ],
          displayId: crypto.randomUUID(),
        } satisfies ChatMessage);
      }
      // If an error occurs, the backend might have crashed or network failed before
      // broadcasting the isStreaming: false event. So we ensure it is cleaned up locally.
      useAppStore
        .getState()
        .updateSessionState(activeSessionId, () => reduceFlushStreaming(currentState));
    }
  }, [input, attachments, activeSessionId, isStreaming, addMessage, setIsStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  /** Insert mention markup for each dropped tree node or add files as attachments */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const supportsImage = agentInfo?.agentCapabilities?.promptCapabilities?.image;
      const supportsEmbedded = agentInfo?.agentCapabilities?.promptCapabilities?.embeddedContext;
      const supportsFiles = supportsImage || supportsEmbedded;

      // Handle files drop
      if (supportsFiles && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files).filter((file) => {
          const isImage = file.type.startsWith("image/");
          if (isImage) return supportsImage;
          return supportsEmbedded;
        });

        if (files.length > 0) {
          const newAttachments = files.map((file) => {
            const isImage = file.type.startsWith("image/");
            const type = isImage && supportsImage ? "image" : "file";
            return {
              id: crypto.randomUUID(),
              file,
              type,
              previewUrl: type === "image" ? URL.createObjectURL(file) : undefined,
            } satisfies StagedAttachment;
          });
          setAttachments((prev) => [...prev, ...newAttachments]);
          return;
        }
      }

      // Handle tree nodes drop
      const raw = e.dataTransfer.getData("application/x-fello-tree-nodes");
      if (!raw) return; // not from file-tree, ignore

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
    },
    [agentInfo?.agentCapabilities?.promptCapabilities],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      const supportsFiles =
        agentInfo?.agentCapabilities?.promptCapabilities?.embeddedContext ||
        agentInfo?.agentCapabilities?.promptCapabilities?.image;

      // Must always preventDefault on dragover to allow drop
      if (
        e.dataTransfer.types.includes("application/x-fello-tree-nodes") ||
        (supportsFiles && e.dataTransfer.types.includes("Files"))
      ) {
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
    },
    [agentInfo?.agentCapabilities?.promptCapabilities],
  );

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
          {/* Top Preview Area */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 pb-0">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="relative flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs"
                >
                  {att.type === "image" ? (
                    <HoverCard>
                      <HoverCardTrigger
                        render={
                          <div className="flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground">
                            <ImageIcon className="size-3.5" />
                            <span className="max-w-[100px] truncate">{att.file.name}</span>
                          </div>
                        }
                      />
                      <HoverCardContent className="w-auto p-1" side="top">
                        <img
                          src={att.previewUrl}
                          alt={att.file.name}
                          className="max-h-[200px] max-w-[200px] rounded object-contain"
                        />
                      </HoverCardContent>
                    </HoverCard>
                  ) : (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <FileText className="size-3.5" />
                      <span className="max-w-[100px] truncate">{att.file.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

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
                      if (modeId === null) {
                        return;
                      }
                      const sid = useAppStore.getState().activeSessionId;
                      if (!sid) return;
                      useAppStore
                        .getState()
                        .updateSessionState(sid, () => ({ currentModeId: modeId }));
                      try {
                        await request.setMode({
                          sessionId: sid,
                          modeId: modeId,
                        });
                      } catch (err) {
                        console.error("Failed to set mode:", err);
                      }
                    }}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue placeholder={t("chatInput.mode", "Mode")} />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false} className="w-60">
                      {availableModes.map((mode) => (
                        <SelectItem key={mode.id} value={mode.id}>
                          <div className="flex min-w-0 flex-col gap-1 whitespace-normal">
                            <span>{mode.name}</span>
                            <span className="wrap-break-word text-[10px] text-muted-foreground/60 line-clamp-2">
                              {mode.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              {agentInfo?.agentCapabilities?.promptCapabilities?.embeddedContext ||
              agentInfo?.agentCapabilities?.promptCapabilities?.image ? (
                <>
                  <input
                    type="file"
                    multiple
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleFileSelect}
                    accept={[
                      agentInfo?.agentCapabilities?.promptCapabilities?.image ? "image/*" : "",
                      agentInfo?.agentCapabilities?.promptCapabilities?.embeddedContext
                        ? "*/*"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(",")}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-lg text-muted-foreground"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={t("chatInput.attach", "Attach file")}
                    disabled={disabled}
                  >
                    {agentInfo?.agentCapabilities?.promptCapabilities?.embeddedContext ? (
                      <Paperclip className="size-3.5" />
                    ) : (
                      <ImageIcon className="size-3.5" />
                    )}
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {availableModels.length > 0 ? (
                <Select
                  value={currentModelId ?? ""}
                  onValueChange={async (modelId) => {
                    if (modelId === null) {
                      return;
                    }
                    const sid = useAppStore.getState().activeSessionId;
                    if (!sid) return;
                    useAppStore
                      .getState()
                      .updateSessionState(sid, () => ({ currentModelId: modelId }));
                    try {
                      await request.setModel({
                        sessionId: sid,
                        modelId: modelId,
                      });
                    } catch (err) {
                      console.error("Failed to set model:", err);
                    }
                  }}
                >
                  <SelectTrigger size="sm">
                    <SelectValue placeholder={t("chatInput.selectModel", "Select model")} />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} className="w-60">
                    {availableModels.map((m) => (
                      <SelectItem key={m.modelId} value={m.modelId}>
                        <div className="flex min-w-0 flex-col gap-1 whitespace-normal">
                          <span>{m.name}</span>
                          <span className="wrap-break-word text-[10px] text-muted-foreground/60 line-clamp-2">
                            {m.modelId}
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
                    disabled={disabled || (!input.trim() && attachments.length === 0)}
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
    fontSize: 12,
    lineHeight: "1.5",
  },
  "&multiLine": {
    control: {
      minHeight: 76,
    },
    highlighter: {
      padding: "12px 16px 8px",
      border: "none",
      maxHeight: 200,
    },
    input: {
      padding: "12px 16px 8px",
      border: "none",
      outline: "none",
      overflow: "auto",
      maxHeight: 200,
      color: "var(--foreground)",
      fontSize: 12,
      lineHeight: "1.5",
      opacity: 0.8,
    },
  },
  suggestions: {
    backgroundColor: "transparent",
    list: {
      backgroundColor: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      fontSize: 12,
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
  backgroundColor: "var(--secondary)",
  boxShadow: "0 0 0 1px var(--ring)",
  borderRadius: 3,
  margin: -1.5,
  padding: 1.5,
};
