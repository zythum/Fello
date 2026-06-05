import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeView } from "../../../../common/code-view";
import { CodeCompareView } from "../../../../common/code-compare-view";
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
import { useFileSearch } from "./use-file-search";
import { SearchBar } from "./search-bar";

interface CodeDetailProps {
  projectId: string;
  file: string;
}

export function CodeDetail({ projectId, file }: CodeDetailProps) {
  const { t } = useTranslation();
  const { content, gitContent, loading, errorMsg } = useFile(projectId, file, { gitHead: true });
  const [viewMode, setViewMode] = useState<ViewMode>("code");
  const [codeViewContainer, setCodeViewContainer] = useState<HTMLDivElement | null>(null);
  const [contextSelectedText, setContextSelectedText] = useState<string | null>(null);

  // Search
  const {
    searchOpen,
    searchTerm,
    setSearchTerm,
    matchCount,
    currentMatch,
    goToNext,
    goToPrev,
    closeSearch,
  } = useFileSearch(projectId, file, viewMode, codeViewContainer?.children[0]?.shadowRoot ?? null);

  const viewModes: ViewMode[] = gitContent != null ? ["code", "compare"] : ["code"];

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
      {viewMode === "code" ? (
        <ScrollArea className="w-full h-full">
          <ContextMenu onOpenChange={handleMenuOpenChange}>
            <ContextMenuTrigger render={<div className="h-full" ref={setCodeViewContainer} />}>
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

      {/* search overlay */}
      {searchOpen && viewMode === "code" && (
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

      {/* bottom tabs */}
      <FileViewTabs viewMode={viewMode} viewModes={viewModes} onViewModeChange={setViewMode} />
    </div>
  );
}
