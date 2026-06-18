import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { FileIcon as FileTypeIcon } from "../../../common/file-icon";
import { isWebUI, request } from "../../../../backend";
import { electron } from "../../../../electron";
import { resolveFileUrl } from "../../../../lib/file-url";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Check,
  X,
  Loader2,
  FileText,
  Pencil,
  Trash2,
  Move,
  Search,
  Terminal,
  Brain,
  Globe,
  ArrowRightLeft,
  Wrench,
  ImageIcon,
  FolderOpen,
  CopyPlus,
  MoreHorizontal,
} from "lucide-react";
import { stringify as toYamlString } from "json-to-pretty-yaml";
import { AgentTerminalOutput } from "../../../common/agent-terminal-output";
import { ContentBlocks } from "../../../content-blocks/content-blocks";
import { CodeView } from "../../../common/code-view";
import { CodeCompareView } from "../../../common/code-compare-view";
import type { ToolCallMessage } from "../../../../lib/chat-message";
import type { ToolCallStatus } from "@agentclientprotocol/sdk";
import type { SessionInfo } from "../../../../../shared/schema";
import type { BaseBubbleProps } from "./base-bubble";
import {
  shareToUserRespondSchema,
  isImageMimeType,
  type ShareToUserRespond,
} from "../../../../../shared/zod/mcp-share-to-user-schema";

const kindIcons: Record<string, React.ReactNode> = {
  read: <FileText className="size-3 text-blue-400" />,
  edit: <Pencil className="size-3 text-yellow-400" />,
  delete: <Trash2 className="size-3 text-red-400" />,
  move: <Move className="size-3 text-orange-400" />,
  search: <Search className="size-3 text-purple-400" />,
  execute: <Terminal className="size-3 text-green-400" />,
  think: <Brain className="size-3 text-cyan-400" />,
  fetch: <Globe className="size-3 text-sky-400" />,
  switch_mode: <ArrowRightLeft className="size-3 text-pink-400" />,
  other: <Wrench className="size-3 text-muted-foreground" />,
};

const statusIcons: Record<ToolCallStatus, React.ReactNode> = {
  pending: <Loader2 className="size-3 text-muted-foreground" />,
  in_progress: <Loader2 className="size-3 animate-spin text-primary" />,
  completed: <Check className="size-3 text-green-400" />,
  failed: <X className="size-3 text-destructive" />,
};

interface ToolItemProps {
  session: SessionInfo;
  message: ToolCallMessage;
}

/**
 * 检测 tool call 是否为 share_to_user 等内部工具。
 * 通过 rawInput 的结构特征判断（包含 type 字段且值为 "link" 或 "base64"）。
 */
export function parseFelloTools(
  message: ToolCallMessage,
): { type: "shareToUser"; respond: ShareToUserRespond } | null {
  if (!message.content) return null;
  if (!message.content.length) return null;
  if (message.content[0].type !== "content") return null;
  if (message.content[0].content.type !== "text") return null;
  const text = message.content[0].content.text;
  try {
    const json = JSON.parse(text);
    if (json.fello) {
      if (json.fello["share-to-user"]) {
        const shareToUserRespondResult = shareToUserRespondSchema.safeParse(
          json.fello["share-to-user"],
        );
        if (shareToUserRespondResult.success) {
          return { type: "shareToUser", respond: shareToUserRespondResult.data };
        }
      }
    }
  } catch {}
  return null;
}

