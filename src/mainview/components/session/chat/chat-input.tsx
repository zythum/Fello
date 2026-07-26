import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { MentionsInput, Mention } from "react-mentions";
import {
  useSessionIsLoading,
  useSessionAskUserRequests,
  useSessionDraftInput,
  useSessionDraftAttachments,
} from "../../../lib/session-selectors";
import { useAppStore, type StagedAttachmentInfo, type SessionState } from "../../../store";
import type { ChatMessage } from "../../../lib/chat-message";
import { request, isWebUI } from "../../../backend";
import { electron } from "../../../electron";
import { reduceFlushStreaming } from "../../../lib/session-state-reducer";
import * as tiks from "@rexa-developer/tiks";
import { Button } from "@/components/ui/button";
import {
  ArrowUp,
  Square,
  Paperclip,
  X,
  ImageIcon,
  FileText,
  Folder,
  Library,
  Wrench,
  Clipboard,
  ChevronDown,
  Check,
} from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { extractErrorMessage } from "@/lib/utils";
import { generateUUID } from "@/lib/utils";
import { useMessage } from "../../providers/message";
import type { SessionInfo, SkillInfo, McpServerInfo } from "../../../../shared/schema";
import type { ContentBlock } from "@agentclientprotocol/sdk";

interface SearchFileItem {
  id: string;
  filename: string;
  isFolder: boolean;
}

interface SuggestItem {
  id: string;
  display: string;
}

function skillInfoToSuggestItem(s: SkillInfo): SuggestItem {
  return {
    id: s.id,
    display: `@skill:${s.name}`,
  };
}

function mcpServerInfoToSuggestItem(m: McpServerInfo): SuggestItem {
  return {
    id: m.id,
    display: `@mcp:${m.id}`,
  };
}

function searchFileItemToSuggestItem(f: SearchFileItem): SuggestItem {
  return {
    id: f.id,
    display: f.isFolder ? `#folder:${f.filename}` : `#file:${f.filename}`,
  };
}

/** 根据绝对路径判断是否属于当前项目，返回合适的 mention 标记（#file: / #folder: / #resource:） */
async function absPathToMention(
  absPath: string,
  projectId: string,
  projectCwd?: string,
): Promise<string> {
  // Project root itself or paths outside the project → treat as external resource
  if (
    projectCwd &&
    (absPath === projectCwd ||
      absPath === projectCwd.replace(/\/$/, "") ||
      !absPath.startsWith(projectCwd.replace(/\/?$/, "/")))
  ) {
    const fileUri = `file://${absPath.replace(/\\/g, "/")}`;
    return `@[#resource:${fileUri}](${fileUri}) `;
  }
  try {
    const relPath = await request.getSystemFilePath({
      projectId,
      path: absPath,
      isAbsolute: false,
    });
    const info = await request.getFileInfo({ projectId, relativePath: relPath });
    if (info) {
      const prefix = info.isFile ? "#file:" : "#folder:";
      return `@[${prefix}${relPath}](${absPath}) `;
    }
  } catch {
    // not within project
  }
  const fileUri = `file://${absPath.replace(/\\/g, "/")}`;
  return `@[#resource:${fileUri}](${fileUri}) `;
}

/** 将 File 读取为 base64（不含 data: URL 前缀） */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 将 File 读取为纯文本 */
function readFileAsText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/** 将暂存的附件信息构建成 ContentBlock 列表 */
function buildAttachmentBlocks(attachments: StagedAttachmentInfo[]): ContentBlock[] {
  return attachments.map((att) => {
    if (att.type === "image") {
      return {
        type: "image",
        mimeType: att.mimeType,
        data: att.data,
      } satisfies ContentBlock;
    }
    return {
      type: "resource",
      resource: {
        uri: `file://${att.filename}`,
        text: att.data,
      },
    } satisfies ContentBlock;
  });
}

/** Max suggestions shown for skills / MCP in the @ mention autocomplete */
const AT_SUGGESTION_MAX = 6;

/** Markup format used by react-mentions: @[display](id) */
const MENTION_MARKUP = "@[__display__](__id__)";
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Replace all mention markup with the raw absolute path */
function resolveMentions(value: string): string {
  return value.replace(MENTION_REGEX, (_match, display: string, _id: string) => display);
}

