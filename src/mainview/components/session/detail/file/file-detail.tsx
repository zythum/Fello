import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { request } from "../../../../backend";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { File } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CodeView } from "../../../common/code-view";
import { CodeCompareView } from "../../../common/code-compare-view";
import { StreamMarkdown } from "../../../common/stream-markdown";
import { ImageView } from "../../../common/image-view";
import { PdfView } from "../../../common/pdf-view";
import { DocxView } from "../../../common/docx-view";
import { PptxView } from "../../../common/pptx-view";
import { XlsxView } from "../../../common/xlsx-view";

import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { MessageSquarePlus, Copy, X } from "lucide-react";
import { SearchBar } from "./search-bar";
import { useSearchHighlight } from "../../../common/use-search-highlight";

export interface FileDetailProps {
  projectId: string | null;
  file: string | null;
  onClose?: () => void;
}

type FileKind = "image" | "markdown" | "text" | "pdf" | "docx" | "pptx" | "xlsx";
type ViewMode = "preview" | "code" | "compare";

const fileModesMap: Record<FileKind, ViewMode[]> = {
  text: ["code", "compare"],
  markdown: ["preview", "code", "compare"],
  image: ["preview"],
  pdf: ["preview"],
  docx: ["preview"],
  pptx: ["preview"],
  xlsx: ["preview"],
};

/** 将 Base64 字符串解码为 ArrayBuffer */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

