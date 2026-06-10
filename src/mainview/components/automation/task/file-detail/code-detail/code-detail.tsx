import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, FolderOpen } from "lucide-react";
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
import { useTaskFile } from "../common/use-task-file";
import { LoadingState, ErrorState } from "../common/loading-state";

interface CodeDetailProps {
  scheduleId: string;
  taskId: string;
  fileName: string;
  onCopyPath?: () => void;
  onCopyAbsolutePath?: () => void;
  onRevealInFinder?: () => void;
}

export function CodeDetail({
  scheduleId,
  taskId,
  fileName,
  onCopyPath,
  onCopyAbsolutePath,
  onRevealInFinder,
}: CodeDetailProps) {
  const { t } = useTranslation();
  const { content, loading, errorMsg } = useTaskFile(scheduleId, taskId, fileName);
  const [contextSelectedText, setContextSelectedText] = useState<string | null>(null);

  const displayContent = useMemo(() => {
    if (fileName.endsWith(".json")) {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return content;
      }
    }
    return content;
  }, [fileName, content]);

  const handleCopyContent = useCallback(() => {
    copyText(displayContent);
  }, [displayContent]);

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  return (
    <ScrollArea className="w-full h-full">
      <ContextMenu
        onOpenChange={(open) => {
          if (open) setContextSelectedText(window.getSelection()?.toString() ?? "");
          else setContextSelectedText(null);
        }}
      >
        <ContextMenuTrigger className="h-full">
          <CodeView className="min-h-full" content={displayContent} filename={fileName} />
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
          {onCopyPath && (
            <ContextMenuItem onClick={onCopyPath}>
              <Copy /> {t("filePanel.copyPath", "Copy Path")}
            </ContextMenuItem>
          )}
          {onCopyAbsolutePath && (
            <ContextMenuItem onClick={onCopyAbsolutePath}>
              <Copy /> {t("filePanel.copyAbsolutePath", "Copy Absolute Path")}
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
  );
}
