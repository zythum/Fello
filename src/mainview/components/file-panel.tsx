import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { request } from "../backend";
import { useAppStore } from "../store";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  FilePlus,
  FolderPlus,
  RefreshCw,
  ChevronRight,
  Folder,
  File,
  Loader2,
  ChevronsDownUp,
  Pencil,
  Trash2,
  FolderOpen,
  GitBranch,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TreeNode {
  id: string;
  name: string;
  isFolder: boolean;
  children?: TreeNode[];
}

interface Actions {
  select: (id: string, e: React.MouseEvent) => void;
  toggle: (node: TreeNode) => void;
  startRename: (node: TreeNode) => void;
  createIn: (parentId: string | null, isFolder: boolean) => void;
  deleteNode: (ids: string[]) => void;
  startDrag: (id: string, e: React.DragEvent) => void;
  dragOver: (e: React.DragEvent, id: string) => void;
  dragLeave: () => void;
  drop: (e: React.DragEvent, id: string) => void;
  dragEnd: () => void;
  revealInFinder: (id: string) => void;
  previewFile: (id: string) => void;
  copyPath: (id: string, isRelative: boolean) => void;
}

const GIT_FOLDER_STATUS = {
  text: "•",
  color: "text-muted-foreground/50",
} as const;

const GIT_SUMMARY_BADGES = [
  { key: "A", color: "text-emerald-500/90" },
  { key: "U", color: "text-cyan-500/90" },
  { key: "M", color: "text-amber-500/90" },
  { key: "R", color: "text-orange-500/90" },
  { key: "C", color: "text-yellow-500/90" },
  { key: "D", color: "text-red-500/90" },
] as const;

type GitSummaryKey = (typeof GIT_SUMMARY_BADGES)[number]["key"];

