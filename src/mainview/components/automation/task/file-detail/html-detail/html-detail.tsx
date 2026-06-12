import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, ExternalLink, Copy, FolderOpen } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { CodeView } from "../../../../common/code-view";
import { copyText } from "@/lib/clipboard";
import { isWebUI } from "../../../../../backend";
import { useAppStore } from "../../../../../store";
import { useTaskFile } from "../common/use-task-file";
import { LoadingState, ErrorState } from "../common/loading-state";

type ViewMode = "preview" | "code";

interface HtmlDetailProps {
  scheduleId: string;
  taskId: string;
  fileName: string;
  onCopyPath?: () => void;
  onCopyAbsolutePath?: () => void;
  onRevealInFinder?: () => void;
}

export function HtmlDetail({
  scheduleId,
  taskId,
  fileName,
  onCopyPath,
  onCopyAbsolutePath,
  onRevealInFinder,
}: HtmlDetailProps) {
  const { t } = useTranslation();
  const { content, loading, errorMsg } = useTaskFile(scheduleId, taskId, fileName);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [retryKey, setRetryKey] = useState(0);
  const [contextSelectedText, setContextSelectedText] = useState<string | null>(null);
  const webUIStatus = useAppStore((s) => s.webUIStatus);

  const httpBaseUrl = useMemo(() => {
    if (webUIStatus.enabled && webUIStatus.url) {
      try {
        const parsed = new URL(webUIStatus.url);
        const urlParams = new URLSearchParams(parsed.search);
        const port = urlParams.get("port") || parsed.port;
        return `${parsed.protocol}//${parsed.hostname}:${port}`;
      } catch {
        return webUIStatus.url;
      }
    }
    return null;
  }, [webUIStatus]);

  const iframeUrl = useMemo(() => {
    const path = `/automation/${scheduleId}/task/${taskId}/${fileName}`;
    if (httpBaseUrl) return `${httpBaseUrl}${path}`;
    return `web://automation/${scheduleId}/task/${taskId}/${fileName}`;
  }, [httpBaseUrl, scheduleId, taskId, fileName]);

  const httpUrl = useMemo(() => {
    if (!httpBaseUrl) return null;
    return `${httpBaseUrl}/automation/${scheduleId}/task/${taskId}/${fileName}`;
  }, [httpBaseUrl, scheduleId, taskId, fileName]);

  const handleOpenExternal = useCallback(() => {
    if (httpUrl) window.open(httpUrl, "_blank", "noopener,noreferrer");
  }, [httpUrl]);

  const handleCopyContent = useCallback(() => {
    copyText(content);
  }, [content]);

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {viewMode === "preview" ? (
        <div className="h-full w-full flex flex-col">
          <div className="h-10 shrink-0 flex items-center justify-between pl-3 pr-2 border-b border-border bg-background/80">
            <span className="text-xs text-muted-foreground truncate mr-4">{iframeUrl}</span>
            <div className="flex items-center shrink-0">
              <button
                type="button"
                onClick={handleOpenExternal}
                disabled={!httpUrl}
                className="flex items-center size-6 justify-center rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
                title={t("htmlDetail.openInBrowser", "Open in browser")}
              >
                <ExternalLink className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setRetryKey((k) => k + 1)}
                className="flex items-center size-6 justify-center rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title={t("htmlDetail.refresh", "Refresh")}
              >
                <RotateCcw className="size-3" />
              </button>
            </div>
          </div>
          <iframe
            key={retryKey}
            src={iframeUrl}
            className="flex-1 w-full border-0 bg-white"
            sandbox="allow-scripts allow-popups allow-forms allow-modals"
            title={fileName}
          />
        </div>
      ) : (
        <ScrollArea className="w-full h-full">
          <ContextMenu
            onOpenChange={(open) => {
              if (open) setContextSelectedText(window.getSelection()?.toString() ?? "");
              else setContextSelectedText(null);
            }}
          >
            <ContextMenuTrigger className="h-full">
              <CodeView className="min-h-full" content={content} filename={fileName} />
            </ContextMenuTrigger>
            <ContextMenuContent>
              {contextSelectedText && (
                <ContextMenuItem onClick={() => copyText(contextSelectedText)}>
                  <Copy /> {t("contextMenu.copy")}
                </ContextMenuItem>
              )}
              <ContextMenuItem onClick={handleCopyContent}>
                <Copy /> {t("fileDetail.copyFileContent", "Copy file content")}
              </ContextMenuItem>
              {(onCopyPath || onCopyAbsolutePath || onRevealInFinder) && <ContextMenuSeparator />}
              {onCopyAbsolutePath && (
                <ContextMenuItem onClick={onCopyAbsolutePath}>
                  <Copy /> {t("filePanel.copyPath", "Copy Path")}
                </ContextMenuItem>
              )}
              {onCopyPath && (
                <ContextMenuItem onClick={onCopyPath}>
                  <Copy /> {t("filePanel.copyRelativePath", "Copy Relative Path")}
                </ContextMenuItem>
              )}
              {!isWebUI && onRevealInFinder && (
                <ContextMenuItem onClick={onRevealInFinder}>
                  <FolderOpen /> {t("filePanel.revealInFinder", "Reveal in Finder")}
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        </ScrollArea>
      )}

      <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center pointer-events-none">
        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(v as ViewMode)}
          className="pointer-events-auto"
        >
          <TabsList className="h-8 border border-border shadow-lg">
            <TabsTrigger value="preview" className="text-xs min-w-18">
              {t("fileDetail.preview", "Preview")}
            </TabsTrigger>
            <TabsTrigger value="code" className="text-xs min-w-18">
              {t("fileDetail.code", "Code")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
