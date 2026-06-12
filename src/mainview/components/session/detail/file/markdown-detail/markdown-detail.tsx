import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeView } from "../../../../common/code-view";
import { CodeCompareView } from "../../../../common/code-compare-view";
import { StreamMarkdown } from "../../../../common/stream-markdown";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { copyText } from "@/lib/clipboard";
import { MessageSquarePlus, Copy, FolderOpen } from "lucide-react";
import { request, isWebUI } from "../../../../../backend";
import { electron } from "../../../../../electron";
import type { ViewMode } from "../common/file-view-tabs";
import { FileViewTabs } from "../common/file-view-tabs";
import { LoadingState, ErrorState } from "../common/loading-state";
import { useFile } from "../common/use-file";

interface MarkdownDetailProps {
  projectId: string;
  file: string;
}

export function MarkdownDetail({ projectId, file }: MarkdownDetailProps) {
  const { t } = useTranslation();
  const { content, gitContent, loading, errorMsg } = useFile(projectId, file, { gitHead: true });
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [contextSelectedText, setContextSelectedText] = useState<string | null>(null);

  const viewModes: ViewMode[] =
    gitContent != null ? ["preview", "code", "compare"] : ["preview", "code"];

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

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

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

  return (
    <div className="relative h-full overflow-hidden">
      {viewMode === "preview" ? (
        <ScrollArea className="w-full h-full">
          <ContextMenu onOpenChange={handleMenuOpenChange}>
            <ContextMenuTrigger className="h-full select-text">
              <div className="prose prose-sm dark:prose-invert max-w-none p-6 min-h-full bg-background font-sans pb-20">
                <StreamMarkdown>{content}</StreamMarkdown>
              </div>
            </ContextMenuTrigger>
            {contextMenuItems}
          </ContextMenu>
        </ScrollArea>
      ) : viewMode === "code" ? (
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
