import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { FileIcon as FileTypeIcon } from "../common/file-icon";
import { isWebUI, request } from "../../backend";
import { electron } from "../../electron";
import { resolveFileUrl } from "../../lib/file-url";
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
  Ellipsis,
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
  Download,
  EllipsisVertical,
  SquareChartGantt,
  Square,
} from "lucide-react";
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemHeader,
  ItemFooter,
} from "@/components/ui/item";
import { stringify as toYamlString } from "json-to-pretty-yaml";
import { AgentTerminalOutput } from "../common/agent-terminal-output";
import { ContentBlocks } from "../content-blocks/content-blocks";
import { CodeView } from "../common/code-view";
import { CodeCompareView } from "../common/code-compare-view";
import type { ToolCallMessage } from "../../lib/chat-message";
import type { ToolCallStatus } from "@agentclientprotocol/sdk";
import type { SessionInfo } from "../../../shared/schema";
import type { BaseBubbleProps } from "./base-bubble";
import {
  shareToUserRespondSchema,
  isImageMimeType,
  type ShareToUserRespond,
} from "../../../shared/zod/mcp-share-to-user-schema";
import {
  imageGenerationRespondSchema,
  type ImageGenerationRespond,
} from "../../../shared/zod/mcp-image-generation-schema";

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
  pending: <Ellipsis className="size-3 text-muted-foreground" />,
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
):
  | { type: "shareToUser"; respond: ShareToUserRespond }
  | { type: "imageGeneration"; respond: ImageGenerationRespond }
  | null {
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
      if (json.fello["image-generation"]) {
        const raw = json.fello["image-generation"];
        // Normalize: old format (single image with sharePath) → new format (images array)
        if (raw.sharePath && !raw.images) {
          raw.images = [{ sharePath: raw.sharePath, name: raw.name, mimeType: raw.mimeType }];
        }
        const imageGenRespondResult = imageGenerationRespondSchema.safeParse(raw);
        if (imageGenRespondResult.success) {
          return { type: "imageGeneration", respond: imageGenRespondResult.data };
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
  const [stopping, setStopping] = useState(false);

  const isRunningShell =
    message.kind === "execute" && message.status === "in_progress" && message.terminalId != null;

  const handleStop = useCallback(async () => {
    if (!message.terminalId || stopping) return;
    setStopping(true);
    try {
      await request.killAgentTerminal({
        sessionId: session.id,
        terminalId: message.terminalId,
      });
    } catch (err) {
      console.error("Failed to stop agent terminal:", err);
      setStopping(false);
    }
  }, [message.terminalId, session.id, stopping]);

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
          open && "bg-secondary/80",
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
        {isRunningShell && (
          <Button
            type="button"
            variant="destructive"
            size="xs"
            className="shrink-0 rounded-full px-2 disabled:opacity-100"
            title={t("toolBubble.stop")}
            disabled={stopping}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleStop();
            }}
          >
            {stopping ? (
              <Loader2 className="size-2.5 animate-spin" />
            ) : (
              <Square className="size-2.5 fill-current" />
            )}
            <span className="text-[10px]">
              {stopping ? t("toolBubble.stopping") : t("toolBubble.stop")}
            </span>
          </Button>
        )}
        {statusIcons[status]}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border overflow-hidden bg-secondary/50">
        {message.rawInput != null && (
          <ScrollArea
            viewportClassName="max-h-[70vh]"
            className="border-b border-border last:border-0"
          >
            <pre className="p-2 m-0 text-[11px] leading-relaxed text-foreground/80">
              <code>
                {typeof message.rawInput === "string"
                  ? message.rawInput
                  : toYamlString(message.rawInput)}
              </code>
            </pre>
          </ScrollArea>
        )}
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

  const handlePreview = useCallback(() => {
    if (!projectPath) return;
    document.dispatchEvent(
      new CustomEvent("fello-preview-file", {
        detail: { projectId: session.projectId, relativePath: projectPath },
      }),
    );
  }, [session.projectId, projectPath]);

  const handleDownload = useCallback(() => {
    const url = resolveFileUrl(`/share/${session.projectId}/${session.id}/${sharePath}`);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }, [session, name, sharePath]);

  const previewButton = isProject ? (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      onClick={handlePreview}
      title={t("shareToUser.preview", "Preview")}
    >
      <SquareChartGantt className="size-3.5" />
    </Button>
  ) : null;

  const menuActions = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="size-7 shrink-0" />}
      >
        <EllipsisVertical className="size-3.5" />
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
        {isWebUI && (
          <DropdownMenuItem onClick={handleDownload}>
            <Download />
            {t("shareToUser.download", "Download")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (isImage) {
    return (
      <div className="border border-border bg-secondary/40 rounded-md overflow-hidden pointer-events-auto my-4">
        <Item variant="muted" size="xs" className="border-0 rounded-none">
          <ItemMedia className="size-4 shrink-0 overflow-hidden rounded-sm flex items-center justify-center bg-muted/30">
            <ImageIcon className="size-5 text-sky-500" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="text-xs">{name}</ItemTitle>
          </ItemContent>
          <ItemActions className="gap-0">
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground mr-2">
              {t("constant.feature.shareToUser")}
            </span>
            {previewButton}
            {menuActions}
          </ItemActions>
        </Item>
        <div className="flex items-center justify-center bg-muted/10 min-h-32">
          {error ? (
            <p className="text-xs text-muted-foreground p-4">
              {t("shareToUser.loadFailed", "Failed to load image")}
            </p>
          ) : (
            <img
              src={url}
              alt={name}
              className="max-w-full max-h-[80vh] object-contain"
              onError={() => setError(true)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <Item variant="outline" size="sm" className="pointer-events-auto my-4">
      <ItemMedia className="size-10 shrink-0 overflow-hidden rounded-sm flex items-center justify-center bg-muted/30">
        <FileTypeIcon name={name} className="size-7" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{name}</ItemTitle>
        {mimeType && <ItemDescription className="text-xs">{mimeType}</ItemDescription>}
      </ItemContent>
      <ItemActions className="gap-0">
        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground mr-2">
          {t("constant.feature.shareToUser")}
        </span>
        {previewButton}
        {menuActions}
      </ItemActions>
    </Item>
  );
}

function ImageGenerationBubble({
  session,
  respond,
}: {
  session: SessionInfo;
  respond: ImageGenerationRespond;
}) {
  const { images, model, size, prompt } = respond;
  const { t } = useTranslation();
  const [errorSet, setErrorSet] = useState<Set<number>>(new Set());

  const handleDownload = useCallback(
    (img: { sharePath: string; name: string }) => {
      const url = resolveFileUrl(`/share/${session.projectId}/${session.id}/${img.sharePath}`);
      const a = document.createElement("a");
      a.href = url;
      a.download = img.name;
      a.click();
    },
    [session],
  );

  const handleCopyToProject = useCallback(
    async (img: { sharePath: string }) => {
      try {
        const absPath = await request.getShareFileSystemPath({
          sessionId: session.id,
          sharePath: img.sharePath,
        });
        await request.copyFileToWorkspace({ projectId: session.projectId, sourcePath: absPath });
      } catch (err) {
        console.error("Failed to copy to project:", err);
      }
    },
    [session],
  );

  const handleReveal = useCallback(
    async (img: { sharePath: string }) => {
      try {
        const absPath = await request.getShareFileSystemPath({
          sessionId: session.id,
          sharePath: img.sharePath,
        });
        electron.revealInFinder(absPath);
      } catch (err) {
        console.error("Failed to reveal in finder:", err);
      }
    },
    [session],
  );

  return (
    <>
      {images.map((img, idx) => (
        <div
          key={idx}
          className="border border-border bg-secondary/40 rounded-md overflow-hidden pointer-events-auto my-4"
        >
          <Item variant="muted" size="xs" className="border-0 rounded-none">
            <ItemHeader>
              <div className="flex items-center gap-2">
                <ImageIcon className="size-4 text-violet-500" />
                <ItemTitle className="text-xs">
                  {img.name}
                  <span className="text-[10px] text-muted-foreground font-normal">
                    {model}
                    {size ? ` · ${size}` : ""}
                  </span>
                </ItemTitle>
              </div>
              <ItemActions className="gap-0">
                <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground mr-2">
                  {t("constant.feature.imageGeneration")}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon" className="size-7 shrink-0" />}
                  >
                    <EllipsisVertical className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-40">
                    <DropdownMenuItem onClick={() => handleCopyToProject(img)}>
                      <CopyPlus />
                      {t("imageGeneration.copyToProject", "Copy to project")}
                    </DropdownMenuItem>
                    {!isWebUI && (
                      <DropdownMenuItem onClick={() => handleReveal(img)}>
                        <FolderOpen />
                        {t("imageGeneration.reveal", "Reveal in Finder")}
                      </DropdownMenuItem>
                    )}
                    {isWebUI && (
                      <DropdownMenuItem onClick={() => handleDownload(img)}>
                        <Download />
                        {t("imageGeneration.download", "Download")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </ItemHeader>
            <ItemFooter>
              <ItemDescription className="text-[10px]!">{prompt}</ItemDescription>
            </ItemFooter>
          </Item>
          <div className="flex items-center justify-center bg-muted/10 min-h-32">
            {errorSet.has(idx) ? (
              <p className="text-xs text-muted-foreground p-4">
                {t("imageGeneration.loadFailed", "Failed to load image")}
              </p>
            ) : (
              <img
                src={resolveFileUrl(`/share/${session.projectId}/${session.id}/${img.sharePath}`)}
                alt={prompt}
                className="max-w-full max-h-[60vh] object-contain"
                onError={() => setErrorSet((prev) => new Set([...prev, idx]))}
              />
            )}
          </div>
        </div>
      ))}
    </>
  );
}

export function ToolBubble({
  session,
  message,
  isStreaming: _isStreaming,
}: BaseBubbleProps<ToolCallMessage>) {
  const felloTool = useMemo(() => parseFelloTools(message), [message]);

  if (felloTool?.type === "shareToUser") {
    return <ShareToUserBubble session={session} respond={felloTool.respond} />;
  }

  if (felloTool?.type === "imageGeneration") {
    return <ImageGenerationBubble session={session} respond={felloTool.respond} />;
  }

  return (
    <div
      className={cn(
        "tool-bubble border-x border-t border-border bg-secondary/40 rounded-none overflow-hidden pointer-events-auto mbe-0",
        "[&:not(.tool-bubble+.tool-bubble)]:rounded-t-md [&:not(.tool-bubble+.tool-bubble)]:mt-4 [&:not(:has(+.tool-bubble))]:rounded-b-md",
        "[&:not(:has(+.tool-bubble))]:mb-4 [&:not(:has(+.tool-bubble))]:border-b",
      )}
    >
      <ToolItem session={session} message={message} />
    </div>
  );
}
