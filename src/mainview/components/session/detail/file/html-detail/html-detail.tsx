import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "@/lib/clipboard";
import { ExternalLink, RotateCcw, MessageSquarePlus, Copy, FolderOpen } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { request, isWebUI, webUIBaseUrl } from "../../../../../backend";
import { electron } from "../../../../../electron";
import { resolveFileUrl } from "../../../../../lib/file-url";
import { ErrorState } from "../common/loading-state";
import { useFile } from "../common/use-file";
import type { ViewMode } from "../common/file-view-tabs";
import { FileViewTabs } from "../common/file-view-tabs";
import { CodeView } from "../../../../common/code-view";
import { CodeCompareView } from "../../../../common/code-compare-view";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

interface HtmlDetailProps {
  projectId: string;
  file: string;
}

export function HtmlDetail({ projectId, file }: HtmlDetailProps) {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [contextSelectedText, setContextSelectedText] = useState<string | null>(null);

  // Load file content for code/compare views
  const { content, gitContent, loading: fileLoading } = useFile(projectId, file, { gitHead: true });

  const pathname = `/project/${projectId}/${file}`;
  const iframeUrl = useMemo(() => resolveFileUrl(pathname), [pathname]);

  const httpUrl = useMemo(() => {
    if (!webUIBaseUrl) return null;
    return `${webUIBaseUrl}${pathname}`;
  }, [pathname]);

  // Pre-check if the file (or its index.html) exists
  useEffect(() => {
    let active = true;
    setHasError(false);
    setErrorMsg("");

    (async () => {
      try {
        // First try the exact path
        const info = await request.getFileInfo({ projectId, relativePath: file });
        if (!active) return;

        if (info && info.isFile) {
          return; // File exists, iframe will load it
        }

        // If not a file, try with index.html (directory serving)
        const normalizedPath = file.endsWith("/") ? file : `${file}/`;
        const indexPath = `${normalizedPath}index.html`;
        const indexInfo = await request.getFileInfo({ projectId, relativePath: indexPath });
        if (!active) return;

        if (indexInfo && indexInfo.isFile) {
          return; // index.html exists, iframe will load the directory
        }

        // Not found anywhere
        if (active) {
          setHasError(true);
          setErrorMsg(t("htmlDetail.fileNotFound", "File not found or inaccessible"));
        }
      } catch {
        if (active) {
          setHasError(true);
          setErrorMsg(t("htmlDetail.errorLoading", "Failed to load"));
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId, file, t]);

  // Open the page in system browser via the HTTP WebUI URL, or new tab in WebUI mode
  const handleOpenExternal = useCallback(() => {
    if (!httpUrl) return;
    if (isWebUI) {
      window.open(httpUrl, "_blank", "noopener,noreferrer");
    } else {
      electron.openInBrowser(httpUrl);
    }
  }, [httpUrl]);

  // Use a counter as a key to force iframe re-mount on retry
  const [retryKey, setRetryKey] = useState(0);

  const handleRetry = useCallback(() => {
    setHasError(false);
    setRetryKey((k) => k + 1);
  }, []);

  // Available view modes
  const viewModes: ViewMode[] =
    gitContent != null ? ["preview", "code", "compare"] : ["preview", "code"];

  // ── Context menu handlers ──
  const handleMenuOpenChange = useCallback((open: boolean) => {
    if (open) setContextSelectedText(window.getSelection()?.toString() ?? "");
    else setContextSelectedText(null);
  }, []);

  const handleCopySelected = useCallback(() => {
    if (contextSelectedText) copyText(contextSelectedText);
  }, [contextSelectedText]);

  const handleCopyFileContent = useCallback(() => {
    if (content) copyText(content);
  }, [content]);

  const handleAddFileToChat = useCallback(() => {
    document.dispatchEvent(
      new CustomEvent("fello-add-to-chat", { detail: [{ id: file, name: file, isFolder: false }] }),
    );
  }, [file]);

  const handleCopyPath = useCallback(async () => {
    const text = await request.getSystemFilePath({ projectId, path: file, isAbsolute: true });
    await copyText(text);
  }, [projectId, file]);

  const handleCopyRelativePath = useCallback(async () => {
    const text = await request.getSystemFilePath({ projectId, path: file, isAbsolute: false });
    await copyText(text);
  }, [projectId, file]);

  const handleRevealInFinder = useCallback(async () => {
    if (isWebUI) return;
    const absPath = await request.getSystemFilePath({ projectId, path: file, isAbsolute: true });
    electron.revealInFinder(absPath);
  }, [projectId, file]);

  const contextMenuItems = (
    <ContextMenuContent>
      {contextSelectedText && (
        <ContextMenuItem onClick={handleCopySelected}>
          <Copy /> {t("contextMenu.copy")}
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={handleCopyFileContent}>
        <Copy /> {t("fileDetail.copyFileContent")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleAddFileToChat}>
        <MessageSquarePlus /> {t("fileDetail.addFileToChat")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleCopyPath}>
        <Copy /> {t("filePanel.copyPath")}
      </ContextMenuItem>
      <ContextMenuItem onClick={handleCopyRelativePath}>
        <Copy /> {t("filePanel.copyRelativePath")}
      </ContextMenuItem>
      {!isWebUI && (
        <ContextMenuItem onClick={handleRevealInFinder}>
          <FolderOpen /> {t("filePanel.revealInFinder")}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );

  if (hasError) {
    return (
      <div className="relative h-full flex flex-col items-center justify-center gap-4 p-8">
        <ErrorState message={errorMsg} />
        <button
          type="button"
          onClick={handleRetry}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition-colors"
        >
          <RotateCcw className="size-4" />
          {t("htmlDetail.retry", "Retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {viewMode === "preview" ? (
        <div className="h-full w-full flex flex-col">
          {/* Thin toolbar for Open in Browser / Retry */}
          <div className="h-10 shrink-0 flex items-center justify-between pl-3 pr-2 border-b border-border bg-background/80">
            <span className="text-xs text-muted-foreground truncate mr-4">{iframeUrl}</span>
            <div className="flex items-center shrink-0">
              <button
                type="button"
                onClick={handleOpenExternal}
                disabled={!httpUrl}
                className="flex items-center size-6 justify-center rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
                title={
                  httpUrl
                    ? t("htmlDetail.openInBrowser", "Open in browser")
                    : t("htmlDetail.webuiNotEnabled", "Enable WebUI first to open in browser")
                }
              >
                <ExternalLink className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="flex items-center size-6 justify-center rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title={t("htmlDetail.refresh", "Refresh")}
              >
                <RotateCcw className="size-3" />
              </button>
            </div>
          </div>

          {/* Iframe — key={retryKey} forces re-mount when retrying */}
          <iframe
            key={retryKey}
            ref={iframeRef}
            src={iframeUrl}
            className="flex-1 w-full border-0 bg-white"
            sandbox="allow-scripts allow-popups allow-forms allow-modals"
            title={file}
          />
        </div>
      ) : viewMode === "code" ? (
        fileLoading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            {t("fileDetail.loading", "Loading...")}
          </div>
        ) : (
          <ScrollArea className="w-full h-full">
            <ContextMenu onOpenChange={handleMenuOpenChange}>
              <ContextMenuTrigger className="h-full">
                <CodeView
                  className="min-h-full"
                  content={content}
                  filename={file}
                  addLineToChat={true}
                />
              </ContextMenuTrigger>
              {contextMenuItems}
            </ContextMenu>
          </ScrollArea>
        )
      ) : /* compare */
      fileLoading ? (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          {t("fileDetail.loading", "Loading...")}
        </div>
      ) : (
        <ScrollArea className="w-full h-full">
          <ContextMenu onOpenChange={handleMenuOpenChange}>
            <ContextMenuTrigger className="h-full">
              <CodeCompareView
                className="min-h-full"
                oldContent={gitContent ?? ""}
                newContent={content}
                filename={file}
                addLineToChat={true}
              />
            </ContextMenuTrigger>
            {contextMenuItems}
          </ContextMenu>
        </ScrollArea>
      )}

      {/* bottom tabs */}
      <FileViewTabs viewMode={viewMode} viewModes={viewModes} onViewModeChange={setViewMode} />
    </div>
  );
}
