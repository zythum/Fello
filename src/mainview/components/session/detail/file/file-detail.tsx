import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, RefreshCw, Code, FolderOpen } from "lucide-react";
import { FileIcon } from "../../../common/file-icon";
import { request, subscribe, isWebUI } from "../../../../backend";
import { electron } from "../../../../electron";
import { useAppStore } from "../../../../store";
import { useMessage } from "../../../providers/message";
import { EDITOR_LABELS } from "../../../../../shared/constants";
import type { FileDetailProps } from "./file-types";
import { getFileKind } from "./file-types";
import { parseFileReference } from "../../../common/file-reference";
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
  const { confirm } = useMessage();
  const editorName = useAppStore((s) => s.editor.name);
  const filePath = file ? parseFileReference(file).path : "";
  const fileKind = getFileKind(filePath);
  const [fileModified, setFileModified] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Reset modified state when file changes
  useEffect(() => {
    setFileModified(false);
    setEditDirty(false);
    setRefreshKey(0);
  }, [projectId, filePath]);

  // Listen for external file modifications
  useEffect(() => {
    if (!projectId || !filePath) return;
    const handler = (payload: { projectId: string; changes: string[]; selfChanges?: string[] }) => {
      if (payload.projectId !== projectId || !payload.changes.includes(filePath)) return;
      // 应用自身保存触发的变更（selfChanges）不提示「文件已被修改」
      if (payload.selfChanges?.includes(filePath)) return;
      setFileModified(true);
    };
    subscribe.on("fs-changed", handler);
    return () => {
      subscribe.off("fs-changed", handler);
    };
  }, [projectId, filePath]);

  const handleRefresh = useCallback(() => {
    setFileModified(false);
    setRefreshKey((k) => k + 1);
  }, []);

  // 关闭详情：编辑区存在未保存更改时先确认，避免内容静默丢失
  const handleClose = useCallback(() => {
    if (!onClose) return;
    if (!editDirty) {
      onClose();
      return;
    }
    void confirm({
      title: t("fileDetail.unsavedTitle"),
      content: t("fileDetail.unsavedContent"),
      buttons: [
        { text: t("filePanel.cancel"), value: null, variant: "outline" },
        { text: t("fileDetail.discard"), value: "discard", variant: "destructive" },
      ],
    }).then((result) => {
      if (result === "discard") onClose();
    });
  }, [editDirty, onClose, confirm, t]);

  const handleRevealInFinder = useCallback(async () => {
    if (isWebUI || !projectId || !filePath) return;
    const absPath = await request.getSystemFilePath({
      projectId,
      path: filePath,
      isAbsolute: true,
    });
    electron.revealInFinder(absPath);
  }, [projectId, filePath]);

  const handleOpenInEditor = useCallback(async () => {
    if (isWebUI || !projectId || !filePath) return;
    const absPath = await request.getSystemFilePath({
      projectId,
      path: filePath,
      isAbsolute: true,
    });
    electron.openInEditor(absPath, editorName);
  }, [projectId, filePath, editorName]);

  return (
    <div className="flex flex-col w-full h-full min-w-0 relative overflow-hidden">
      {/* header */}
      <div
        className="h-12 shrink-0 border-b border-border flex items-center justify-between gap-2 px-2 bg-background"
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="flex items-center min-w-0 flex-1">
          <div className="min-w-0 flex items-center gap-1.5">
            <FileIcon name={filePath} className="size-4 shrink-0 text-muted-foreground/80" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs truncate leading-tight text-foreground/60">{filePath}</span>
            </div>
            {!isWebUI && (
              <div
                className="flex items-center gap-0.5 ml-0.5 shrink-0"
                style={{ WebkitAppRegion: "no-drag" }}
              >
                <button
                  type="button"
                  onClick={handleRevealInFinder}
                  title={t("filePanel.revealInFinder")}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted-foreground/10 hover:text-foreground transition-colors"
                >
                  <FolderOpen className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleOpenInEditor}
                  title={t("filePanel.openInEditor", {
                    editor: EDITOR_LABELS[editorName] ?? "Editor",
                  })}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted-foreground/10 hover:text-foreground transition-colors"
                >
                  <Code className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {fileModified && (
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800 text-xs text-sky-800 dark:text-sky-200">
              <span className="whitespace-nowrap">
                {t("fileDetail.fileModifiedNotice", "文件已被修改，请刷新")}
              </span>
              <button
                type="button"
                onClick={handleRefresh}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-200/60 hover:bg-sky-300/60 dark:bg-sky-800/50 dark:hover:bg-sky-700/50 transition-colors shrink-0"
                style={{ WebkitAppRegion: "no-drag" }}
              >
                <RefreshCw className="size-3" />
                {t("filePanel.refresh", "刷新")}
              </button>
            </div>
          )}
          {onClose && (
            <button
              type="button"
              onClick={handleClose}
              className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
              style={{ WebkitAppRegion: "no-drag" }}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* content */}
      {projectId && filePath && file && (
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {fileKind === "text" ? (
            <CodeDetail
              key={refreshKey}
              projectId={projectId}
              file={file}
              onEditDirtyChange={setEditDirty}
            />
          ) : fileKind === "markdown" ? (
            <MarkdownDetail
              key={refreshKey}
              projectId={projectId}
              file={file}
              onEditDirtyChange={setEditDirty}
            />
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
