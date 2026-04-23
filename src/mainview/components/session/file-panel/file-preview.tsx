import { useEffect, useState } from "react";
import { request } from "../../../backend";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { File } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CodeView } from "../../common/code-view";
import { CodeCompareView } from "../../common/code-compare-view";
import { StreamMarkdown } from "../../common/stream-markdown";
import { ImageView } from "../../common/image-view";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { MessageSquarePlus, Copy } from "lucide-react";

export interface FilePreviewProps {
  projectId: string | null;
  relativePath: string | null;
}

type FileKind = "image" | "markdown" | "text";
type ViewMode = "preview" | "code" | "compare";

export function FilePreview({ projectId, relativePath }: FilePreviewProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string>("");
  const [gitContent, setGitContent] = useState<string | null>(null);
  const [fileKind, setFileKind] = useState<FileKind | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("code");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [imageBase64, setImageBase64] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [selectedLineRange, setSelectedLineRange] = useState<{ start: number; end: number } | null>(
    null,
  );

  useEffect(() => {
    setFileKind(null);
    setViewMode("code");
  }, [relativePath]);

  useEffect(() => {
    if (!projectId || !relativePath) return;
    let active = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setImageBase64("");
      setContent("");
      setGitContent(null);
      setFileKind(null);
      setViewMode("code");
      try {
        const safeProjectId = projectId!;
        const safeRelativePath = relativePath!;
        const info = await request.getFileInfo({
          projectId: safeProjectId,
          relativePath: safeRelativePath,
        });
        if (!active) return;
        if (!info || !info.isFile) {
          setErrorMsg(t("filePreview.fileNotFound"));
          setLoading(false);
          return;
        }

        if (info.size > 10 * 1024 * 1024) {
          setErrorMsg(t("filePreview.fileTooLarge"));
          setLoading(false);
          return;
        }

        const ext = safeRelativePath.split(".").pop()?.toLowerCase() || "";
        const isMarkdown = ext === "md";
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"];

        if (imageExts.includes(ext)) {
          setFileKind("image");
          setViewMode("preview");
          const base64 = await request.readFile({
            projectId: safeProjectId,
            relativePath: safeRelativePath,
            encoding: "base64",
          });
          if (!active) return;
          let mimeType = ext;
          if (ext === "svg") mimeType = "svg+xml";
          else if (ext === "jpg") mimeType = "jpeg";
          setImageBase64(`data:image/${mimeType};base64,${base64}`);
          setLoading(false);
          return;
        }

        if (info.isBinary) {
          setErrorMsg(t("filePreview.fileFormatNotSupported"));
          setLoading(false);
          return;
        }

        const [current, git] = await Promise.all([
          request.readFile({ projectId: safeProjectId, relativePath: safeRelativePath }),
          request.readGitHeadFile({ projectId: safeProjectId, relativePath: safeRelativePath }),
          new Promise((resolve) => setTimeout(resolve, 300)),
        ]);
        if (!active) return;
        setFileKind(isMarkdown ? "markdown" : "text");
        setViewMode(isMarkdown ? "preview" : "code");
        setContent(current);
        setGitContent(git);
      } catch (e) {
        if (!active) return;
        console.error(e);
        setErrorMsg(t("filePreview.errorLoading"));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [projectId, relativePath]);

  const fileName = relativePath?.split("/").pop() ?? "";
  const canCompare = gitContent != null;
  const showTabs = !loading && !errorMsg && fileKind !== null && fileKind !== "image";

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (viewMode !== "code" && viewMode !== "compare") return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectedLineRange(null);
      setSelectedText("");
      return;
    }

    setSelectedText(selection.toString());

    const container = e.currentTarget;
    const range = selection.getRangeAt(0);

    if (!container.contains(range.commonAncestorContainer)) {
      setSelectedLineRange(null);
      return;
    }

    const lines = Array.from(container.querySelectorAll(".line"));
    if (lines.length === 0) {
      setSelectedLineRange(null);
      return;
    }

    let start = -1;
    let end = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (selection.containsNode(line, true)) {
        if (start === -1) start = i + 1;
        end = i + 1;
      }
    }

    if (start === -1) {
      let startNode = range.startContainer as Node | null;
      let endNode = range.endContainer as Node | null;

      const startLine =
        startNode?.nodeType === Node.TEXT_NODE
          ? startNode.parentElement?.closest(".line")
          : (startNode as Element)?.closest(".line");
      const endLine =
        endNode?.nodeType === Node.TEXT_NODE
          ? endNode.parentElement?.closest(".line")
          : (endNode as Element)?.closest(".line");

      if (startLine && endLine) {
        start = lines.indexOf(startLine as Element) + 1;
        end = lines.indexOf(endLine as Element) + 1;
        if (start > end) {
          const temp = start;
          start = end;
          end = temp;
        }
      } else if (startLine) {
        start = end = lines.indexOf(startLine as Element) + 1;
      } else if (endLine) {
        start = end = lines.indexOf(endLine as Element) + 1;
      }
    }

    if (start !== -1 && end !== -1 && start > 0 && end > 0) {
      setSelectedLineRange({ start, end });
    } else {
      setSelectedLineRange(null);
    }
  };

  const handleAddToChat = () => {
    if (!relativePath || !selectedLineRange) return;
    const { start, end } = selectedLineRange;
    const suffix = start === end ? `${start}` : `${start}-${end}`;
    const nodeId = `${relativePath}:${suffix}`;
    const nodeName = `${fileName}:${suffix}`;
    const nodesPayloads = [{ id: nodeId, name: nodeName, isFolder: false }];
    document.dispatchEvent(new CustomEvent("fello-add-to-chat", { detail: nodesPayloads }));
  };

  const handleCopy = () => {
    if (selectedText) {
      navigator.clipboard.writeText(selectedText);
    }
  };

  return (
    <div className="flex flex-col w-full h-full min-w-0 relative overflow-hidden">
      <div className="h-10 shrink-0 border-b flex items-center justify-between gap-2 px-4 py-1 bg-[#ffffff] dark:bg-[#24292e]">
        <div className="flex items-center min-w-0 flex-1">
          <div className="min-w-0 flex items-center gap-1.5">
            <File className="size-4 shrink-0 text-muted-foreground/80" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs truncate leading-tight text-foreground/60">
                {relativePath}
              </span>
            </div>
          </div>
        </div>
      </div>
      <ScrollArea className="flex-1 w-full h-0">
        {loading ? (
          <div className="text-sm text-muted-foreground text-center mt-10">
            {t("filePreview.loading")}
          </div>
        ) : errorMsg ? (
          <div className="text-sm text-muted-foreground text-center mt-10">{errorMsg}</div>
        ) : fileKind === "image" ? (
          <ImageView src={imageBase64} filename={fileName} />
        ) : viewMode === "compare" ? (
          <div className="min-h-full bg-[#ffffff] dark:bg-[#24292e] text-[12px] font-mono pb-20">
            <CodeCompareView
              oldContent={gitContent ?? ""}
              newContent={content}
              filename={fileName}
            />
          </div>
        ) : fileKind === "markdown" && viewMode === "preview" ? (
          <div className="prose prose-sm dark:prose-invert max-w-none p-6 min-h-full bg-background font-sans pb-20">
            <StreamMarkdown>{content}</StreamMarkdown>
          </div>
        ) : (
          <ContextMenu
            onOpenChange={(open) => {
              if (!open) {
                setSelectedLineRange(null);
                setSelectedText("");
              }
            }}
          >
            <ContextMenuTrigger
              className="min-h-full bg-[#ffffff] dark:bg-[#24292e] text-[12px] font-mono block select-text -mx-3 pb-20"
              onContextMenu={handleContextMenu}
            >
              <CodeView content={content} filename={fileName} />
            </ContextMenuTrigger>
            {(selectedLineRange || selectedText) && (
              <ContextMenuContent>
                {selectedText && (
                  <ContextMenuItem onClick={handleCopy}>
                    <Copy />
                    {t("userBubble.copy")}
                  </ContextMenuItem>
                )}
                {selectedLineRange && (
                  <ContextMenuItem onClick={handleAddToChat}>
                    <MessageSquarePlus />
                    {t("filePanel.addToChat")}
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            )}
          </ContextMenu>
        )}
      </ScrollArea>
      <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center pointer-events-none">
        <Tabs
          value={viewMode}
          onValueChange={(v: ViewMode) => setViewMode(v)}
          className={cn("pointer-events-auto", {
            "pointer-events-none opacity-50 transition-all": !showTabs,
          })}
        >
          <TabsList className="h-8 border border-border shadow-lg">
            {fileKind === "markdown" && (
              <TabsTrigger value="preview" className="text-xs min-w-18">
                {t("filePreview.preview")}
              </TabsTrigger>
            )}
            <TabsTrigger value="code" className="text-xs min-w-18">
              {t("filePreview.code")}
            </TabsTrigger>
            <TabsTrigger value="compare" disabled={!canCompare} className="text-xs min-w-18">
              {t("filePreview.compare")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
