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
  FilePlus,
  FolderPlus,
  RefreshCw,
  ChevronRight,
  Folder,
  File,
  Loader2,
  ChevronsDownUp,
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
  showNodeContextMenu: (node: TreeNode, e: React.MouseEvent) => void;
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
      <div
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
          e.preventDefault();
          e.stopPropagation();
          actions.showNodeContextMenu(node, e);
        }}
        className={cn(
          "flex h-[28px] cursor-default select-none items-center gap-1.5 px-1.5 text-[13px] leading-none",
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
            className="min-w-0 flex-1 rounded border border-ring bg-background px-1 py-0.5 text-[13px] text-foreground outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate">{node.name}</span>
        )}
      </div>
      {node.isFolder &&
        isOpen &&
        node.children?.map((child) => (
          <TreeItem key={child.id} node={child} depth={depth + 1} {...childProps} />
        ))}
    </>
  );
}

async function showNativeContextMenu(
  items: Array<{
    label?: string;
    action?: string;
    type?: string;
    enabled?: boolean;
    data?: unknown;
  }>,
): Promise<string | null> {
  return (await request.showContextMenu({ items })) as string | null;
}

export function FileTree() {
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

  const deleteNode = (ids: string[]) => {
    setPendingDeleteIds(ids);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteIds) return;
    try {
      await Promise.all(pendingDeleteIds.map((id) => request.deleteFile(id)));
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

  // --- Native context menus ---
  const showNodeContextMenu = useCallback(
    async (node: TreeNode, _e: React.MouseEvent) => {
      const items: Array<{ label?: string; action?: string; type?: string; data?: unknown }> = [];

      if (node.isFolder) {
        items.push({ label: "New File", action: "new-file", data: { parentId: node.id } });
        items.push({ label: "New Folder", action: "new-folder", data: { parentId: node.id } });
        items.push({ type: "separator" });
      } else {
        items.push({ label: "New File", action: "new-file", data: { parentId: null } });
        items.push({ label: "New Folder", action: "new-folder", data: { parentId: null } });
        items.push({ type: "separator" });
      }

      items.push({
        label: "Rename",
        action: "rename",
        data: { nodeId: node.id, nodeName: node.name, nodeIsFolder: node.isFolder },
      });
      items.push({ label: "Reveal in Finder", action: "reveal", data: { path: node.id } });
      items.push({ type: "separator" });
      items.push({ label: "Delete", action: "delete", data: { nodeId: node.id } });

      const action = await showNativeContextMenu(items);
      if (!action) return;

      if (action.startsWith("new-file")) {
        const parentId = node.isFolder ? node.id : null;
        createIn(parentId, false);
      } else if (action.startsWith("new-folder")) {
        const parentId = node.isFolder ? node.id : null;
        createIn(parentId, true);
      } else if (action.startsWith("rename")) {
        startRename(node);
      } else if (action.startsWith("reveal")) {
        revealInFinder(node.id);
      } else if (action.startsWith("delete")) {
        const ids = selectedIds.has(node.id) && selectedIds.size > 1 ? [...selectedIds] : [node.id];
        deleteNode(ids);
      }
    },
    [selectedIds, cwd],
  );

  const showBlankContextMenu = useCallback(
    async (_e: React.MouseEvent) => {
      const items = [
        { label: "New File", action: "new-file" },
        { label: "New Folder", action: "new-folder" },
        { type: "separator" as const },
        { label: "Reveal in Finder", action: "reveal" },
      ];

      const action = await showNativeContextMenu(items);
      if (!action) return;

      if (action === "new-file") createIn(null, false);
      else if (action === "new-folder") createIn(null, true);
      else if (action === "reveal") revealInFinder(cwd ?? "");
    },
    [cwd],
  );

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
      e.dataTransfer.effectAllowed = "move";

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
    [selectedIds],
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
    showNodeContextMenu,
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
    <div className="flex h-full flex-col text-[13px]">
      {/* Header: folder name left, buttons right */}
      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
        <span className="truncate text-xs font-medium text-foreground/80">{cwdFolderName}</span>
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
      <ScrollArea className="flex-1">
        <div
          className="min-h-full py-0.5"
          onClick={(e) => {
            if (e.target === e.currentTarget) clearSelection();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            showBlankContextMenu(e);
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
        </div>
      </ScrollArea>

      <Dialog
        open={pendingDeleteIds !== null}
        onOpenChange={(open) => !open && setPendingDeleteIds(null)}
        disablePointerDismissal
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              {pendingDeleteIds && pendingDeleteIds.length === 1
                ? `确定要删除「${pendingDeleteIds[0].split("/").pop()}」吗？此操作无法撤销。`
                : `确定要删除选中的 ${pendingDeleteIds?.length ?? 0} 个项目吗？此操作无法撤销。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteIds(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              删除
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