export function FileDetail({ projectId, file, onClose }: FileDetailProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string>("");
  const [gitContent, setGitContent] = useState<string | null>(null);
  const [fileKind, setFileKind] = useState<FileKind | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(fileModesMap["text"][0]);
  const [viewModes, setViewModes] = useState<ViewMode[]>(fileModesMap["text"]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [imageBase64, setImageBase64] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [selectedLineRange, setSelectedLineRange] = useState<{
    start: number;
    end: number;
    startColumn?: number;
    endColumn?: number;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const {
    searchTerm,
    setSearchTerm,
    matchCount,
    currentMatch,
    goToNext,
    goToPrev,
    reset: resetSearch,
  } = useSearchHighlight(searchOpen ? contentRef.current : null);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    resetSearch();
  }, [resetSearch]);

  // Close search when file or view mode changes (DOM content changes invalidate old ranges)
  useEffect(() => {
    setSearchOpen(false);
    resetSearch();
  }, [projectId, file, viewMode, resetSearch]);

  // Ctrl+F / Cmd+F to open search, Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        if (searchOpen) {
          // Already open: focus the input (handled by SearchBar re-mount)
          setSearchOpen(false);
          requestAnimationFrame(() => setSearchOpen(true));
        } else {
          openSearch();
        }
      }
      if (e.key === "Escape" && searchOpen) {
        e.preventDefault();
        closeSearch();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, openSearch, closeSearch]);

  useEffect(() => {
    setFileKind(null);
    setViewMode("code");
  }, [projectId, file]);

  useEffect(() => {
    if (!projectId || !file) return;
    let active = true;

    async function load(projectId: string, file: string) {
      setLoading(true);
      setErrorMsg("");
      setImageBase64("");
      setContent("");
      setGitContent(null);
      setFileKind(null);
      setViewMode("code");
      try {
        const safeProjectId = projectId;
        const safeRelativePath = file;
        const info = await request.getFileInfo({
          projectId: safeProjectId,
          relativePath: safeRelativePath,
        });
        if (!active) return;
        if (!info || !info.isFile) {
          setErrorMsg(t("fileDetail.fileNotFound"));
          setLoading(false);
          return;
        }

        if (info.size > 10 * 1024 * 1024) {
          setErrorMsg(t("fileDetail.fileTooLarge"));
          setLoading(false);
          return;
        }

        const ext = safeRelativePath.split(".").pop()?.toLowerCase() || "";
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"];
        const officeExts: Record<string, FileKind> = {
          pdf: "pdf",
          docx: "docx",
          pptx: "pptx",
          xlsx: "xlsx",
          xls: "xlsx",
        };

        if (imageExts.includes(ext)) {
          setFileKind("image");
          setViewModes(fileModesMap["image"]);
          setViewMode(fileModesMap["image"][0]);
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

        // Office 文档类型检测（二进制文件但可预览）
        const officeKind = officeExts[ext];
        if (officeKind) {
          setFileKind(officeKind);
          setViewModes(fileModesMap[officeKind]);
          setViewMode(fileModesMap[officeKind][0]);
          const base64 = await request.readFile({
            projectId: safeProjectId,
            relativePath: safeRelativePath,
            encoding: "base64",
          });
          if (!active) return;
          // 复用 imageBase64 状态暂存 base64 数据（互斥，不会同时使用）
          setImageBase64(base64);
          setLoading(false);
          return;
        }

        if (info.isBinary) {
          setErrorMsg(t("fileDetail.fileFormatNotSupported"));
          setLoading(false);
          return;
        }

        const [current, git] = await Promise.all([
          request.readFile({ projectId: safeProjectId, relativePath: safeRelativePath }),
          request.readGitHeadFile({ projectId: safeProjectId, relativePath: safeRelativePath }),
          new Promise((resolve) => setTimeout(resolve, 300)),
        ]);
        if (!active) return;
        const isMarkdown = ext === "md";
        const fileKind: FileKind = isMarkdown ? "markdown" : "text";
        setFileKind(fileKind);
        setViewModes(fileModesMap[fileKind]);
        setViewMode(fileModesMap[fileKind][0]);
        setContent(current);
        setGitContent(git);
      } catch (e) {
        if (!active) return;
        console.error(e);
        setErrorMsg(t("fileDetail.errorLoading"));
      } finally {
        if (active) setLoading(false);
      }
    }
    load(projectId, file);
    return () => {
      active = false;
    };
  }, [projectId, file]);

  const fileName = file?.split("/").pop() ?? "";
  // Memoize ArrayBuffer conversion to prevent creating a new reference on every render,
  // which would cause PdfView/DocxView/PptxView/XlsxView to re-process their data and flicker
  const arrayBuffer = useMemo(() => base64ToArrayBuffer(imageBase64), [imageBase64]);
  const finalViewModes = viewModes.filter((mode) => {
    if (mode === "compare") return gitContent != null;
    return true;
  });

  const showTabs = !loading && !errorMsg && fileKind !== null && finalViewModes.length > 1;

  /** Calculate the 1-based column position within a .line element from a DOM selection range */
  const getColumnInLine = useCallback(
    (container: Element, node: Node, offset: number): number | undefined => {
      const lineEl =
        node.nodeType === Node.TEXT_NODE
          ? (node.parentElement?.closest(".line") as Element | null)
          : (node as Element).closest(".line");
      if (!lineEl) return undefined;

      // Walk through all text nodes within the line, summing lengths to find the column
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, null);
      let col = 0;
      let found = false;
      let textNode: Node | null = walker.firstChild();
      while (textNode) {
        if (textNode === node) {
          col += offset;
          found = true;
          break;
        }
        col += textNode.textContent?.length ?? 0;
        textNode = walker.nextSibling();
      }

      if (!found) return undefined;
      // Return 1-based column
      return col + 1;
    },
    [],
  );

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
    let startColumn: number | undefined;
    let endColumn: number | undefined;

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

    // Compute column positions if we have valid line numbers
    if (start !== -1 && end !== -1 && start > 0 && end > 0) {
      const startNode = range.startContainer;
      const endNode = range.endContainer;

      // For single-line selection, compute both start and end columns
      if (start === end) {
        startColumn = getColumnInLine(container, startNode, range.startOffset);
        endColumn = getColumnInLine(container, endNode, range.endOffset);
        // Ensure startColumn <= endColumn
        if (startColumn !== undefined && endColumn !== undefined && startColumn > endColumn) {
          const temp = startColumn;
          startColumn = endColumn;
          endColumn = temp;
        }
      } else {
        // Multi-line: compute start column on start line, end column on end line
        startColumn = getColumnInLine(container, startNode, range.startOffset);
        endColumn = getColumnInLine(container, endNode, range.endOffset);
      }

      setSelectedLineRange({ start, end, startColumn, endColumn });
    } else {
      setSelectedLineRange(null);
    }
  };

  const handleAddToChat = () => {
    if (!file || !selectedLineRange) return;
    const { start, end, startColumn, endColumn } = selectedLineRange;
    let suffix: string;
    if (start === end) {
      // Single line
      suffix =
        startColumn !== undefined && endColumn !== undefined
          ? `${start}:${startColumn}-${endColumn}`
          : `${start}`;
    } else {
      // Multi-line
      suffix =
        startColumn !== undefined && endColumn !== undefined
          ? `${start}:${startColumn}-${end}:${endColumn}`
          : `${start}-${end}`;
    }
    const nodeId = `${file}:${suffix}`;
    // Use full file path instead of just filename for proper display
    const nodeName = `${file}:${suffix}`;
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
      <div
        className="h-12 shrink-0 border-b border-border flex items-center justify-between gap-2 px-2 bg-background"
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="flex items-center min-w-0 flex-1">
          <div className="min-w-0 flex items-center gap-1.5">
            <File className="size-4 shrink-0 text-muted-foreground/80" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs truncate leading-tight text-foreground/60">{file}</span>
            </div>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            style={{ WebkitAppRegion: "no-drag" }}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="relative flex-1 min-h-0">
        {loading ? (
          <div className="text-sm text-muted-foreground text-center mt-10">
            {t("fileDetail.loading")}
          </div>
        ) : errorMsg ? (
          <div className="text-sm text-muted-foreground text-center mt-10">{errorMsg}</div>
        ) : viewMode === "preview" && finalViewModes.includes("preview") ? (
          // Office 文档使用全高度独立渲染（自带滚动和工具栏）
          <div className="w-full h-full">
            {fileKind === "pdf" ? (
              <PdfView data={arrayBuffer} filename={fileName} />
            ) : fileKind === "docx" ? (
              <DocxView data={arrayBuffer} filename={fileName} />
            ) : fileKind === "pptx" ? (
              <PptxView data={arrayBuffer} filename={fileName} />
            ) : fileKind === "xlsx" ? (
              <XlsxView data={arrayBuffer} filename={fileName} />
            ) : fileKind === "image" ? (
              <ScrollArea className="w-full h-full">
                <div className="w-max">
                  <ImageView src={imageBase64} filename={fileName} />
                </div>
              </ScrollArea>
            ) : fileKind === "markdown" ? (
              <ScrollArea className="w-full h-full">
                <div className="prose prose-sm dark:prose-invert max-w-none p-6 min-h-full bg-background font-sans pb-20">
                  <StreamMarkdown>{content}</StreamMarkdown>
                </div>
              </ScrollArea>
            ) : null}
          </div>
        ) : viewMode === "code" && finalViewModes.includes("code") ? (
          <ScrollArea className="w-full h-full">
            <div ref={contentRef} className="w-max">
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
            </div>
          </ScrollArea>
        ) : viewMode === "compare" && finalViewModes.includes("compare") ? (
          <ScrollArea className="w-full h-full">
            <div className="min-h-full bg-[#ffffff] dark:bg-[#24292e] text-[12px] font-mono pb-20">
              <CodeCompareView
                oldContent={gitContent ?? ""}
                newContent={content}
                filename={fileName}
              />
            </div>
          </ScrollArea>
        ) : null}
        {searchOpen && (
          <SearchBar
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            onNext={goToNext}
            onPrev={goToPrev}
            onClose={closeSearch}
            matchCount={matchCount}
            currentMatch={currentMatch}
          />
        )}
      </div>
      {showTabs && (
        <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center">
          <Tabs value={viewMode} onValueChange={(v: ViewMode) => setViewMode(v)}>
            <TabsList className="h-8 border border-border shadow-lg">
              {viewModes.map((mode) => {
                if (mode === "preview") {
                  return (
                    <TabsTrigger key="preview" value="preview" className="text-xs min-w-18">
                      {t("fileDetail.preview")}
                    </TabsTrigger>
                  );
                } else if (mode === "code") {
                  return (
                    <TabsTrigger key="code" value="code" className="text-xs min-w-18">
                      {t("fileDetail.code")}
                    </TabsTrigger>
                  );
                } else if (mode === "compare") {
                  return (
                    <TabsTrigger key="compare" value="compare" className="text-xs min-w-18">
                      {t("fileDetail.compare")}
                    </TabsTrigger>
                  );
                }
                return null;
              })}
            </TabsList>
          </Tabs>
        </div>
      )}
    </div>
  );
}
