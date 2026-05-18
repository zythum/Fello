import { useMemo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { File, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { MessageSquarePlus, Copy, FolderOpen, RefreshCw } from "lucide-react";
import { request, isWebUI, subscribe } from "../../../../backend";
import { electron } from "../../../../electron";

import type { FileDetailProps } from "./file-types";
import { useFileLoading, base64ToArrayBuffer } from "./use-file-loading";
import { useFileSearch } from "./use-file-search";
import { useFileContextMenu } from "./use-file-context-menu";
import { FileViewTabs } from "./file-view-tabs";
import { SearchBar } from "./search-bar";

export function FileDetail({ projectId, file, onClose }: FileDetailProps) {
  const { t } = useTranslation();
  const fileName = file?.split("/").pop() ?? "";

  // ── file loading & type detection ──
  const {
    content,
    gitContent,
    fileKind,
    viewMode,
    viewModes,
    loading,
    errorMsg,
    imageBase64,
    setViewMode,
    refresh,
  } = useFileLoading(projectId, file);

  // ── search (only works in code mode via DOM highlights) ──
  const {
    searchOpen,
    searchTerm,
    setSearchTerm,
    matchCount,
    currentMatch,
    goToNext,
    goToPrev,
    closeSearch,
    contentRef,
  } = useFileSearch(projectId, file, viewMode);

  // ── right-click context menu (line selection / copy / add-to-chat) ──
  const {
    selectedText,
    selectedLineRange,
    handleContextMenu,
    handleAddToChat,
    handleCopy,
    clearSelection,
  } = useFileContextMenu(file, viewMode);

  const handleCopyFileContent = useCallback(() => {
    if (content) {
      navigator.clipboard.writeText(content);
    }
  }, [content]);

  const handleAddFileToChat = useCallback(() => {
    if (!file) return;
    document.dispatchEvent(
      new CustomEvent("fello-add-to-chat", {
        detail: [{ id: file, name: file, isFolder: false }],
      }),
    );
  }, [file]);

  const handleCopyPath = useCallback(async () => {
    if (!projectId || !file) return;
    const text = await request.getSystemFilePath({
      projectId,
      path: file,
      isAbsolute: true,
    });
    navigator.clipboard.writeText(text);
  }, [projectId, file]);

  const handleCopyRelativePath = useCallback(async () => {
    if (!projectId || !file) return;
    const text = await request.getSystemFilePath({
      projectId,
      path: file,
      isAbsolute: false,
    });
    navigator.clipboard.writeText(text);
  }, [projectId, file]);

  const handleRevealInFinder = useCallback(async () => {
    if (!projectId || !file || isWebUI) return;
    const absPath = await request.getSystemFilePath({
      projectId,
      path: file,
      isAbsolute: true,
    });
    electron.revealInFinder(absPath);
  }, [projectId, file]);

  // ── detect external file modifications via file watcher ──
  const [fileModified, setFileModified] = useState(false);

  useEffect(() => {
    if (!projectId || !file) return;

    const handler = (payload: { projectId: string; changes: string[] }) => {
      if (payload.projectId === projectId && payload.changes.includes(file)) {
        setFileModified(true);
      }
    };

    subscribe.on("fs-changed", handler);
    return () => {
      subscribe.off("fs-changed", handler);
    };
  }, [projectId, file]);

  const handleRefreshWithReset = useCallback(() => {
    setFileModified(false);
    refresh();
  }, [refresh]);

  // Memoize ArrayBuffer conversion to prevent creating a new reference on every render,
  // which would cause PdfView/DocxView/PptxView/XlsxView to re-process their data and flicker
  const arrayBuffer = useMemo(() => base64ToArrayBuffer(imageBase64), [imageBase64]);

  // Hide "compare" tab when there is no git content to compare against
  const finalViewModes = viewModes.filter((mode) => {
    if (mode === "compare") return gitContent != null;
    return true;
  });

  const showTabs = !loading && !errorMsg && fileKind !== null && finalViewModes.length > 1;

  return (
    <div className="flex flex-col w-full h-full min-w-0 relative overflow-hidden">
      {/* ── header bar ── */}
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

      {/* ── main content area ── */}
      <div className="relative flex-1 min-h-0">
        {/* file modified floating toast */}
        {fileModified && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-3 px-3 py-2 rounded-lg shadow-md bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800 text-xs text-sky-800 dark:text-sky-200">
            <span>{t("fileDetail.fileModifiedNotice", "文件已被修改，请刷新")}</span>
            <button
              type="button"
              onClick={handleRefreshWithReset}
              className="flex items-center gap-1 px-2 py-1 rounded bg-sky-200/60 hover:bg-sky-300/60 dark:bg-sky-800/50 dark:hover:bg-sky-700/50 transition-colors shrink-0"
            >
              <RefreshCw className="size-3" />
              {t("filePanel.refresh", "刷新")}
            </button>
          </div>
        )}
        {loading ? (
          <div className="text-sm text-muted-foreground text-center mt-10">
            {t("fileDetail.loading")}
          </div>
        ) : errorMsg ? (
          <div className="text-sm text-muted-foreground text-center mt-10">{errorMsg}</div>
        ) : viewMode === "preview" && finalViewModes.includes("preview") ? (
          /* preview mode: office docs / image / markdown */
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
          /* code view with context menu */
          <ScrollArea className="w-full h-full bg-[#ffffff] dark:bg-[#24292e]">
              <ContextMenu
                onOpenChange={(open) => {
                  if (!open) clearSelection();
                }}
              >
                <ContextMenuTrigger
                  className="min-h-full text-[12px] font-mono block select-text -mx-3 pb-20"
                  onContextMenu={handleContextMenu}
                >
                  <div ref={contentRef} className="w-max">
                    <CodeView content={content} filename={fileName} />
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {selectedText && (
                    <ContextMenuItem onClick={handleCopy}>
                      <Copy />
                      {t("userBubble.copy")}
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem onClick={handleCopyFileContent}>
                    <Copy />
                    {t("fileDetail.copyFileContent", "复制文件内容")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={refresh}>
                    <RefreshCw />
                    {t("filePanel.refresh", "刷新")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={handleAddFileToChat}>
                    <MessageSquarePlus />
                    {t("fileDetail.addFileToChat", "添加文件到会话")}
                  </ContextMenuItem>
                  {selectedLineRange && (
                    <ContextMenuItem onClick={handleAddToChat}>
                      <MessageSquarePlus />
                      {t("fileDetail.addSelectionToChat", "添加选中内容到会话")}
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={handleCopyPath}>
                    <Copy />
                    {t("filePanel.copyPath")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={handleCopyRelativePath}>
                    <Copy />
                    {t("filePanel.copyRelativePath")}
                  </ContextMenuItem>
                  {!isWebUI && (
                    <ContextMenuItem onClick={handleRevealInFinder}>
                      <FolderOpen />
                      {t("filePanel.revealInFinder")}
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              </ContextMenu>
          </ScrollArea>
        ) : viewMode === "compare" && finalViewModes.includes("compare") ? (
          /* git diff view */
          <ScrollArea className="w-full h-full bg-[#ffffff] dark:bg-[#24292e]">
            <div className="min-h-full text-[12px] font-mono pb-20">
              <CodeCompareView
                oldContent={gitContent ?? ""}
                newContent={content}
                filename={fileName}
              />
            </div>
          </ScrollArea>
        ) : null}

        {/* search overlay */}
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

      {/* ── bottom view-mode tabs ── */}
      {showTabs && (
        <FileViewTabs
          viewMode={viewMode}
          viewModes={finalViewModes}
          onViewModeChange={setViewMode}
        />
      )}
    </div>
  );
}