function TreeItem({
  node,
  depth,
  selectedIds,
  openFolders,
  editingId,
  editingValue,
  dropTargetId,
  gitStatusMap,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  actions,
}: {
  node: TreeNode;
  depth: number;
  selectedIds: Set<string>;
  openFolders: Set<string>;
  editingId: string | null;
  editingValue: string;
  dropTargetId: string | null;
  gitStatusMap: Map<string, string>;
  onEditChange: (v: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  actions: Actions;
}) {
  const { t } = useTranslation();
  const isOpen = openFolders.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const isEditing = editingId === node.id;
  const isDragOver = dropTargetId === node.id;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) setTimeout(() => inputRef.current?.focus(), 0);
  }, [isEditing]);

  const childProps = {
    selectedIds,
    openFolders,
    editingId,
    editingValue,
    dropTargetId,
    gitStatusMap,
    onEditChange,
    onEditSubmit,
    onEditCancel,
    actions,
  };

  const status = gitStatusMap.get(node.id);
  let statusText = "";
  let statusColor = "";
  if (status) {
    if (status === GIT_FOLDER_STATUS.text) {
      statusText = GIT_FOLDER_STATUS.text;
      statusColor = GIT_FOLDER_STATUS.color;
    } else if (status.includes("??")) {
      statusText = "U";
      statusColor = GIT_SUMMARY_BADGES.find((b) => b.key === "U")?.color || statusColor;
    } else if (status.includes("A")) {
      statusText = "A";
      statusColor = GIT_SUMMARY_BADGES.find((b) => b.key === "A")?.color || statusColor;
    } else if (status.includes("R")) {
      statusText = "R";
      statusColor = GIT_SUMMARY_BADGES.find((b) => b.key === "R")?.color || statusColor;
    } else if (status.includes("C")) {
      statusText = "C";
      statusColor = GIT_SUMMARY_BADGES.find((b) => b.key === "C")?.color || statusColor;
    } else if (status.includes("M")) {
      statusText = "M";
      statusColor = GIT_SUMMARY_BADGES.find((b) => b.key === "M")?.color || statusColor;
    } else if (status.includes("D")) {
      statusText = "D";
      statusColor = GIT_SUMMARY_BADGES.find((b) => b.key === "D")?.color || statusColor;
    } else {
      statusText = status.trim();
      statusColor = "text-muted-foreground/80";
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={<div />}
          draggable={!isEditing}
          onDragStart={(e) => {
            e.stopPropagation();
            actions.startDrag(node.id, e);
          }}
          onDragOver={(e) => node.isFolder && actions.dragOver(e, node.id)}
          onDragLeave={actions.dragLeave}
          onDrop={(e) => node.isFolder && actions.drop(e, node.id)}
          onDragEnd={actions.dragEnd}
          onContextMenu={(e) => {
            e.stopPropagation();
            if (!selectedIds.has(node.id)) {
              actions.select(node.id, e);
            }
          }}
          className={cn(
            "flex h-7 cursor-default select-none items-center gap-1.5 px-1.5 text-sx leading-none",
            isSelected
              ? "bg-accent text-accent-foreground"
              : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
            isDragOver && "relative ring-1 ring-primary bg-primary/5",
          )}
          style={{ paddingLeft: `${depth * 16 + 6}px` }}
          onClick={(e) => {
            e.stopPropagation();
            actions.select(node.id, e);
            if (node.isFolder && !e.metaKey && !e.shiftKey) {
              actions.toggle(node);
            }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (!node.isFolder) {
              actions.previewFile(node.id);
            }
          }}
        >
          {node.isFolder ? (
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                isOpen && "rotate-90",
              )}
            />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {node.isFolder ? (
            <Folder className="size-4 shrink-0 text-muted-foreground/60" />
          ) : (
            <File className="size-4 shrink-0 text-muted-foreground/60" />
          )}
          {isEditing ? (
            <input
              ref={inputRef}
              value={editingValue}
              onChange={(e) => onEditChange(e.target.value)}
              onBlur={onEditSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") onEditSubmit();
                if (e.key === "Escape") onEditCancel();
              }}
              className="min-w-0 flex-1 rounded border border-ring bg-background px-1 py-0.5 text-xs text-foreground outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span
                className={cn(
                  "flex-1 truncate leading-normal",
                  statusText && !node.isFolder && statusColor,
                )}
              >
                {node.name}
              </span>
              {statusText && (
                <span
                  className={cn(
                    "mx-1 shrink-0 text-[10px] font-medium tracking-tighter",
                    statusColor,
                  )}
                >
                  {statusText}
                </span>
              )}
            </>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48 py-1">
          {node.isFolder ? (
            <>
              <ContextMenuItem
                className="text-xs rounded-1 text-muted-foreground/90"
                onClick={() => actions.createIn(node.id, false)}
              >
                <FilePlus className="size-3" />
                {t("filePanel.newFile")}
              </ContextMenuItem>
              <ContextMenuItem
                className="text-xs rounded-1 text-muted-foreground/90"
                onClick={() => actions.createIn(node.id, true)}
              >
                <FolderPlus className="size-3" />
                {t("filePanel.newFolder")}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : (
            <>
              <ContextMenuItem
                className="text-xs rounded-1 text-muted-foreground/90"
                onClick={() => actions.createIn(null, false)}
              >
                <FilePlus className="size-3" />
                {t("filePanel.newFile")}
              </ContextMenuItem>
              <ContextMenuItem
                className="text-xs rounded-1 text-muted-foreground/90"
                onClick={() => actions.createIn(null, true)}
              >
                <FolderPlus className="size-3" />
                {t("filePanel.newFolder")}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            className="text-xs rounded-1 text-muted-foreground/90"
            onClick={() => {
              actions.startRename(node);
            }}
          >
            <Pencil className="size-3" />
            {t("filePanel.rename")}
          </ContextMenuItem>
          <ContextMenuItem
            className="text-xs rounded-1 text-muted-foreground/90"
            onClick={() => {
              actions.copyPath(node.id, false);
            }}
          >
            <Copy className="size-3" />
            {t("filePanel.copyPath")}
          </ContextMenuItem>
          <ContextMenuItem
            className="text-xs rounded-1 text-muted-foreground/90"
            onClick={() => {
              actions.copyPath(node.id, true);
            }}
          >
            <Copy className="size-3" />
            {t("filePanel.copyRelativePath")}
          </ContextMenuItem>
          <ContextMenuItem
            className="text-xs rounded-1 text-muted-foreground/90"
            onClick={() => {
              actions.revealInFinder(node.id);
            }}
          >
            <FolderOpen className="size-3" />
            {t("filePanel.revealInFinder")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            className="text-xs rounded-1 text-muted-foreground/90"
            onClick={() => {
              const ids =
                selectedIds.has(node.id) && selectedIds.size > 1 ? [...selectedIds] : [node.id];
              actions.deleteNode(ids);
            }}
          >
            <Trash2 className="size-3" />
            {t("filePanel.delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {node.isFolder &&
        isOpen &&
        node.children?.map((child) => (
          <TreeItem key={child.id} node={child} depth={depth + 1} {...childProps} />
        ))}
    </>
  );
}

export interface FilePanelProps {
  onPreviewFile?: (path: string) => void;
}

export function FilePanel({ onPreviewFile }: FilePanelProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState<{
    branch: string;
    files: Record<string, string>;
  } | null>(null);
  const refreshSeqRef = useRef(0);
  const { activeSessionId, sessions } = useAppStore();

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const cwd = activeSession?.cwd;
  const cwdFolderName = cwd ? (cwd.split("/").pop() ?? cwd) : "";

  useEffect(() => {
    refreshSeqRef.current += 1;
    setSelectedIds(new Set());
    setOpenFolders(new Set());
    setLastSelectedId(null);
    setEditingId(null);
    setGitStatus(null);
  }, [cwd]);

  const loadTree = useCallback(async (path: string, seq: number) => {
    setLoading(true);
    try {
      const result = (await request.readDir({ path, depth: 3 })) as TreeNode[] | null;
      if (refreshSeqRef.current !== seq) return;
      setData(result ?? []);
    } catch (err) {
      if (refreshSeqRef.current !== seq) return;
      console.error("Failed to load file tree:", err);
      setData([]);
    } finally {
      if (refreshSeqRef.current === seq) {
        setLoading(false);
      }
    }
  }, []);

  const fetchGitStatus = useCallback(async (path: string, seq: number) => {
    try {
      const status = await request.getGitStatus({ cwd: path });
      if (refreshSeqRef.current !== seq) return;
      setGitStatus(status);
    } catch {
      if (refreshSeqRef.current !== seq) return;
      setGitStatus(null);
    }
  }, []);

  const refresh = useCallback(() => {
    if (!cwd) return;
    const seq = refreshSeqRef.current + 1;
    refreshSeqRef.current = seq;
    loadTree(cwd, seq);
    fetchGitStatus(cwd, seq);
  }, [cwd, loadTree, fetchGitStatus]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Flatten tree for shift-select range
  const flattenTree = useCallback(
    (nodes: TreeNode[]): string[] => {
      const result: string[] = [];
      for (const node of nodes) {
        result.push(node.id);
        if (node.isFolder && openFolders.has(node.id) && node.children) {
          result.push(...flattenTree(node.children));
        }
      }
      return result;
    },
    [openFolders],
  );

  const toggle = useCallback((node: TreeNode) => {
    const id = node.id;
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

    if (node.isFolder && node.children === undefined) {
      request
        .readDir({ path: id, depth: 1 })
        .then((children) => {
          setData((oldData) => {
            function updateTree(tree: TreeNode[]): TreeNode[] {
              return tree.map((n) => {
                if (n.id === id) return { ...n, children: (children as TreeNode[]) ?? [] };
                if (n.children) return { ...n, children: updateTree(n.children) };
                return n;
              });
            }
            return updateTree(oldData);
          });
        })
        .catch((err) => {
          console.error("Failed to load children for", id, err);
          setData((oldData) => {
            function updateTree(tree: TreeNode[]): TreeNode[] {
              return tree.map((n) => {
                if (n.id === id) return { ...n, children: [] };
                if (n.children) return { ...n, children: updateTree(n.children) };
                return n;
              });
            }
            return updateTree(oldData);
          });
        });
    }
  }, []);

  const collapseAll = useCallback(() => {
    setOpenFolders(new Set());
  }, []);

  const handleSelect = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.metaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setLastSelectedId(id);
      } else if (e.shiftKey && lastSelectedId) {
        const flat = flattenTree(data);
        const startIdx = flat.indexOf(lastSelectedId);
        const endIdx = flat.indexOf(id);
        if (startIdx !== -1 && endIdx !== -1) {
          const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          setSelectedIds(new Set(flat.slice(from, to + 1)));
        }
      } else {
        setSelectedIds(new Set([id]));
        setLastSelectedId(id);
      }
    },
    [lastSelectedId, flattenTree, data],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelection]);

  // --- Editing ---
  const startRename = (node: TreeNode) => {
    setEditingId(node.id);
    setEditingValue(node.name);
  };

  const submitEdit = async () => {
    if (!editingId) return;
    const name = editingValue.trim();
    setEditingId(null);
    if (!name) {
      refresh();
      return;
    }
    if (editingId.startsWith("__new_")) {
      const parentPath = editingId.split("__parent__")[1] ?? cwd ?? "";
      const isFolder = editingId.includes("__folder__");
      try {
        await request.createFile({ path: `${parentPath}/${name}`, isFolder });
      } catch (err) {
        console.error("Create failed:", err);
      }
    } else {
      const parts = editingId.split("/");
      parts[parts.length - 1] = name;
      const newPath = parts.join("/");
      if (editingId !== newPath) {
        try {
          await request.renameFile({ oldPath: editingId, newPath });
        } catch (err) {
          console.error("Rename failed:", err);
        }
      }
    }
    refresh();
  };

  const createIn = (parentId: string | null, isFolder: boolean) => {
    const parentPath = parentId || cwd || "";
    const tempId = `__new_${isFolder ? "__folder__" : "__file__"}__parent__${parentPath}`;
    const tempNode: TreeNode = {
      id: tempId,
      name: "",
      isFolder,
      children: isFolder ? [] : undefined,
    };
    if (parentId) {
      setOpenFolders((prev) => new Set(prev).add(parentId));
      let needsFetch = false;
      for (const root of data) {
        const p = findNode(root, parentId);
        if (p && p.isFolder && p.children === undefined) {
          needsFetch = true;
          break;
        }
      }

      if (needsFetch) {
        request
          .readDir({ path: parentId, depth: 1 })
          .then((children) => {
            setData((oldData) => {
              function updateTree(tree: TreeNode[]): TreeNode[] {
                return tree.map((n) => {
                  if (n.id === parentId)
                    return { ...n, children: [tempNode, ...((children as TreeNode[]) ?? [])] };
                  if (n.children) return { ...n, children: updateTree(n.children) };
                  return n;
                });
              }
              return updateTree(oldData);
            });
          })
          .catch((err) => {
            console.error("Failed to load children for create:", err);
            setData((prev) => insertTemp(prev, parentId, tempNode));
          });
      } else {
        setData((prev) => insertTemp(prev, parentId, tempNode));
      }
    } else {
      setData((prev) => [tempNode, ...prev]);
    }
    setEditingId(tempId);
    setEditingValue("");
    setSelectedIds(new Set([tempId]));
  };

  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [osPlatform, setOsPlatform] = useState<string>("darwin");

  useEffect(() => {
    request.getPlatform().then((p: unknown) => setOsPlatform(p as string));
  }, []);

  const deleteNode = (ids: string[]) => {
    setPendingDeleteIds(ids);
  };

  const executeDelete = async (permanent: boolean) => {
    if (!pendingDeleteIds) return;
    try {
      await Promise.all(
        pendingDeleteIds.map((id) =>
          permanent ? request.deleteFile({ path: id }) : request.trashFile(id),
        ),
      );
    } catch (err) {
      console.error("Delete failed:", err);
    }
    setPendingDeleteIds(null);
    setSelectedIds(new Set());
    refresh();
  };

  const revealInFinder = async (id: string) => {
    try {
      await request.revealInFinder(id);
    } catch (err) {
      console.error("Reveal in Finder failed:", err);
    }
  };

  const trashLabel =
    osPlatform === "darwin"
      ? t("filePanel.moveToTrash")
      : osPlatform === "win32"
        ? t("filePanel.moveToRecycleBin")
        : t("filePanel.moveToTrash");

  // --- Drag & drop (multi-select aware, + external file drop) ---

  /** Check whether a DragEvent carries files from outside the app */
  const isExternalDrag = useCallback(
    (e: React.DragEvent) => {
      return e.dataTransfer.types.includes("Files") && dragIds.length === 0;
    },
    [dragIds],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect =
        e.dataTransfer.types.includes("Files") && dragIds.length === 0 ? "copy" : "move";
      setDropTargetId(id);
    },
    [dragIds],
  );

  const handleStartDrag = useCallback(
    (id: string, e: React.DragEvent) => {
      const ids = selectedIds.has(id) && selectedIds.size > 1 ? [...selectedIds] : [id];
      setDragIds(ids);
      e.dataTransfer.effectAllowed = "copyMove";

      // Attach structured node info so chat-input can create mentions
      const nodesPayloads = ids.map((nodeId) => {
        let isFolder = false;
        for (const root of data) {
          const found = findNode(root, nodeId);
          if (found) {
            isFolder = found.isFolder;
            break;
          }
        }
        return { id: nodeId, name: nodeId.split("/").pop() ?? nodeId, isFolder };
      });

      e.dataTransfer.setData("application/x-fello-tree-nodes", JSON.stringify(nodesPayloads));

      const downLoadablePlaylod = nodesPayloads.find((playlod) => !playlod.isFolder);
      if (downLoadablePlaylod) {
        const fileName = downLoadablePlaylod.name;
        const fileUrl = `file://${downLoadablePlaylod.id}`;
        e.dataTransfer.setData("DownloadURL", `application/octet-stream:${fileName}:${fileUrl}`);
      }

      const root = document.documentElement;
      const styles = getComputedStyle(root);
      const bg = styles.getPropertyValue("--accent").trim();
      const fg = styles.getPropertyValue("--accent-foreground").trim();
      const border = styles.getPropertyValue("--border").trim();

      const ghost = document.createElement("div");
      ghost.style.cssText = `
        position: fixed; left: -9999px; top: -9999px;
        max-width: 80px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        background-color: ${bg};
        color: ${fg};
        border: 1px solid ${border};
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 12px;
        line-height: 1.4;
        pointer-events: none;
        z-index: 99999;
      `;
      ghost.textContent = ids.length > 1 ? `${ids.length} items` : id.split("/").pop()!;
      document.body.appendChild(ghost);
      ghost.getBoundingClientRect();
      e.dataTransfer.setDragImage(ghost, 0, 0);
      const cleanup = () => {
        ghost.remove();
        e.target.removeEventListener("dragend", cleanup);
      };
      e.target.addEventListener("dragend", cleanup);
    },
    [selectedIds, data],
  );

  /** Read a File as base64 string */
  const readFileAsBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data:...;base64, prefix
        resolve(result.split(",")[1] ?? "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  /** Recursively process a FileSystemEntry and write to destDir */
  const processEntry = useCallback(
    async (entry: FileSystemEntry, destDir: string) => {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
        const base64 = await readFileAsBase64(file);
        await request.writeDroppedFile({ fileName: entry.name, base64, destDir });
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const subDir = `${destDir}/${entry.name}`;
        await request.writeDroppedFolder({ destDir: subDir });
        const reader = dirEntry.createReader();
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        for (const child of entries) {
          await processEntry(child, subDir);
        }
      }
    },
    [readFileAsBase64],
  );

  /** Handle external files/folders dropped into a target directory */
  const handleExternalDrop = useCallback(
    async (e: React.DragEvent, destDir: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetId(null);

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      // Use webkitGetAsEntry for folder support
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      if (entries.length > 0) {
        try {
          for (const entry of entries) {
            await processEntry(entry, destDir);
          }
        } catch (err) {
          console.error("Drop files in failed:", err);
        }
        refresh();
        return;
      }

      // Fallback: plain files without entry API
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const base64 = await readFileAsBase64(file);
          await request.writeDroppedFile({ fileName: file.name, base64, destDir });
        }
      } catch (err) {
        console.error("Drop files in failed:", err);
      }
      refresh();
    },
    [refresh, processEntry, readFileAsBase64],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetId(null);

      // External file drop
      if (isExternalDrag(e)) {
        return handleExternalDrop(e, targetId);
      }

      // Internal move
      if (dragIds.length === 0) return;
      const validIds = dragIds.filter((id) => id !== targetId && !targetId.startsWith(id + "/"));
      try {
        await Promise.all(
          validIds.map((id) => {
            const srcName = id.split("/").pop()!;
            const newPath = `${targetId}/${srcName}`;
            if (id === newPath) return Promise.resolve();
            return request.moveFile({ oldPath: id, newPath });
          }),
        );
      } catch (err) {
        console.error("Move failed:", err);
      }
      setDragIds([]);
      refresh();
    },
    [dragIds, refresh, isExternalDrag, handleExternalDrop],
  );

  const actions: Actions = {
    select: handleSelect,
    toggle,
    startRename,
    createIn,
    deleteNode,
    startDrag: handleStartDrag,
    dragOver: handleDragOver,
    dragLeave: () => setDropTargetId(null),
    drop: handleDrop,
    dragEnd: () => {
      setDragIds([]);
      setDropTargetId(null);
    },
    revealInFinder,
    previewFile: (id: string) => onPreviewFile?.(id),
    copyPath: (id: string, isRelative: boolean) => {
      const text = isRelative && cwd && id.startsWith(`${cwd}/`) ? id.replace(`${cwd}/`, "") : id;
      navigator.clipboard.writeText(text);
    },
  };

  const gitStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!gitStatus || !cwd) return map;
    for (const [rel, status] of Object.entries(gitStatus.files)) {
      const fullPath = `${cwd}/${rel}`;
      map.set(fullPath, status);

      let parent = fullPath;
      while (true) {
        const slashIdx = parent.lastIndexOf("/");
        if (slashIdx <= cwd.length) break;
        parent = parent.slice(0, slashIdx);
        if (!map.has(parent)) {
          map.set(parent, "•");
        }
      }
    }
    return map;
  }, [gitStatus, cwd]);

  const gitSummary = useMemo(() => {
    if (!gitStatus) return null;
    const counts: Record<GitSummaryKey, number> = {
      A: 0,
      U: 0,
      M: 0,
      R: 0,
      C: 0,
      D: 0,
    };
    for (const status of Object.values(gitStatus.files)) {
      if (status.includes("??")) counts.U++;
      else if (status.includes("A")) counts.A++;
      else if (status.includes("U")) counts.U++;
      else if (status.includes("M")) counts.M++;
      else if (status.includes("R")) counts.R++;
      else if (status.includes("C")) counts.C++;
      else if (status.includes("D")) counts.D++;
    }
    const hasChanges = Object.values(counts).some((count) => count > 0);

    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex shrink-0 items-center justify-between border-t border-border px-2 py-2 text-[10px] text-muted-foreground/80 outline-none",
            hasChanges && "hover:bg-accent/50 cursor-pointer",
          )}
          disabled={!hasChanges}
        >
          <div className="flex min-w-0 items-center gap-1" title={`Branch: ${gitStatus.branch}`}>
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{gitStatus.branch}</span>
          </div>
          {hasChanges && (
            <div className="ml-2 flex shrink-0 gap-1.5 font-medium tracking-tighter">
              {GIT_SUMMARY_BADGES.map(({ key, color }) =>
                counts[key] > 0 ? (
                  <span key={key} className={color}>
                    {key}
                    {counts[key]}
                  </span>
                ) : null,
              )}
            </div>
          )}
        </DropdownMenuTrigger>
        {hasChanges && (
          <DropdownMenuContent
            align="center"
            side="top"
            className="w-[calc(var(--anchor-width)-8px)] max-h-64 p-0"
          >
            <ScrollArea className="max-h-64">
              <div className="p-1">
                {Object.entries(gitStatus.files).map(([relPath, status]) => {
                  let statusColor = "text-muted-foreground";
                  let statusText = status.trim();
                  if (status.includes("??")) {
                    statusText = "U";
                    statusColor =
                      GIT_SUMMARY_BADGES.find((b) => b.key === "U")?.color || statusColor;
                  } else if (status.includes("A")) {
                    statusText = "A";
                    statusColor =
                      GIT_SUMMARY_BADGES.find((b) => b.key === "A")?.color || statusColor;
                  } else if (status.includes("R")) {
                    statusText = "R";
                    statusColor =
                      GIT_SUMMARY_BADGES.find((b) => b.key === "R")?.color || statusColor;
                  } else if (status.includes("C")) {
                    statusText = "C";
                    statusColor =
                      GIT_SUMMARY_BADGES.find((b) => b.key === "C")?.color || statusColor;
                  } else if (status.includes("M")) {
                    statusText = "M";
                    statusColor =
                      GIT_SUMMARY_BADGES.find((b) => b.key === "M")?.color || statusColor;
                  } else if (status.includes("D")) {
                    statusText = "D";
                    statusColor =
                      GIT_SUMMARY_BADGES.find((b) => b.key === "D")?.color || statusColor;
                  }

                  const slashIdx = relPath.lastIndexOf("/");
                  const folderPath = slashIdx !== -1 ? relPath.slice(0, slashIdx) : "";
                  const fileName = slashIdx !== -1 ? relPath.slice(slashIdx + 1) : relPath;

                  return (
                    <DropdownMenuItem
                      key={relPath}
                      className="text-xs rounded-1 flex items-center justify-between cursor-pointer"
                      onClick={() => cwd && onPreviewFile?.(`${cwd}/${relPath}`)}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn("truncate font-normal", statusColor)} title={fileName}>
                          {fileName}
                        </span>
                        {folderPath && (
                          <span
                            className="truncate flex-1 text-[10px] text-muted-foreground/60"
                            title={folderPath}
                          >
                            {folderPath}
                          </span>
                        )}
                      </div>
                      <span
                        className={cn(
                          "ml-2 shrink-0 text-[10px] font-normal tracking-tighter",
                          statusColor,
                        )}
                      >
                        {statusText}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </div>
            </ScrollArea>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    );
  }, [gitStatus, cwd]);

  const getSelectedFolder = (): string | null => {
    if (selectedIds.size !== 1) return null;
    const id = [...selectedIds][0];
    for (const n of data) {
      const found = findNode(n, id);
      if (found?.isFolder) return found.id;
    }
    return null;
  };

  if (!activeSessionId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t("filePanel.noActiveSession")}
      </div>
    );
  }

  if (loading && data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> {t("filePanel.loading")}
      </div>
    );
  }

  const sharedProps = {
    selectedIds,
    openFolders,
    editingId,
    editingValue,
    dropTargetId,
    gitStatusMap,
    onEditChange: setEditingValue,
    onEditSubmit: submitEdit,
    onEditCancel: () => setEditingId(null),
    actions,
  };

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col text-xs">
      {/* Header: folder name left, buttons right */}
      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
        <span className="truncate text-xs text-foreground/80 uppercase">{cwdFolderName}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => createIn(getSelectedFolder(), false)}
            title="New File"
          >
            <FilePlus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => createIn(getSelectedFolder(), true)}
            title="New Folder"
          >
            <FolderPlus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={collapseAll}
            title="Collapse Folders"
          >
            <ChevronsDownUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={refresh}
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ContextMenu>
          <ContextMenuTrigger
            render={<div />}
            className="min-h-full py-0.5"
            onClick={(e) => {
              if (e.target === e.currentTarget) clearSelection();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect =
                e.dataTransfer.types.includes("Files") && dragIds.length === 0 ? "copy" : "move";
              setDropTargetId("__root__");
            }}
            onDragLeave={() => setDropTargetId(null)}
            onDrop={async (e) => {
              e.preventDefault();
              setDropTargetId(null);
              if (!cwd) return;

              // External file drop onto root
              if (e.dataTransfer.types.includes("Files") && dragIds.length === 0) {
                await handleExternalDrop(e as React.DragEvent, cwd);
                return;
              }

              // Internal move to root
              if (dragIds.length === 0) return;
              try {
                await Promise.all(
                  dragIds.map((id) => {
                    const srcName = id.split("/").pop()!;
                    const newPath = `${cwd}/${srcName}`;
                    if (id === newPath) return Promise.resolve();
                    return request.moveFile({ oldPath: id, newPath });
                  }),
                );
              } catch (err) {
                console.error("Move failed:", err);
              }
              setDragIds([]);
              refresh();
            }}
          >
            {data.map((node) => (
              <TreeItem key={node.id} node={node} depth={0} {...sharedProps} />
            ))}
            {data.length === 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {t("filePanel.emptyDirectory")}
              </div>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48 py-1">
            <ContextMenuItem
              className="text-xs rounded-1 text-muted-foreground/90"
              onClick={() => createIn(null, false)}
            >
              <FilePlus className="size-3" />
              {t("filePanel.newFile")}
            </ContextMenuItem>
            <ContextMenuItem
              className="text-xs rounded-1 text-muted-foreground/90"
              onClick={() => createIn(null, true)}
            >
              <FolderPlus className="size-3" />
              {t("filePanel.newFolder")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-xs rounded-1 text-muted-foreground/90"
              onClick={() => revealInFinder(cwd ?? "")}
            >
              <FolderOpen className="size-3" />
              {t("filePanel.revealInFinder")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </ScrollArea>

      {gitSummary}

      <Dialog
        open={pendingDeleteIds !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteIds(null);
        }}
        disablePointerDismissal
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("filePanel.delete")}</DialogTitle>
            <DialogDescription>
              {pendingDeleteIds && pendingDeleteIds.length === 1
                ? t("filePanel.deleteConfirmSingle", { name: pendingDeleteIds[0].split("/").pop() })
                : t("filePanel.deleteConfirmMultiple", { count: pendingDeleteIds?.length ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteIds(null)}>
              {t("filePanel.cancel")}
            </Button>
            <Button variant="outline" onClick={() => executeDelete(false)}>
              {trashLabel}
            </Button>
            <Button variant="destructive" onClick={() => executeDelete(true)}>
              {t("filePanel.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function insertTemp(tree: TreeNode[], parentId: string, node: TreeNode): TreeNode[] {
  return tree.map((n) => {
    if (n.id === parentId) return { ...n, children: [node, ...(n.children ?? [])] };
    if (n.children) return { ...n, children: insertTemp(n.children, parentId, node) };
    return n;
  });
}

function findNode(node: TreeNode, id: string): TreeNode | null {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}
