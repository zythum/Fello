import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { ChevronRight, ChevronsDownUp, Folder, Folders, Copy, FolderOpen } from "lucide-react";
import { FileIcon } from "../../../common/file-icon";
import { cn } from "@/lib/utils";

export interface PanelProps {
  files: string[];
  selectedFile: string | null;
  hasTask: boolean;
  onSelectFile: (file: string) => void;
  onCopyRelativePath: (file: string) => void;
  onCopyAbsolutePath: (file: string) => void;
  onRevealInFinder: (file: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const fullPath of paths) {
    const parts = fullPath.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const nodePath = parts.slice(0, i + 1).join("/");
      let existing = current.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          path: nodePath,
          isFolder: !isLast,
          children: !isLast ? [] : undefined,
        };
        current.push(existing);
      }
      if (existing.children) current = existing.children;
    }
  }
  return root;
}

function FileTree({
  nodes,
  depth,
  selectedFile,
  onSelectFile,
  openFolders,
  toggleFolder,
  onCopyRelativePath,
  onCopyAbsolutePath,
  onRevealInFinder,
}: {
  nodes: TreeNode[];
  depth: number;
  selectedFile: string | null;
  onSelectFile: (file: string) => void;
  openFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onCopyRelativePath: (file: string) => void;
  onCopyAbsolutePath: (file: string) => void;
  onRevealInFinder: (file: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {nodes.map((node) => {
        if (node.isFolder) {
          const isOpen = openFolders.has(node.path);
          return (
            <div key={node.path}>
              <div
                className={cn(
                  "flex h-6 cursor-default select-none items-center gap-1.5 px-1.5 text-sx leading-none text-foreground/60 hover:bg-primary/5 hover:text-foreground",
                )}
                style={{ paddingLeft: `${depth * 16 + 6}px` }}
                onClick={() => toggleFolder(node.path)}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-90",
                  )}
                />
                <Folder className="size-4 shrink-0 text-muted-foreground/90" />
                <span className="flex-1 truncate leading-normal">{node.name}</span>
              </div>
              {isOpen && node.children && (
                <FileTree
                  nodes={node.children}
                  depth={depth + 1}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  openFolders={openFolders}
                  toggleFolder={toggleFolder}
                  onCopyRelativePath={onCopyRelativePath}
                  onCopyAbsolutePath={onCopyAbsolutePath}
                  onRevealInFinder={onRevealInFinder}
                />
              )}
            </div>
          );
        }

        return (
          <ContextMenu key={node.path}>
            <ContextMenuTrigger
              render={<div />}
              className={cn(
                "flex h-6 cursor-default select-none items-center gap-1.5 px-1.5 text-sx leading-none text-foreground/60 hover:bg-primary/5 hover:text-foreground",
                selectedFile === node.path && "text-foreground bg-primary/6",
              )}
              style={{ paddingLeft: `${depth * 16 + 6}px` }}
              onClick={() => onSelectFile(node.path)}
            >
              <span className="w-3.5 shrink-0" />
              <FileIcon name={node.name} className="size-4 shrink-0 text-muted-foreground/90" />
              <span className="flex-1 truncate leading-normal">{node.name}</span>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onCopyRelativePath(node.path)}>
                <Copy className="size-3.5 mr-2" />
                {t("filePanel.copyPath", "Copy Path")}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onCopyAbsolutePath(node.path)}>
                <Copy className="size-3.5 mr-2" />
                {t("filePanel.copyAbsolutePath", "Copy Absolute Path")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onRevealInFinder(node.path)}>
                <FolderOpen className="size-3.5 mr-2" />
                {t("filePanel.revealInFinder", "Reveal in Finder")}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </>
  );
}

export function Panel({
  files,
  selectedFile,
  hasTask,
  onSelectFile,
  onCopyRelativePath,
  onCopyAbsolutePath,
  onRevealInFinder,
}: PanelProps) {
  const { t } = useTranslation();
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(files), [files]);

  useEffect(() => {
    const allFolders = new Set<string>();
    for (const f of files) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) {
        allFolders.add(parts.slice(0, i).join("/"));
      }
    }
    setOpenFolders(allFolders);
  }, [files]);

  const toggleFolder = (path: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-xs w-full">
      <div className="flex h-10 items-center gap-0.5 border-b border-border">
        <div className="flex text-muted-foreground items-center gap-1 px-3">
          <Folders className="size-4" />
          <span className="text-xs font-medium text-nowrap">{t("automation.files", "Files")}</span>
        </div>
        <div className="ml-auto mr-2 flex items-center gap-0.5">
          {tree.length > 0 && (
            <button
              className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground rounded"
              onClick={() => setOpenFolders(new Set())}
              title={t("filePanel.collapseFolders", "Collapse folders")}
            >
              <ChevronsDownUp className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {!hasTask ? (
        <div className="flex flex-col items-center justify-center flex-1 min-h-0 -mt-10 text-muted-foreground">
          <div className="size-10 rounded-full bg-muted flex items-center justify-center mb-3">
            <Folder className="size-5 text-muted-foreground/60" />
          </div>
          <p className="text-xs">{t("automation.selectTask", "Select a task")}</p>
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 min-h-0 -mt-10 text-muted-foreground">
          <div className="size-10 rounded-full bg-muted flex items-center justify-center mb-3">
            <FolderOpen className="size-5 text-muted-foreground/60" />
          </div>
          <p className="text-xs">{t("automation.noFiles", "No files")}</p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="py-1">
            <FileTree
              nodes={tree}
              depth={0}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              openFolders={openFolders}
              toggleFolder={toggleFolder}
              onCopyRelativePath={onCopyRelativePath}
              onCopyAbsolutePath={onCopyAbsolutePath}
              onRevealInFinder={onRevealInFinder}
            />
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
