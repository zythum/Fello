import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { MentionsInput, Mention, type MentionsInputStyle } from "react-mentions";
import { useSessionAskUserRequests } from "../../../lib/session-selectors";
import * as backend from "../../../backend";
import { useAppStore } from "../../../store";
import { electron } from "../../../electron";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  HelpCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Clock,
  Folder,
  FileText,
  Wrench,
  Library,
  ImageIcon,
  Paperclip,
  Clipboard,
  Hash,
  AtSign,
} from "lucide-react";
import { stringify as toYaml } from "json-to-pretty-yaml";
import {
  MENTION_MARKUP,
  AT_SUGGESTION_MAX,
  resolveMentions,
  insertMentionsAtCursor,
  absPathToMention,
  isImagePath,
  searchFileItemToSuggestItem,
  skillInfoToSuggestItem,
  mcpServerInfoToSuggestItem,
  type SuggestItem,
} from "../../../lib/mention-utils";
import type { AskUserRequest } from "../../../../shared/schema";
import {
  VoiceInputButton,
  type VoiceInputButtonRef,
} from "../../common/voice-input-button";

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
    setCollapsed(false);
  }, [currentRequest?.askUserId]);

  // 当 askUserRequests 变化时，管理排队和动画
  useEffect(() => {
    if (!askUserRequests || askUserRequests.length === 0) {
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
          onClick={() => setCollapsed(false)}
          className="grid grid-rows-[auto_1fr_auto] rounded-xl border border-border bg-card p-4 shadow-lg shadow-primary/5 max-h-[90vh]"
        >
          {/* 标题 — 固定不折叠 */}
          <div className="flex items-center gap-2 mb-3 min-h-0">
            <HelpCircle className="size-4.5 shrink-0 text-sky-500" />
            <h3 className="text-sm font-medium leading-snug truncate">
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
 * 拖拽 / 补全的 #image / #file / #folder / #resource 标记统一复用 mention-utils 的
 * absPathToMention / searchFileItemToSuggestItem，优先级与 chat-input 完全一致：
 * 图片 → #image:，项目内 → #file:/#folder:，项目外 → #resource:。
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
  const [isDragOver, setIsDragOver] = useState(false);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceInputRef = useRef<VoiceInputButtonRef>(null);
  const navigate = useNavigate();
  const snippets = useAppStore((s) => s.snippets);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getTextarea = useCallback(() => textareaRef.current, []);

  /**
   * 在光标处插入 # 或 @ 并触发展开建议弹层（与 chat-input 行为一致）。
   * react-mentions 只在 selectionchange → onSelect 时刷新建议，execCommand 不触发
   * selectionchange，因此手动补发一次。光标前已有内容且非空白时补 1 个前导空格。
   */
  const insertTriggerChar = useCallback(
    (char: "#" | "@") => {
      const textarea = getTextarea();
      if (!textarea) return;
      textarea.focus();
      const before = textarea.value.slice(0, textarea.selectionStart);
      const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
      const prefix = needsLeadingSpace ? " " : "";
      document.execCommand("insertText", false, `${prefix}${char}`);
      textarea.ownerDocument.dispatchEvent(new Event("selectionchange"));
    },
    [getTextarea],
  );

  /** Attach file：选择文件 → 与拖拽一致生成 #image:/#file:/#resource: tag 插入光标处 */
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      const session = useAppStore.getState().sessions.find((s) => s.id === request.sessionId);
      const projectId = session?.projectId;
      const projectCwd = session?.cwd;
      const textarea = getTextarea();
      if (!projectId || !textarea) return;

      const paths: { path: string; isImage: boolean }[] = [];
      for (const file of files) {
        const absPath = electron.getPathForFile(file);
        if (absPath) paths.push({ path: absPath, isImage: file.type.startsWith("image/") });
      }
      if (paths.length === 0) return;

      textarea.focus();
      const tags = await Promise.all(
        paths.map(({ path, isImage }) => absPathToMention(path, projectId, projectCwd, isImage)),
      );
      insertMentionsAtCursor(textarea, tags);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [request.sessionId, getTextarea],
  );

  /** 拖入文件 → 解析为绝对路径，异步生成 mention 并插入光标处 */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const session = useAppStore.getState().sessions.find((s) => s.id === request.sessionId);
      const projectId = session?.projectId;
      const projectCwd = session?.cwd;
      if (!projectId) return;

      const paths: { path: string; isImage: boolean }[] = [];

      // Handle files drop (desktop: File.path via electron)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        for (const file of Array.from(e.dataTransfer.files)) {
          const absPath = electron.getPathForFile(file);
          if (absPath) paths.push({ path: absPath, isImage: file.type.startsWith("image/") });
        }
      }

      // Handle file:// URIs from external sources (VS Code file tree drag, webUI, etc.)
      if (paths.length === 0) {
        const uriList = e.dataTransfer.getData("text/uri-list");
        const uris =
          uriList
            ?.split("\n")
            .map((u) => u.trim())
            .filter(Boolean) ?? [];
        for (const uri of uris) {
          if (!uri.startsWith("file://")) continue;
          const absPath = decodeURIComponent(uri.replace(/^file:\/\//, ""));
          if (absPath) paths.push({ path: absPath, isImage: isImagePath(absPath) });
        }
      }

      if (paths.length === 0) return;

      void (async () => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        // execCommand("insertText") 需要 textarea 处于聚焦状态，否则静默失败；
        // 未聚焦时拖入文件会出现高亮但内容插不进去（与 chat-input 的 insertPathMentions 一致）
        textarea.focus();
        const tags = await Promise.all(
          paths.map(({ path, isImage }) => absPathToMention(path, projectId, projectCwd, isImage)),
        );
        insertMentionsAtCursor(textarea, tags);
      })();
    },
    [request.sessionId],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Must always preventDefault on dragover to allow drop
    if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list")) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  /** Fetch file suggestions from backend (called by react-mentions on each keystroke) */
  const fetchFileSuggestions = useCallback(
    (search: string, callback: (data: SuggestItem[]) => void) => {
      const session = useAppStore.getState().sessions.find((s) => s.id === request.sessionId);
      if (!session?.projectId) {
        callback([]);
        return;
      }
      void backend.request
        .searchFiles({ projectId: session.projectId, query: search || undefined })
        .then((results) => callback(results.map((f) => searchFileItemToSuggestItem(f))))
        .catch(() => callback([]));
    },
    [request.sessionId],
  );

  /** Fetch @ suggestions: skills + MCP servers (cached and filtered locally) */
  const fetchAtSuggestions = useCallback(
    (search: string, callback: (data: SuggestItem[]) => void) => {
      const lowerSearch = (search || "").toLowerCase();
      const session = useAppStore.getState().sessions.find((s) => s.id === request.sessionId);
      const enabledMcpServers = useAppStore
        .getState()
        .configuredMcpServers.filter((m) => session?.mcpServers.includes(m.id) ?? false);
      const mcpItems = enabledMcpServers
        .filter(
          (m) =>
            !lowerSearch ||
            m.id.toLowerCase().includes(lowerSearch) ||
            (m.type === "stdio" && m.command.toLowerCase().includes(lowerSearch)) ||
            (m.type === "http" && m.url.toLowerCase().includes(lowerSearch)),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => mcpServerInfoToSuggestItem(m))
        .slice(0, AT_SUGGESTION_MAX);

      const projectId = session?.projectId;
      if (!projectId) {
        callback(mcpItems);
        return;
      }
      void backend.request
        .getSkillsCatalog({ projectId })
        .then((results) => {
          const skills = results
            .filter(
              (s) =>
                !lowerSearch ||
                s.name.toLowerCase().includes(lowerSearch) ||
                s.description?.toLowerCase().includes(lowerSearch),
            )
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => skillInfoToSuggestItem(s))
            .slice(0, AT_SUGGESTION_MAX);
          callback([...mcpItems, ...skills]);
        })
        .catch(() => callback(mcpItems));
    },
    [request.sessionId],
  );

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
  }, [mode, hasOptions, request.options, handleSelectOption]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmitInput();
    }
  };

  // 切换到输入模式时聚焦（@types/react-mentions 未声明 autoFocus，手动聚焦）
  useEffect(() => {
    if (mode === "input") {
      textareaRef.current?.focus();
    }
  }, [mode]);

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
              className="justify-start h-8 px-2 text-xs text-muted-foreground"
              onClick={() => setMode("input")}
            >
              <span>{t("askUser.other", "Custom reply")}</span>
              <ArrowRight className="size-3" />
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
              <ArrowLeft className="size-3" />
              <span>{t("askUser.back", "Use options")}</span>
            </Button>
          )}
          <div
            ref={inputContainerRef}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`rounded-lg border bg-card focus-within:border-ring focus-within:ring-ring relative transition-colors ${
              isDragOver ? "border-primary ring-0.5 ring-primary bg-primary/5" : "border-input"
            }`}
          >
            <MentionsInput
              value={inputValue}
              inputRef={textareaRef}
              onChange={(_e, newValue) => setInputValue(newValue)}
              onKeyDown={handleKeyDown}
              placeholder={t("askUser.inputPlaceholder", "Type your response... (Enter to send)")}
              style={askUserMentionsStyle}
              aria-label={t("chatInput.messageInput", "Message input")}
              a11ySuggestionsListLabel={t("chatInput.suggestions", "Suggestions")}
              className="chat-mentions-input"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            >
              <Mention
                trigger="#"
                data={fetchFileSuggestions}
                markup={MENTION_MARKUP}
                displayTransform={(_id, display) => display}
                style={mentionStyle}
                appendSpaceOnAdd
                renderSuggestion={(suggestion) => {
                  const display = suggestion.display ?? "";
                  const isFolder = display.startsWith("#folder:");
                  const isImage = display.startsWith("#image:");
                  const name = String(suggestion.id).split("/").pop();
                  return (
                    <div className="flex items-center gap-1">
                      {isFolder ? (
                        <Folder className="size-3.5 text-muted-foreground" />
                      ) : isImage ? (
                        <ImageIcon className="size-3.5 text-muted-foreground" />
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
                  if (display.startsWith("@mcp:")) {
                    const mcp = useAppStore
                      .getState()
                      .configuredMcpServers.find((m) => m.id === suggestion.id);
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
                  return (
                    <div className="flex items-center gap-1">
                      <Library className="size-3.5 text-muted-foreground" />
                      <span className="text-xs whitespace-nowrap text-foreground">
                        {suggestion.id}
                      </span>
                    </div>
                  );
                }}
              />
            </MentionsInput>
            {/* 底部工具栏：Attach file / Snippets / # / @ + 提交按钮（与 chat-input 一致） */}
            <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between">
              <div className="flex items-center gap-0.5">
                <input
                  type="file"
                  multiple
                  accept="*/*"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 rounded-lg text-muted-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={t("chatInput.attach", "Attach file")}
                >
                  <Paperclip className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 rounded-lg text-muted-foreground"
                  aria-label={t("chatInput.reference", "Reference")}
                  onClick={() => insertTriggerChar("#")}
                >
                  <Hash className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 rounded-lg text-muted-foreground"
                  aria-label={t("chatInput.mention", "Mention")}
                  onClick={() => insertTriggerChar("@")}
                >
                  <AtSign className="size-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-lg text-muted-foreground"
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
                            getTextarea()?.focus();
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
              <div className="flex items-center gap-2">
                <VoiceInputButton ref={voiceInputRef} inputRef={textareaRef} />
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
        </div>
      )}
    </>
  );
}

/** Inline styles for MentionsInput in the ask-user input (height aligned with chat-input: input area ≈54px) */
const askUserMentionsStyle: MentionsInputStyle = {
  control: {
    fontSize: 12,
    lineHeight: "1.625",
  },
  "&multiLine": {
    control: {
      minHeight: 104,
    },
    highlighter: {
      padding: "12px 12px 38px",
      border: "none",
      maxHeight: 200,
    },
    input: {
      padding: "12px 12px 38px",
      border: "none",
      outline: "none",
      overflow: "auto",
      maxHeight: 200,
      color: "var(--foreground)",
      fontSize: 12,
      lineHeight: "1.625",
      opacity: 0.8,
      wordBreak: "break-all",
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
  borderRadius: 2,
  margin: -0.5,
  padding: 0.5,
};
