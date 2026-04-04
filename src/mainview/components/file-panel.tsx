import { useEffect, useState, useCallback, useRef } from "react";
import { request } from "../backend";
import { useAppStore } from "../store";
import { Button } from "@/components/ui/button";
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
  toggle: (id: string) => void;
  startRename: (node: TreeNode) => void;
  createIn: (parentId: string | null, isFolder: boolean) => void;
  deleteNode: (ids: string[]) => void;
  startDrag: (id: string, e: React.DragEvent) => void;
  dragOver: (e: React.DragEvent, id: string) => void;
  dragLeave: () => void;
  drop: (e: React.DragEvent, id: string) => void;
  dragEnd: () => void;
  revealInFinder: (id: string) => void;
}

function TreeItem({
  node,
  depth,
  selectedIds,
  openFolders,
  editingId,
  editingValue,
  dropTargetId,
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
  onEditChange: (v: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  actions: Actions;
}) {
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
    onEditChange,
    onEditSubmit,
    onEditCancel,
    actions,
  };

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
            if (node.isFolder && !e.metaKey && !e.shiftKey) actions.toggle(node.id);
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
            <Folder className="size-4 shrink-0 text-primary/60" />
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
            <span className="flex-1 truncate leading-normal">{node.name}</span>
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
                New File
              </ContextMenuItem>
              <ContextMenuItem
                className="text-xs rounded-1 text-muted-foreground/90"
                onClick={() => actions.createIn(node.id, true)}
              >
                <FolderPlus className="size-3" />
                New Folder
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
                New File
              </ContextMenuItem>
              <ContextMenuItem
                className="text-xs rounded-1 text-muted-foreground/90"
                onClick={() => actions.createIn(null, true)}
              >
                <FolderPlus className="size-3" />
                New Folder
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
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            className="text-xs rounded-1 text-muted-foreground/90"
            onClick={() => {
              actions.revealInFinder(node.id);
            }}
          >
            <FolderOpen className="size-3" />
            Reveal in Finder
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
            Delete
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

export function FilePanel() {
  const [data, setData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const { activeSessionId, sessions } = useAppStore();

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const cwd = activeSession?.cwd;
  const cwdFolderName = cwd ? (cwd.split("/").pop() ?? cwd) : "";

  useEffect(() => {
    setSelectedIds(new Set());
    setOpenFolders(new Set());
    setLastSelectedId(null);
    setEditingId(null);
  }, [cwd]);

  const loadTree = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const result = (await request.readDir({ path, depth: 3 })) as TreeNode[] | null;
      setData(result ?? []);
    } catch (err) {
      console.error("Failed to load file tree:", err);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    if (cwd) loadTree(cwd);
  }, [cwd, loadTree]);
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

  const toggle = useCallback((id: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      setData((prev) => insertTemp(prev, parentId, tempNode));
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
      ? "Move to Trash"
      : osPlatform === "win32"
        ? "Move to Recycle Bin"
        : "Move to Trash";

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
  };

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
        No active session
      </div>
    );
  }

  if (loading && data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Loading...
      </div>
    );
  }

  const sharedProps = {
    selectedIds,
    openFolders,
    editingId,
    editingValue,
    dropTargetId,
    onEditChange: setEditingValue,
    onEditSubmit: submitEdit,
    onEditCancel: () => setEditingId(null),
    actions,
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
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
              <div className="py-6 text-center text-xs text-muted-foreground">Empty directory</div>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48 py-1">
            <ContextMenuItem
              className="text-xs rounded-1 text-muted-foreground/90"
              onClick={() => createIn(null, false)}
            >
              <FilePlus className="size-3" />
              New File
            </ContextMenuItem>
            <ContextMenuItem
              className="text-xs rounded-1 text-muted-foreground/90"
              onClick={() => createIn(null, true)}
            >
              <FolderPlus className="size-3" />
              New Folder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-xs rounded-1 text-muted-foreground/90"
              onClick={() => revealInFinder(cwd ?? "")}
            >
              <FolderOpen className="size-3" />
              Reveal in Finder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </ScrollArea>

      <Dialog
        open={pendingDeleteIds !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteIds(null);
        }}
        disablePointerDismissal
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete</DialogTitle>
            <DialogDescription>
              {pendingDeleteIds && pendingDeleteIds.length === 1
                ? `How would you like to delete "${pendingDeleteIds[0].split("/").pop()}"?`
                : `How would you like to delete ${pendingDeleteIds?.length ?? 0} items?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteIds(null)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => executeDelete(false)}>
              {trashLabel}
            </Button>
            <Button variant="destructive" onClick={() => executeDelete(true)}>
              Delete
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
