import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, FolderOpen } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { StreamMarkdown } from "../../../../common/stream-markdown";
import { CodeView } from "../../../../common/code-view";
import { copyText } from "@/lib/clipboard";
import { isWebUI } from "../../../../../backend";
import { useTaskFile } from "../common/use-task-file";
import { LoadingState, ErrorState } from "../common/loading-state";

type ViewMode = "preview" | "code";

interface MarkdownDetailProps {
  scheduleId: string;
  taskId: string;
  fileName: string;
  onCopyPath?: () => void;
  onCopyAbsolutePath?: () => void;
  onRevealInFinder?: () => void;
}

export function MarkdownDetail({
  scheduleId,
  taskId,
  fileName,
  onCopyPath,
  onCopyAbsolutePath,
  onRevealInFinder,
}: MarkdownDetailProps) {
  const { t } = useTranslation();
  const { content, loading, errorMsg } = useTaskFile(scheduleId, taskId, fileName);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [contextSelectedText, setContextSelectedText] = useState<string | null>(null);

  const handleCopyContent = useCallback(() => {
    copyText(content);
  }, [content]);

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  const contextMenuItems = (
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
  );

  return (
    <div className="relative h-full overflow-hidden">
      {viewMode === "preview" ? (
        <ScrollArea className="w-full h-full">
          <ContextMenu
            onOpenChange={(open) => {
              if (open) setContextSelectedText(window.getSelection()?.toString() ?? "");
              else setContextSelectedText(null);
            }}
          >
            <ContextMenuTrigger className="h-full select-text">
              <div className="p-4 max-w-3xl">
                <StreamMarkdown>{content}</StreamMarkdown>
              </div>
            </ContextMenuTrigger>
            {contextMenuItems}
          </ContextMenu>
        </ScrollArea>
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
            {contextMenuItems}
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