export function ToolItem({ session, message }: ToolItemProps) {
  const { t } = useTranslation();
  const activeProjectId = session.projectId;
  const status: ToolCallStatus = message.status ?? "completed";
  const kindIcon = (message.kind ? kindIcons[message.kind] : null) ?? kindIcons.other;
  const userAction = useRef<boolean>(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (userAction.current === true) {
      return;
    }
    if (message.kind === "execute" && message.status === "in_progress") {
      const timer = setTimeout(() => setOpen(true), 2000);
      return () => clearTimeout(timer);
    } else {
      setOpen(false);
    }
  }, [message.kind, message.status]);

  const onOpenChange = useCallback((open: boolean) => {
    userAction.current = true;
    setOpen(open);
  }, []);

  return (
    <Collapsible
      className="text-xs min-w-0 overflow-hidden group"
      open={open}
      onOpenChange={onOpenChange}
    >
      <CollapsibleTrigger
        render={<div />}
        nativeButton={false}
        className={cn(
          "flex select-none items-center gap-2 px-2.5 py-2 hover:bg-secondary",
          open && "bg-secondary",
        )}
      >
        {kindIcon}
        <span className="min-w-0 flex-1 font-normal text-foreground truncate">
          {message.title || t("toolBubble.tool")}
        </span>
        {message.locations && message.locations.length > 0 && (
          <div className="flex min-w-0 max-w-[45%] flex-nowrap items-center justify-end gap-1 overflow-x-auto">
            {message.locations.map((loc, i) => {
              const fileName = loc.path.split("/").pop() ?? loc.path;
              const label = `${fileName}${loc.line != null ? `:${loc.line}` : ""}`;
              return (
                <Button
                  key={i}
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="shrink-0 h-5 gap-1 rounded px-1.5 font-normal text-secondary-foreground/80 hover:text-secondary-foreground"
                  title={loc.path}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!activeProjectId) return;

                    // 这里有可能给绝对路径，也可能给相对路径
                    let filePath = loc.path;
                    if (loc.path === session.cwd || loc.path.startsWith(session.cwd + "/")) {
                      filePath = loc.path.slice(session.cwd.length + 1);
                    }
                    if (filePath[0] === "/" || /^[a-zA-Z]:/.test(filePath)) {
                      if (!isWebUI) {
                        electron.revealInFinder(filePath);
                      }
                      return;
                    }
                    document.dispatchEvent(
                      new CustomEvent("fello-preview-file", {
                        detail: { projectId: activeProjectId, relativePath: filePath },
                      }),
                    );
                  }}
                >
                  <FileTypeIcon name={fileName} className="size-2.5" />
                  <span className="max-w-40 truncate">{label}</span>
                </Button>
              );
            })}
          </div>
        )}
        {statusIcons[status]}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border overflow-hidden bg-secondary/50">
        {message.content &&
          message.content.map((content, index) => {
            if (content.type === "content") {
              return (
                <div key={index} className="px-2 text-foreground/80">
                  {content.content.type === "text" ? (
                    <ScrollArea className="-mx-2" viewportClassName="max-h-[70vh]">
                      <pre className="m-0 p-2 text-[11px]">
                        <code>
                          {
                            // Strip ANSI escape sequences (e.g. \x1b[38;5;250m, [38;5;250m) for clean display
                            content.content.text
                              // eslint-disable-next-line no-control-regex
                              .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "")
                              .replace(/\[[0-9;]*[0-9]m/g, "")
                          }
                        </code>
                      </pre>
                    </ScrollArea>
                  ) : (
                    <ContentBlocks blocks={[content.content]} role="tool_call"></ContentBlocks>
                  )}
                </div>
              );
            } else if (content.type === "diff") {
              return (
                <div key={index} className="border-b border-border last:border-b-0 flex flex-col">
                  <div className="px-2 py-2 bg-muted/50 border-b border-border text-xs font-mono text-muted-foreground truncate flex items-center gap-2">
                    <FileTypeIcon
                      name={content.path.split("/").pop() ?? content.path}
                      className="size-3.5"
                    />
                    <span>
                      {content.path.startsWith(session.cwd)
                        ? content.path.slice(session.cwd.length + 1)
                        : content.path}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden w-full">
                    <ScrollArea className="w-full" viewportClassName="max-h-[70vh]">
                      {content.oldText == null || content.oldText === content.newText ? (
                        <CodeView
                          content={content.newText}
                          filename={content.path.split("/").pop()}
                        />
                      ) : (
                        <CodeCompareView
                          oldContent={content.oldText}
                          newContent={content.newText}
                          filename={content.path.split("/").pop()}
                        />
                      )}
                    </ScrollArea>
                  </div>
                </div>
              );
            }
            return null;
          })}
        {message.terminalId && (
          <AgentTerminalOutput sessionId={session.id} terminalId={message.terminalId} />
        )}
        {(!message.content || message.content.length === 0) && message.rawInput != null && (
          <ScrollArea viewportClassName="max-h-[70vh]">
            <pre className="p-2 m-0 text-[11px] leading-relaxed text-foreground/80">
              <code>
                {typeof message.rawInput === "string"
                  ? message.rawInput
                  : toYamlString(message.rawInput)}
              </code>
            </pre>
          </ScrollArea>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ShareToUserBubble({
  session,
  respond,
}: {
  session: SessionInfo;
  respond: ShareToUserRespond;
}) {
  const { sharePath, projectPath, name, mimeType } = respond;
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  const isImage = isImageMimeType(mimeType);
  const isProject = !!projectPath;

  const url = projectPath
    ? resolveFileUrl(`/project/${session.projectId}/${projectPath}`)
    : sharePath
      ? resolveFileUrl(`/share/${session.projectId}/${session.id}/${sharePath}`)
      : "";

  const handleCopyToProject = useCallback(async () => {
    if (!sharePath) return;
    try {
      const absPath = await request.getShareFileSystemPath({ sessionId: session.id, sharePath });
      await request.copyFileToWorkspace({ projectId: session.projectId, sourcePath: absPath });
    } catch (err) {
      console.error("Failed to copy to project:", err);
    }
  }, [session, sharePath]);

  const handleReveal = useCallback(async () => {
    try {
      if (projectPath) {
        electron.revealInFinder(`${session.cwd}/${projectPath}`);
      } else if (sharePath) {
        const absPath = await request.getShareFileSystemPath({ sessionId: session.id, sharePath });
        electron.revealInFinder(absPath);
      }
    } catch (err) {
      console.error("Failed to reveal in finder:", err);
    }
  }, [session, sharePath, projectPath]);

  return (
    <div className="share-to-user-bubble border border-border bg-secondary/40 rounded-md overflow-hidden pointer-events-auto my-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-card">
        {isImage ? (
          <ImageIcon className="size-4 text-sky-500 shrink-0" />
        ) : (
          <FileTypeIcon name={name} className="size-4 shrink-0" />
        )}
        <span className="flex-1 min-w-0 truncate text-xs font-medium text-foreground">{name}</span>

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex shrink-0 items-center justify-center rounded-md hover:bg-muted hover:text-foreground size-6 text-xs text-foreground/70 outline-none">
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {!isProject && (
              <DropdownMenuItem onClick={handleCopyToProject}>
                <CopyPlus />
                {t("shareToUser.copyToProject", "Copy to project")}
              </DropdownMenuItem>
            )}
            {!isWebUI && (
              <DropdownMenuItem onClick={handleReveal}>
                <FolderOpen />
                {t("shareToUser.reveal", "Reveal in Finder")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Content */}
      {isImage ? (
        <div className="flex items-center justify-center bg-muted/10 min-h-32">
          {error ? (
            <p className="text-xs text-muted-foreground p-4">
              {t("shareToUser.loadFailed", "Failed to load image")}
            </p>
          ) : (
            <img
              src={url}
              alt={name}
              className="max-w-full max-h-[60vh] object-contain"
              onError={() => setError(true)}
            />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">
          <FileTypeIcon name={name} className="size-8 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{name}</p>
            {mimeType && <p className="text-xs text-muted-foreground">{mimeType}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ToolBubble({
  session,
  message,
  isStreaming: _isStreaming,
}: BaseBubbleProps<ToolCallMessage>) {
  const felloTool = useMemo(() => parseFelloTools(message), [message.content]);

  if (felloTool?.type === "shareToUser") {
    return <ShareToUserBubble session={session} respond={felloTool.respond} />;
  }

  return (
    <div className="tool-bubble border border-border bg-secondary/40 rounded-none overflow-hidden pointer-events-auto [&:not(.tool-bubble+.tool-bubble)]:rounded-t-md [&:not(.tool-bubble+.tool-bubble)]:mt-4 [&:not(:has(+.tool-bubble))]:rounded-b-md [&:not(:has(+.tool-bubble))]:mb-4">
      <ToolItem session={session} message={message} />
    </div>
  );
}
