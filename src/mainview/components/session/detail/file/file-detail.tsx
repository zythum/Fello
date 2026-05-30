import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, RefreshCw } from "lucide-react";
import { FileIcon } from "../../../common/file-icon";
import { subscribe } from "../../../../backend";
import type { FileDetailProps } from "./file-types";
import { getFileKind } from "./file-types";
import { CodeDetail } from "./code-detail/code-detail";
import { MarkdownDetail } from "./markdown-detail/markdown-detail";
import { ImageDetail } from "./image-detail/image-detail";
import { PdfDetail } from "./pdf-detail/pdf-detail";
import { DocxDetail } from "./docx-detail/docx-detail";
import { PptxDetail } from "./pptx-detail/pptx-detail";
import { XlsxDetail } from "./xlsx-detail/xlsx-detail";
import { HtmlDetail } from "./html-detail/html-detail";
import { FallbackDetail } from "./fallback-detail/fallback-detail";

export function FileDetail({ projectId, file, onClose }: FileDetailProps) {
  const { t } = useTranslation();
  const fileKind = getFileKind(file);
  const [fileModified, setFileModified] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Reset modified state when file changes
  useEffect(() => {
    setFileModified(false);
    setRefreshKey(0);
  }, [projectId, file]);

  // Listen for external file modifications
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

  const handleRefresh = useCallback(() => {
    setFileModified(false);
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="flex flex-col w-full h-full min-w-0 relative overflow-hidden">
      {/* header */}
      <div
        className="h-12 shrink-0 border-b border-border flex items-center justify-between gap-2 px-2 bg-background"
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="flex items-center min-w-0 flex-1">
          <div className="min-w-0 flex items-center gap-1.5">
            <FileIcon name={file ?? ""} className="size-4 shrink-0 text-muted-foreground/80" />
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

      {/* content */}
      {projectId && file && (
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {/* file modified toast */}
          {fileModified && (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-3 px-3 py-2 rounded-lg shadow-md bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800 text-xs text-sky-800 dark:text-sky-200">
              <span>{t("fileDetail.fileModifiedNotice", "文件已被修改，请刷新")}</span>
              <button
                type="button"
                onClick={handleRefresh}
                className="flex items-center gap-1 px-2 py-1 rounded bg-sky-200/60 hover:bg-sky-300/60 dark:bg-sky-800/50 dark:hover:bg-sky-700/50 transition-colors shrink-0"
              >
                <RefreshCw className="size-3" />
                {t("filePanel.refresh", "刷新")}
              </button>
            </div>
          )}

          {fileKind === "text" ? (
            <CodeDetail key={refreshKey} projectId={projectId} file={file} />
          ) : fileKind === "markdown" ? (
            <MarkdownDetail key={refreshKey} projectId={projectId} file={file} />
          ) : fileKind === "image" ? (
            <ImageDetail key={refreshKey} projectId={projectId} file={file} />
          ) : fileKind === "pdf" ? (
            <PdfDetail key={refreshKey} projectId={projectId} file={file} />
          ) : fileKind === "docx" ? (
            <DocxDetail key={refreshKey} projectId={projectId} file={file} />
          ) : fileKind === "pptx" ? (
            <PptxDetail key={refreshKey} projectId={projectId} file={file} />
          ) : fileKind === "xlsx" ? (
            <XlsxDetail key={refreshKey} projectId={projectId} file={file} />
          ) : fileKind === "html" ? (
            <HtmlDetail key={refreshKey} projectId={projectId} file={file} />
          ) : (
            <FallbackDetail projectId={projectId} file={file} />
          )}
        </div>
      )}
    </div>
  );
}