export function ChatInput({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useMessage();
  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { addMessage, updateSession } = useAppStore();
  const snippets = useAppStore((s) => s.snippets);
  const isStreaming = session.isStreaming;
  const availableModels = useMemo(
    () => session.models?.availableModels ?? [],
    [session.models?.availableModels],
  );
  const currentModelId = session.models?.currentModelId ?? null;

  // Group models by prefix (e.g. "openai/gpt-4o" → group "openai")
  const groupedModels = useMemo(() => {
    const groups = new Map<string, typeof availableModels>();
    for (const m of availableModels) {
      const slashIdx = m.name.indexOf("/");
      const key = slashIdx > 0 ? m.name.slice(0, slashIdx) : "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return groups;
  }, [availableModels]);

  const handleModelChange = useCallback(
    async (modelId: string) => {
      const sid = session.id;
      if (!sid) return;
      useAppStore.getState().updateSession({
        ...session,
        models: { ...session.models!, currentModelId: modelId },
      });
      try {
        await request.setModel({ sessionId: sid, modelId });
      } catch (err) {
        console.error("Failed to set model:", err);
        useAppStore.getState().updateSession(session);
      }
    },
    [session],
  );

  const handleModeChange = useCallback(
    async (modeId: string) => {
      const sid = session.id;
      if (!sid) return;
      useAppStore.getState().updateSession({
        ...session,
        modes: { ...session.modes!, currentModeId: modeId },
      });
      try {
        await request.setMode({ sessionId: sid, modeId });
      } catch (err) {
        console.error("Failed to set mode:", err);
        useAppStore.getState().updateSession(session);
      }
    },
    [session],
  );

  const handleThoughtLevelChange = useCallback(
    async (thoughtLevelId: string) => {
      const sid = session.id;
      if (!sid) return;
      useAppStore.getState().updateSession({
        ...session,
        thoughtLevels: { ...session.thoughtLevels!, currentThoughtLevelId: thoughtLevelId },
      });
      try {
        await request.setThoughtLevel({ sessionId: sid, thoughtLevelId });
      } catch (err) {
        console.error("Failed to set thought level:", err);
        useAppStore.getState().updateSession(session);
      }
    },
    [session],
  );

  const availableModes = session.modes?.availableModes ?? [];
  const currentModeId = session.modes?.currentModeId ?? null;
  const availableThoughtLevels = session.thoughtLevels?.availableThoughtLevels ?? [];
  const currentThoughtLevelId = session.thoughtLevels?.currentThoughtLevelId ?? null;
  const initializeInfo = session.initializeInfo;
  const isLoading = useSessionIsLoading(session.id);
  const askUserRequests = useSessionAskUserRequests(session.id);
  const availableCommands = session.availableCommands;
  const draftInput = useSessionDraftInput(session.id);
  const draftAttachments = useSessionDraftAttachments(session.id);

  /** session state 更新器（自动绑定当前 session.id） */
  const updateSessionState = useCallback(
    (updater: (s: SessionState) => Partial<SessionState>) => {
      useAppStore.getState().updateSessionState(session.id, updater);
    },
    [session.id],
  );

  // ---- 本地输入状态（轻量，不经过 store，保证打字流畅） ----
  const [localInput, setLocalInput] = useState(draftInput);
  const localInputRef = useRef(localInput);
  localInputRef.current = localInput;
  const prevSessionIdRef = useRef(session.id);
  // 当前 session 切换时：存旧的，读新的
  useEffect(() => {
    const prevId = prevSessionIdRef.current;
    if (prevId !== session.id) {
      // 保存旧 session 的暂存
      if (prevId) {
        useAppStore
          .getState()
          .updateSessionState(prevId, () => ({ draftInput: localInputRef.current }));
      }
      prevSessionIdRef.current = session.id;
    }
    // 加载新 session 的暂存
    setLocalInput(draftInput);
    // 组件卸载时也保存当前输入（使用 ref 避免闭包捕获旧值）
    return () => {
      if (session.id) {
        useAppStore
          .getState()
          .updateSessionState(session.id, () => ({ draftInput: localInputRef.current }));
      }
    };
  }, [session.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 注意：draftInput 只在 session.id 变化时读取，不作为常规依赖

  // blur 时写回 store（确保跨 session 持久化）
  const handleBlur = useCallback(() => {
    updateSessionState(() => ({ draftInput: localInput }));
  }, [localInput, updateSessionState]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const skillsCacheRef = useRef<SkillInfo[]>([]);
  const skillsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skillsRequestIdRef = useRef<number>(0);

  const searchFileCacheRef = useRef<SearchFileItem[]>([]);
  const searchFileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchFileRequestIdRef = useRef<number>(0);

  // Handle external add-to-chat events from file-panel
  useEffect(() => {
    const handleAddToChat = (e: Event) => {
      const customEvent = e as CustomEvent;
      const nodes = customEvent.detail as { id: string; name: string; isFolder: boolean }[];
      if (!nodes || nodes.length === 0) return;
      const mentions = nodes
        .map((n) => `@[${n.isFolder ? "#folder:" : "#file:"}${n.name}](${n.id})`)
        .join(" ");
      setLocalInput((prev) => (prev ? `${prev} ${mentions} ` : `${mentions} `));
      // Focus the textarea
      requestAnimationFrame(() => {
        containerRef.current?.querySelector("textarea")?.focus();
      });
    };

    document.addEventListener("fello-add-to-chat", handleAddToChat);
    return () => document.removeEventListener("fello-add-to-chat", handleAddToChat);
  }, [session.id]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    const supportsImage = initializeInfo?.agentCapabilities?.promptCapabilities?.image;
    const supportsEmbedded = initializeInfo?.agentCapabilities?.promptCapabilities?.embeddedContext;

    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const type: "image" | "file" =
        isImage && supportsImage ? "image" : supportsEmbedded ? "file" : "file";

      const data = type === "image" ? await readFileAsBase64(file) : await readFileAsText(file);

      updateSessionState((s) => ({
        draftAttachments: [
          ...s.draftAttachments,
          {
            id: generateUUID(),
            filename: file.name,
            mimeType: file.type,
            type,
            data,
          },
        ],
      }));
    }

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (id: string) => {
    updateSessionState((s) => ({
      draftAttachments: s.draftAttachments.filter((a) => a.id !== id),
    }));
  };

  /** Fetch file suggestions from backend (called by react-mentions on each keystroke) */
  const fetchFileSuggestions = useCallback(
    (search: string, callback: (data: { id: string; display: string }[]) => void) => {
      callback(searchFileCacheRef.current.map((f) => searchFileItemToSuggestItem(f)));

      if (searchFileTimeoutRef.current) {
        clearTimeout(searchFileTimeoutRef.current);
      }

      const requestId = ++searchFileRequestIdRef.current;
      searchFileTimeoutRef.current = setTimeout(() => {
        request
          .searchFiles({ projectId: session.projectId, query: search || undefined })
          .then((results) => {
            if (requestId !== searchFileRequestIdRef.current) return;
            searchFileCacheRef.current = results;
            const suggests = results.map((f) => searchFileItemToSuggestItem(f));
            callback(suggests);
          })
          .catch(() => {
            if (requestId !== searchFileRequestIdRef.current) return;
            const results: SearchFileItem[] = [];
            searchFileCacheRef.current = results;
            callback(results.map((f) => searchFileItemToSuggestItem(f)));
          });
      }, 100);
    },
    [session],
  );

  /** Fetch @ suggestions: skills + MCP servers (cached and filtered locally) */
  const fetchAtSuggestions = useCallback(
    (search: string, callback: (data: { id: string; display: string }[]) => void) => {
      const lowerSearch = (search || "").toLowerCase();

      // Return skills from cache immediately (avoids flash), limited to AT_SUGGESTION_MAX
      const cachedSkills = skillsCacheRef.current
        .filter(
          (s) =>
            !search ||
            s.name.toLowerCase().includes(lowerSearch) ||
            s.description?.toLowerCase().includes(lowerSearch),
        )
        .map((s) => skillInfoToSuggestItem(s))
        .slice(0, AT_SUGGESTION_MAX);

      // Read MCP servers from store — only suggest servers active in the current session, limited to AT_SUGGESTION_MAX
      const enabledMcpServers = useAppStore
        .getState()
        .configuredMcpServers.filter((m) => session.mcpServers.includes(m.id));
      const mcpItems = enabledMcpServers
        .filter(
          (m) =>
            !search ||
            m.id.toLowerCase().includes(lowerSearch) ||
            (m.type === "stdio" && m.command.toLowerCase().includes(lowerSearch)) ||
            (m.type === "http" && m.url.toLowerCase().includes(lowerSearch)),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => mcpServerInfoToSuggestItem(m))
        .slice(0, AT_SUGGESTION_MAX);

      callback([...mcpItems, ...cachedSkills]);

      // Async refresh skills from backend
      if (skillsTimeoutRef.current) {
        clearTimeout(skillsTimeoutRef.current);
      }

      const requestId = ++skillsRequestIdRef.current;
      skillsTimeoutRef.current = setTimeout(() => {
        request
          .getSkillsCatalog({ projectId: session.projectId })
          .then((results) => {
            if (requestId !== skillsRequestIdRef.current) return;

            const filtered = results.filter(
              (s) =>
                !search ||
                s.name.toLowerCase().includes(lowerSearch) ||
                s.description?.toLowerCase().includes(lowerSearch),
            );
            skillsCacheRef.current = filtered.sort((a, b) => a.name.localeCompare(b.name));

            const refreshedSkills = filtered
              .map((s) => skillInfoToSuggestItem(s))
              .slice(0, AT_SUGGESTION_MAX);
            const refreshedMcp = useAppStore
              .getState()
              .configuredMcpServers.filter(
                (m) =>
                  session.mcpServers.includes(m.id) &&
                  (!search ||
                    m.id.toLowerCase().includes(lowerSearch) ||
                    (m.type === "stdio" && m.command.toLowerCase().includes(lowerSearch)) ||
                    (m.type === "http" && m.url.toLowerCase().includes(lowerSearch))),
              )
              .map((m) => mcpServerInfoToSuggestItem(m))
              .slice(0, AT_SUGGESTION_MAX);

            callback([...refreshedMcp, ...refreshedSkills]);
          })
          .catch(() => {
            if (requestId !== skillsRequestIdRef.current) return;
            skillsCacheRef.current = [];
            callback(mcpItems);
          });
      }, 100);
    },
    [session],
  );

  /** Fetch slash command suggestions — only when / is at position 0 */
  const fetchSlashCommands = useCallback(
    (search: string, callback: (data: { id: string; display: string }[]) => void) => {
      // Only show suggestions if input starts with "/"
      if (!localInput.startsWith("/")) {
        callback([]);
        return;
      }
      const lower = search.toLowerCase();
      const items = availableCommands
        .filter((cmd) => !lower || cmd.name.toLowerCase().includes(lower))
        .slice(0, 6)
        .map((cmd) => ({ id: cmd.name, display: `/${cmd.name}` }));
      callback(items);
    },
    [localInput, availableCommands],
  );

  const handleSubmit = useCallback(async () => {
    tiks.click();
    const state = useAppStore.getState().getSessionState(session.id);
    const currentAttachments = state.draftAttachments;

    const displayId = generateUUID();
    const resolved = resolveMentions(localInput).trim();
    if ((!resolved && currentAttachments.length === 0) || !session.id || isStreaming) return;

    // Build ContentBlocks from stored attachments directly
    const attachmentBlocks = buildAttachmentBlocks(currentAttachments);

    const contents: ContentBlock[] = [];
    if (resolved) {
      contents.push({
        type: "text",
        text: resolved,
        _meta: {
          display_id: displayId,
          optimistic_id: generateUUID(),
        },
      });
    }
    contents.push(
      ...attachmentBlocks.map((block) => {
        return Object.assign(
          {
            _meta: {
              display_id: displayId,
              optimistic_id: generateUUID(),
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
      receivedAt: Date.now(),
    } satisfies ChatMessage;

    // 1. Optimistic Update: clear input + attachments, add message to screen instantly
    setLocalInput("");
    updateSessionState(() => ({
      draftInput: "",
      draftAttachments: [],
    }));
    addMessage(session.id, userMessage);
    updateSession({ ...session, isStreaming: true });
    document.dispatchEvent(new CustomEvent("fello-scroll-to-bottom"));

    try {
      // 2. Wait for the generation to complete
      const promptResponse = await request.sendPrompt({
        sessionId: session.id,
        contents,
      });

      // 3. Show warning if not end_turn
      if (promptResponse.stopReason && promptResponse.stopReason !== "end_turn") {
        const stopReasonLabels: Record<string, string> = {
          max_tokens: t("chatInput.stopReasonMaxTokens", "Reached maximum token limit"),
          max_turn_requests: t("chatInput.stopReasonMaxTurnRequests", "Reached maximum turn limit"),
          refusal: t("chatInput.stopReasonRefusal", "Model refused to respond"),
          cancelled: t("chatInput.stopReasonCancelled", "Generation was cancelled"),
        };
        const label = stopReasonLabels[promptResponse.stopReason] || promptResponse.stopReason;
        if (promptResponse.stopReason === "cancelled") {
          toast.info(label);
        } else {
          toast.error(label);
        }
      }
    } catch (err) {
      // 4. Rollback on Network Failure
      const currentState = useAppStore.getState().getSessionState(session.id);
      const isStillOptimistic = currentState.messages.some((m) => m.displayId === displayId);

      if (isStillOptimistic) {
        console.error("Prompt error (network failure):", err);
        const newMessages = currentState.messages.filter((m) => m.displayId !== displayId);
        useAppStore.getState().updateSessionState(session.id, () => ({ messages: newMessages }));
      } else {
        console.error("Prompt error (generation failure):", err);
      }

      toast.error(
        `${t("message.errorTitle", "Error")}: ${extractErrorMessage(err) || t("chatInput.generationFailed", "Generation failed")}`,
      );

      // If an error occurs, the backend might have crashed or network failed before
      // broadcasting the isStreaming: false event. So we ensure it is cleaned up locally.
      useAppStore
        .getState()
        .updateSessionState(session.id, () => reduceFlushStreaming(currentState));

      updateSession({ ...session, isStreaming: false });
    }
  }, [session, isStreaming, addMessage, localInput, updateSessionState, t, toast, updateSession]);

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
      const supportsImage = initializeInfo?.agentCapabilities?.promptCapabilities?.image;
      const supportsEmbedded =
        initializeInfo?.agentCapabilities?.promptCapabilities?.embeddedContext;
      // Handle files drop
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const absPaths: string[] = [];
        let hasInlineAttachments = false;

        for (const file of Array.from(e.dataTransfer.files)) {
          const isImage = file.type.startsWith("image/");
          const canEmbed = isImage && supportsImage;
          const canReadText = supportsEmbedded;

          if (canEmbed || canReadText) {
            hasInlineAttachments = true;
            // Read inline and store immediately (folders will fail silently)
            (async () => {
              try {
                const data = isImage ? await readFileAsBase64(file) : await readFileAsText(file);
                const type: "image" | "file" = isImage ? "image" : "file";
                updateSessionState((s) => ({
                  draftAttachments: [
                    ...s.draftAttachments,
                    { id: generateUUID(), filename: file.name, mimeType: file.type, type, data },
                  ],
                }));
              } catch {
                // Can't read inline (e.g. folder) → try electron path API as fallback
                if (!isWebUI) {
                  const p = electron.getPathForFile(file);
                  if (p) {
                    const mention = await absPathToMention(p, session.projectId, session.cwd);
                    const textarea = containerRef.current?.querySelector("textarea");
                    if (textarea) {
                      textarea.focus();
                      document.execCommand("insertText", false, mention);
                    }
                  }
                }
              }
            })();
          } else if (!isWebUI) {
            const p = electron.getPathForFile(file);
            if (p) absPaths.push(p);
          }
        }

        // Async resolve absolute paths to mentions (with project-aware prefix)
        if (absPaths.length > 0) {
          (async () => {
            const textarea = containerRef.current?.querySelector("textarea");
            if (!textarea) return;
            textarea.focus();
            const mentions = await Promise.all(
              absPaths.map((p) => absPathToMention(p, session.projectId, session.cwd)),
            );
            document.execCommand("insertText", false, mentions.join(""));
          })();
          return;
        }
        // If we got here without handling anything (e.g. folder from Finder),
        // fall through to check text/uri-list instead of returning
        if (hasInlineAttachments) return;
      }

      // Handle file:// URIs from external sources (VS Code file tree drag, etc.)
      const uriList = e.dataTransfer.getData("text/uri-list");
      if (uriList) {
        const uris = uriList
          .split("\n")
          .map((u) => u.trim())
          .filter(Boolean);
        const absPaths = uris
          .filter((uri) => uri.startsWith("file://"))
          .map((uri) => decodeURIComponent(uri.replace(/^file:\/\//, "")))
          .filter(Boolean);

        if (absPaths.length > 0) {
          (async () => {
            const textarea = containerRef.current?.querySelector("textarea");
            if (!textarea) return;
            textarea.focus();
            const mentions = await Promise.all(
              absPaths.map((p) => absPathToMention(p, session.projectId, session.cwd)),
            );
            document.execCommand("insertText", false, mentions.join(" ") + " ");
          })();
        }
        return;
      }

      // Handle tree nodes drop
      const raw = e.dataTransfer.getData("application/x-fello-tree-nodes");
      if (!raw) return; // not from file-tree, ignore

      try {
        const nodes: { id: string; name: string; isFolder: boolean }[] = JSON.parse(raw);
        if (nodes.length === 0) return;
        const mentions = nodes
          .map((n) => `@[${n.isFolder ? "#folder:" : "#file:"}${n.name}](${n.id})`)
          .join(" ");
        setLocalInput((prev) => (prev ? `${prev} ${mentions} ` : `${mentions} `));

        // Focus the textarea after paste
        requestAnimationFrame(() => {
          containerRef.current?.querySelector("textarea")?.focus();
        });
      } catch {
        // ignore malformed data
      }
    },
    [
      initializeInfo?.agentCapabilities?.promptCapabilities,
      session.projectId,
      session.cwd,
      updateSessionState,
    ],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Must always preventDefault on dragover to allow drop
    if (
      e.dataTransfer.types.includes("application/x-fello-tree-nodes") ||
      e.dataTransfer.types.includes("Files") ||
      e.dataTransfer.types.includes("text/uri-list")
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
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Debounce to avoid flicker when moving between child elements
    dragLeaveTimer.current = setTimeout(() => setIsDragOver(false), 50);
  }, []);

  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const isContextMenuOpenRef = useRef(false);

  // 右键菜单在 chat-input 范围内打开时，保持高亮（focus-within 样式）
  // 仅通过 mousedown 判断：点击到 container 外部且不在上下文菜单 popup 上时才关闭
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (container.contains(e.target as Node)) {
        isContextMenuOpenRef.current = true;
        setIsContextMenuOpen(true);
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (!isContextMenuOpenRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      // 点击在 container 内部 → 不关闭
      if (container.contains(e.target as Node)) return;
      // 点击在上下文菜单 popup 上 → 不关闭（允许菜单交互）
      const target = e.target as HTMLElement;
      if (
        target?.closest?.('[data-slot="context-menu-content"]') ||
        target?.closest?.('[data-slot="context-menu"]')
      ) {
        return;
      }
      // 点击在其他地方 → 关闭高亮
      isContextMenuOpenRef.current = false;
      setIsContextMenuOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isContextMenuOpenRef.current) {
        isContextMenuOpenRef.current = false;
        setIsContextMenuOpen(false);
      }
    };
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const hasActiveAskUser = askUserRequests ? askUserRequests.length > 0 : false;
  const disabled =
    !session.id || session.connectionStatus !== "connected" || isLoading || hasActiveAskUser;

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData("text/plain");
      const files = e.clipboardData.files;
      if (!session) return;

      if (files.length > 0 && !isWebUI) {
        const supportsImage = initializeInfo?.agentCapabilities?.promptCapabilities?.image;
        const supportsEmbedded =
          initializeInfo?.agentCapabilities?.promptCapabilities?.embeddedContext;
        // Handle files
        const paths: string[] = [];

        for (const file of Array.from(files)) {
          const isImage = file.type.startsWith("image/");
          const canEmbed = isImage && supportsImage;
          const canReadText = supportsEmbedded;

          if (canEmbed || canReadText) {
            // Read inline and store immediately
            (async () => {
              const data = isImage ? await readFileAsBase64(file) : await readFileAsText(file);
              const type: "image" | "file" = isImage ? "image" : "file";
              updateSessionState((s) => ({
                draftAttachments: [
                  ...s.draftAttachments,
                  { id: generateUUID(), filename: file.name, mimeType: file.type, type, data },
                ],
              }));
            })();
          } else if (!isWebUI) {
            const p = electron.getPathForFile(file);
            if (p) paths.push(p);
          }
        }

        if (paths.length > 0) {
          const target = e.target as HTMLElement;
          if (target.tagName !== "TEXTAREA") return;
          const textarea = target as HTMLTextAreaElement;
          textarea.focus();
          (async () => {
            const mentions = await Promise.all(
              paths.map((p) => absPathToMention(p, session.projectId, session.cwd)),
            );
            document.execCommand("insertText", false, mentions.join(""));
          })();
        }
        e.preventDefault();
        return;
      }

      if (text) {
        const trimmed = text.trim();
        if (trimmed.includes("\n") || trimmed.length > 1024) return;

        const target = e.target as HTMLElement;
        if (target.tagName !== "TEXTAREA") return;
        const textarea = target as HTMLTextAreaElement;

        const isLikelyPath =
          trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes(".");
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
              const isFolder = !info.isFile;
              const displayPath = relPath.replace(/\\/g, "/");
              const prefix = isFolder ? "#folder:" : "#file:";
              insertText = `@[${prefix}${displayPath}](${absPath}) `;
            }
          } catch {
            // ignore
          }

          // Restore focus and insert text natively so MentionsInput catches the onChange
          textarea.focus();
          document.execCommand("insertText", false, insertText);
        })();
      }
    },
    [session, initializeInfo?.agentCapabilities?.promptCapabilities, updateSessionState],
  );

  return (
    <div
      className={`p-6 -mt-6 relative transition-opacity duration-300 ${hasActiveAskUser ? "opacity-30 pointer-events-none" : ""}`}
    >
      <div className="mx-auto max-w-5xl">
        <div
          ref={containerRef}
          onContextMenu={() => {
            // 右键点击 highlighter（MentionsInput 覆盖层）时确保 textarea 保持焦点，
            // 这样 focus-within 样式在右键菜单打开时也能生效
            const textarea = containerRef.current?.querySelector("textarea");
            if (textarea && document.activeElement !== textarea) {
              textarea.focus();
            }
          }}
          className={`rounded-lg border bg-card shadow-[0_0_20px] shadow-primary/10 dark:shadow-primary/20 transition-colors focus-within:border-ring focus-within:ring-ring ${
            isDragOver
              ? "border-primary ring-0.5 ring-primary bg-primary/5"
              : isContextMenuOpen
                ? "border-ring ring-ring"
                : "border-input"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onPasteCapture={handlePaste}
        >
          {/* Top Preview Area */}
          {draftAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 pb-0">
              {draftAttachments.map((att) => (
                <div
                  key={att.id}
                  className="relative flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs"
                >
                  {att.type === "image" ? (
                    <HoverCard>
                      <HoverCardTrigger
                        render={
                          <div className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                            <ImageIcon className="size-3.5" />
                            <span className="max-w-25 truncate">{att.filename}</span>
                          </div>
                        }
                      />
                      <HoverCardContent className="w-auto p-1" side="top">
                        <img
                          src={`data:${att.mimeType};base64,${att.data}`}
                          alt={att.filename}
                          className="max-h-50 max-w-50 rounded object-contain"
                        />
                      </HoverCardContent>
                    </HoverCard>
                  ) : (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <FileText className="size-3.5" />
                      <span className="max-w-25 truncate">{att.filename}</span>
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
            value={localInput}
            onChange={(_e, newValue) => setLocalInput(newValue)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled ? t("chatInput.placeholderDisabled") : t("chatInput.placeholderActive")
            }
            disabled={disabled}
            aria-label={t("chatInput.messageInput", "Message input")}
            style={mentionsInputStyle}
            className="chat-mentions-input"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            a11ySuggestionsListLabel={t("chatInput.suggestions", "Suggestions")}
          >
            <Mention
              trigger="/"
              data={fetchSlashCommands}
              markup={MENTION_MARKUP}
              displayTransform={(_id, display) => display}
              style={mentionStyle}
              appendSpaceOnAdd
              renderSuggestion={(suggestion) => {
                const cmd = availableCommands.find((c) => c.name === suggestion.id);
                return (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-foreground">/{suggestion.id}</span>
                    {cmd?.description && (
                      <span className="ml-1 text-[10px] text-muted-foreground/50 truncate">
                        {cmd.description}
                      </span>
                    )}
                  </div>
                );
              }}
            />
            <Mention
              trigger="#"
              data={fetchFileSuggestions}
              markup={MENTION_MARKUP}
              displayTransform={(_id, display) => display}
              style={mentionStyle}
              appendSpaceOnAdd
              renderSuggestion={(suggestion) => {
                const name = String(suggestion.id).split("/").pop();
                {
                  /* display format is determined by searchFileItemToSuggestItem above */
                }
                const isFolder = suggestion.display?.startsWith("#folder:");
                return (
                  <div className="flex items-center gap-1">
                    {isFolder ? (
                      <Folder className="size-3.5 text-muted-foreground" />
                    ) : (
                      <FileText className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="text-xs whitespace-nowrap text-foreground">{name}</span>
                    <span className="ml-1 text-[10px] text-muted-foreground/50 flex-1 truncate">
                      {suggestion.display?.slice(1)}
                    </span>
                  </div>
                );
              }}
            />
            <Mention
              trigger="@"
              data={fetchAtSuggestions}
              markup={MENTION_MARKUP}
              displayTransform={(_id, display) => display}
              style={mentionStyle}
              appendSpaceOnAdd
              renderSuggestion={(suggestion) => {
                const display = suggestion.display ?? "";
                const isMcp = display.startsWith("@mcp:");
                if (isMcp) {
                  const mcpServers = useAppStore.getState().configuredMcpServers;
                  const mcp = mcpServers.find((m) => m.id === suggestion.id);
                  return (
                    <div className="flex items-center gap-1">
                      <Wrench className="size-3.5 text-muted-foreground" />
                      <span className="text-xs whitespace-nowrap text-foreground">
                        {mcp?.id ?? suggestion.id}
                      </span>
                      <span className="ml-1 text-[10px] text-muted-foreground/50 flex-1 truncate">
                        {mcp?.type === "stdio"
                          ? `${mcp.command} ${(mcp.args ?? []).join(" ")}`
                          : mcp?.type === "http"
                            ? mcp.url
                            : ""}
                      </span>
                    </div>
                  );
                }
                const skill = skillsCacheRef.current.find(
                  (skillInfo) => skillInfo.id === suggestion.id,
                );
                return (
                  <div className="flex items-center gap-1">
                    <Library className="size-3.5 text-muted-foreground" />
                    <span className="text-xs whitespace-nowrap text-foreground">
                      {skill?.name ?? skill?.id}
                    </span>
                    <span className="ml-1 text-[10px] text-muted-foreground/50 flex-1 truncate">
                      {skill?.description}
                    </span>
                  </div>
                );
              }}
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
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 max-w-48"
                      />
                    }
                  >
                    <span className="truncate">
                      {availableModes.find((m) => m.id === currentModeId)?.name ??
                        t("chatInput.mode", "Mode")}
                    </span>
                    <ChevronDown className="size-3 opacity-60 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-auto! max-h-none! max-w-60 min-w-(--anchor-width)"
                  >
                    {availableModes.map((mode) => (
                      <DropdownMenuItem
                        key={mode.id}
                        onClick={() => handleModeChange(mode.id)}
                        className="gap-2"
                      >
                        <Check
                          className={`size-3 shrink-0 ${mode.id === currentModeId ? "opacity-100" : "opacity-0"}`}
                        />
                        <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                          <span>{mode.name}</span>
                          {mode.description && (
                            <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                              {mode.description}
                            </span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <div className="flex items-center">
                {initializeInfo?.agentCapabilities?.promptCapabilities?.embeddedContext ||
                initializeInfo?.agentCapabilities?.promptCapabilities?.image ? (
                  <>
                    <input
                      type="file"
                      multiple
                      ref={fileInputRef}
                      className="hidden"
                      onChange={handleFileSelect}
                      accept={[
                        initializeInfo?.agentCapabilities?.promptCapabilities?.image
                          ? "image/*"
                          : "",
                        initializeInfo?.agentCapabilities?.promptCapabilities?.embeddedContext
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
                      {initializeInfo?.agentCapabilities?.promptCapabilities?.embeddedContext ? (
                        <Paperclip className="size-3.5" />
                      ) : (
                        <ImageIcon className="size-3.5" />
                      )}
                    </Button>
                  </>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-lg text-muted-foreground"
                        disabled={disabled}
                        aria-label={t("chatInput.snippets", "Snippets")}
                      >
                        <Clipboard className="size-3.5" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent side="top" align="start" className="w-60">
                    {snippets.length > 0 ? (
                      snippets.map((s) => (
                        <DropdownMenuItem
                          key={s.id}
                          onClick={() => {
                            containerRef.current?.querySelector("textarea")?.focus();
                            document.execCommand("insertText", false, s.content);
                          }}
                        >
                          <div className="flex min-w-0 flex-col gap-1 whitespace-normal">
                            <span className="text-xs">{s.title}</span>
                            <span className="wrap-break-word text-[10px] text-muted-foreground/60 line-clamp-2">
                              {s.content}
                            </span>
                          </div>
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem onClick={() => navigate("/settings/snippets")}>
                        <span className="text-xs text-muted-foreground">
                          {t("chatInput.snippetsEmpty", "No snippets. Click to add in Settings.")}
                        </span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {availableModels.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 max-w-48"
                      />
                    }
                  >
                    <span className="truncate">
                      {availableModels.find((m) => m.modelId === currentModelId)?.name ??
                        t("chatInput.selectModel", "Select model")}
                    </span>
                    <ChevronDown className="size-3 opacity-60 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-auto! max-h-none! max-w-64 min-w-(--anchor-width)"
                  >
                    {groupedModels.size <= 1
                      ? availableModels.map((m) => (
                          <DropdownMenuItem
                            key={m.modelId}
                            onClick={() => handleModelChange(m.modelId)}
                            className="gap-2"
                          >
                            <Check
                              className={`size-3 shrink-0 ${m.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                            />
                            <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                              <span className="truncate">{m.name}</span>
                              {m.description && (
                                <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                                  {m.description}
                                </span>
                              )}
                            </div>
                          </DropdownMenuItem>
                        ))
                      : Array.from(groupedModels.entries()).map(([group, models]) =>
                          group ? (
                            <DropdownMenuSub key={group}>
                              <DropdownMenuSubTrigger className="gap-2">
                                <Check
                                  className={`size-3 shrink-0 ${models.some((m) => m.modelId === currentModelId) ? "opacity-100" : "opacity-0"}`}
                                />
                                {group}
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="max-h-80 overflow-y-auto min-w-40">
                                {models.map((m) => (
                                  <DropdownMenuItem
                                    key={m.modelId}
                                    onClick={() => handleModelChange(m.modelId)}
                                    className="gap-2"
                                  >
                                    <Check
                                      className={`size-3 shrink-0 ${m.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                                    />
                                    <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                                      <span className="truncate">
                                        {m.name.slice(group.length + 1)}
                                      </span>
                                      {m.description && (
                                        <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                                          {m.description}
                                        </span>
                                      )}
                                    </div>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          ) : (
                            models.map((m) => (
                              <DropdownMenuItem
                                key={m.modelId}
                                onClick={() => handleModelChange(m.modelId)}
                                className="gap-2"
                              >
                                <Check
                                  className={`size-3 shrink-0 ${m.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                                />
                                <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                                  <span className="truncate">{m.name}</span>
                                  {m.description && (
                                    <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                                      {m.description}
                                    </span>
                                  )}
                                </div>
                              </DropdownMenuItem>
                            ))
                          ),
                        )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {availableThoughtLevels.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 max-w-32"
                      />
                    }
                  >
                    <span className="truncate">
                      {availableThoughtLevels.find((l) => l.id === currentThoughtLevelId)?.name ??
                        "Thought"}
                    </span>
                    <ChevronDown className="size-3 opacity-60 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-auto! max-h-none! max-w-60 min-w-(--anchor-width)"
                  >
                    {availableThoughtLevels.map((level) => (
                      <DropdownMenuItem
                        key={level.id}
                        onClick={() => handleThoughtLevelChange(level.id)}
                        className="gap-2"
                      >
                        <Check
                          className={`size-3 shrink-0 ${level.id === currentThoughtLevelId ? "opacity-100" : "opacity-0"}`}
                        />
                        <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                          <span>{level.name}</span>
                          {level.description && (
                            <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                              {level.description}
                            </span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {isStreaming ? (
                <Button
                  variant="destructive"
                  size="icon"
                  className="size-7 cursor-default rounded-lg"
                  onClick={() => request.cancelPrompt({ sessionId: session.id })}
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
                    disabled={disabled || (!localInput.trim() && draftAttachments.length === 0)}
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
      maxHeight: 200,
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
      opacity: 0.8,
    },
  },
  suggestions: {
    zIndex: 30,
    left: -1,
    right: -1,
    top: "auto",
    bottom: "100%",
    marginBottom: 4,
    marginTop: 0,
    backgroundColor: "transparent",
    list: {
      backgroundColor: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 7.2,
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
  opacity: 0.5,
  borderRadius: 3,
  margin: -1.5,
  padding: 1.5,
};
