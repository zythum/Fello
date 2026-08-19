import { useState, useCallback, useRef, useEffect } from "react";
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
import { MessageSquarePlus, Copy, FolderOpen, Code } from "lucide-react";
import { useAppStore } from "../../../../../store";
import { request, isWebUI } from "../../../../../backend";
import { EDITOR_LABELS } from "../../../../../../shared/constants";
import { electron } from "../../../../../electron";
import { useMessage } from "../../../../providers/message";
import type { ViewMode } from "../common/file-view-tabs";
import { FileViewTabs } from "../common/file-view-tabs";
import { LoadingState, ErrorState } from "../common/loading-state";
import { useFile } from "../common/use-file";
import {
  EditPanel,
  MAX_EDIT_SIZE,
  switchViewModeWithEditGuard,
  type EditPanelHandle,
} from "../common/edit-panel";
import { useFileSearch } from "./use-file-search";
import { SearchBar } from "./search-bar";

interface CodeDetailProps {
  projectId: string;
  file: string;
  /** 编辑区 dirty 状态上报（FileDetail 用于关闭详情前的未保存确认） */
  onEditDirtyChange?: (dirty: boolean) => void;
}

export function CodeDetail({ projectId, file, onEditDirtyChange }: CodeDetailProps) {
  const { t } = useTranslation();
  const { confirm } = useMessage();
  const { content, gitContent, loading, errorMsg, filePath, fileSize, reload } = useFile(
    projectId,
    file,
    { gitHead: true },
  );
  const [viewMode, setViewMode] = useState<ViewMode>("code");
  // 进入编辑前所在的视图，取消编辑时返回
  const [editReturnMode, setEditReturnMode] = useState<ViewMode>("code");
  const [codeViewContainer, setCodeViewContainer] = useState<HTMLDivElement | null>(null);
  const [contextSelectedText, setContextSelectedText] = useState<string | null>(null);
  const editPanelRef = useRef<EditPanelHandle>(null);

  // 编辑入口：加载完成、无错误且文件未超过大小上限（加载中 fileSize 为 0，避免入口闪现）
  const canEdit = !loading && !errorMsg && fileSize <= MAX_EDIT_SIZE;

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
  } = useFileSearch(
    projectId,
    filePath,
    viewMode,
    codeViewContainer?.children[0]?.shadowRoot ?? null,
  );

  const viewModes: ViewMode[] = [
    "code",
    ...(gitContent != null ? (["compare"] as const) : []),
    ...(canEdit ? (["edit"] as const) : []),
  ];

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      switchViewModeWithEditGuard({
        mode,
        viewMode,
        editReturnMode,
        onEditReturnModeChange: setEditReturnMode,
        editPanelRef,
        confirm,
        t,
        setViewMode,
      });
    },
    [viewMode, editReturnMode, confirm, t],
  );

  // 离开编辑视图时同步 dirty 上报，避免关闭详情误弹未保存确认
  useEffect(() => {
    if (viewMode !== "edit") onEditDirtyChange?.(false);
  }, [viewMode, onEditDirtyChange]);

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
      new CustomEvent("fello-add-to-chat", {
        detail: [{ id: filePath, name: filePath, isFolder: false }],
      }),
    );
  }, [filePath]);

  const handleCopyPath = useCallback(async () => {
    const text = await request.getSystemFilePath({ projectId, path: filePath, isAbsolute: true });
    await copyText(text);
  }, [projectId, filePath]);

  const handleCopyRelativePath = useCallback(async () => {
    const text = await request.getSystemFilePath({ projectId, path: filePath, isAbsolute: false });
    await copyText(text);
  }, [projectId, filePath]);

  const handleRevealInFinder = useCallback(async () => {
    if (isWebUI) return;
    const absPath = await request.getSystemFilePath({
      projectId,
      path: filePath,
      isAbsolute: true,
    });
    electron.revealInFinder(absPath);
  }, [projectId, filePath]);

  const handleOpenInEditor = useCallback(async () => {
    if (isWebUI) return;
    const absPath = await request.getSystemFilePath({
      projectId,
      path: filePath,
      isAbsolute: true,
    });
    const editorName = useAppStore.getState().editor.name;
    electron.openInEditor(absPath, editorName);
  }, [projectId, filePath]);

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
      {!isWebUI && (
        <ContextMenuItem onClick={handleOpenInEditor}>
          <Code />{" "}
          {t("filePanel.openInEditor", {
            editor: EDITOR_LABELS[useAppStore.getState().editor.name] ?? "Editor",
          })}
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
                filename={filePath}
                addLineToChat={true}
              />
            </ContextMenuTrigger>
            {contextMenuItems}
          </ContextMenu>
        </ScrollArea>
      ) : viewMode === "compare" ? (
        <ScrollArea className="w-full h-full">
          <ContextMenu onOpenChange={handleMenuOpenChange}>
            <ContextMenuTrigger className="h-full">
              <CodeCompareView
                className="min-h-full"
                oldContent={gitContent ?? ""}
                newContent={content}
                filename={filePath}
                addLineToChat={true}
              />
            </ContextMenuTrigger>
            {contextMenuItems}
          </ContextMenu>
        </ScrollArea>
      ) : (
        <EditPanel
          ref={editPanelRef}
          projectId={projectId}
          filePath={filePath}
          content={content}
          loading={loading}
          onSaved={reload}
          onCancel={() => handleViewModeChange(editReturnMode)}
          onDirtyChange={onEditDirtyChange}
        />
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
      <FileViewTabs
        viewMode={viewMode}
        viewModes={viewModes}
        onViewModeChange={handleViewModeChange}
      />
    </div>
  );
}
