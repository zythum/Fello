import { useState, useCallback, useMemo, useRef, useEffect } from "react";
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
import { MessageSquarePlus, Copy, FolderOpen, Code } from "lucide-react";
import { useAppStore } from "../../../../../store";
import { request, isWebUI } from "../../../../../backend";
import { EDITOR_LABELS } from "../../../../../../shared/constants";
import { electron } from "../../../../../electron";
import { resolveFileUrl } from "../../../../../lib/file-url";
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
  const { content, gitContent, loading, errorMsg, filePath, hash, setContent } = useFile(projectId, file, {
    gitHead: true,
  });
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [contextSelectedText, setContextSelectedText] = useState<string | null>(null);

  // Edit state
  const [draft, setDraft] = useState(content);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize draft when entering edit mode / when file content reloads
  useEffect(() => {
    setDraft(content);
    setIsDirty(false);
    setSavedHint(false);
  }, [content]);

  useEffect(() => {
    if (viewMode === "edit") textareaRef.current?.focus();
  }, [viewMode]);

  const resolvePath = useCallback(
    (src: string) => {
      if (!src || /^(https?:|data:|#|mailto:|blob:)/.test(src)) return src;
      const dir = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";
      const raw = src.startsWith("/") ? src.slice(1) : dir ? `${dir}/${src}` : src;
      const parts = raw.split("/");
      const normalized: string[] = [];
      for (const p of parts) {
        if (p === "." || p === "") continue;
        if (p === ".." && normalized.length) normalized.pop();
        else if (p !== "..") normalized.push(p);
      }
      return normalized.join("/");
    },
    [filePath],
  );

  const imageSource = useMemo(() => {
    return (src: string) => {
      if (!src || /^(https?:|data:|#|mailto:|blob:)/.test(src)) return src;
      const resolved = resolvePath(src);
      return resolveFileUrl(`/project/${projectId}/${resolved}`);
    };
  }, [projectId, resolvePath]);

  const viewModes: ViewMode[] =
    gitContent != null
      ? ["preview", "code", "compare", "edit"]
      : ["preview", "code", "edit"];

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

  const handleSave = useCallback(async () => {
    if (saving || !isDirty) return;
    setSaving(true);
    setSavedHint(false);
    try {
      await request.writeFile({ projectId, relativePath: filePath, content: draft });
      setContent(draft);
      setIsDirty(false);
      setSavedHint(true);
    } catch (err) {
      console.error("Failed to save file", err);
    } finally {
      setSaving(false);
    }
  }, [saving, isDirty, projectId, filePath, draft, setContent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    },
    [handleSave],
  );

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
      {viewMode === "edit" ? (
        <div className="absolute inset-0 flex flex-col bg-background">
          <div className="shrink-0 flex items-center justify-end gap-2 px-3 py-1.5 border-b border-border">
            {savedHint && !isDirty && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                {t("fileDetail.saved")}
              </span>
            )}
            <span className="text-xs text-muted-foreground hidden sm:inline">⌘/Ctrl + S</span>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !isDirty}
              className="px-3 py-1 rounded text-xs font-medium bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
            >
              {saving ? "…" : t("fileDetail.save")}
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setIsDirty(e.target.value !== content);
            }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className="flex-1 min-h-0 w-full resize-none bg-background p-4 pb-16 font-mono text-sm leading-relaxed outline-none text-foreground"
          />
        </div>
      ) : viewMode === "preview" ? (
        <ScrollArea className="w-full h-full">
          <ContextMenu onOpenChange={handleMenuOpenChange}>
            <ContextMenuTrigger className="h-full select-text">
              <div className="prose prose-sm dark:prose-invert max-w-none p-6 min-h-full bg-background font-sans pb-20">
                <StreamMarkdown
                  initalHash={hash}
                  imageSource={imageSource}
                  onLinkClick={(href) => {
                    document.dispatchEvent(
                      new CustomEvent("fello-preview-file", {
                        detail: { projectId, relativePath: resolvePath(href) },
                      }),
                    );
                    return false;
                  }}
                >
                  {content}
                </StreamMarkdown>
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
                filename={filePath}
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
                filename={filePath}
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
