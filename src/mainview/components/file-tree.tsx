import { useEffect, useState, useCallback, useRef } from "react";
import { request } from "../backend";
import { useAppStore } from "../store";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FilePlus,
  FolderPlus,
  RefreshCw,
  ChevronRight,
  Folder,
  File,
  Pencil,
  Trash2,
  FolderInput,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TreeNode {
  id: string;
  name: string;
  isFolder: boolean;
  children?: TreeNode[];
}

interface Actions {
  select: (id: string) => void;
  toggle: (id: string) => void;
  startRename: (node: TreeNode) => void;
  createIn: (parentId: string | null, isFolder: boolean) => void;
  deleteNode: (id: string) => void;
  moveTo: (id: string) => void;
  startDrag: (id: string) => void;
  dragOver: (e: React.DragEvent, id: string) => void;
  dragLeave: () => void;
  drop: (e: React.DragEvent, id: string) => void;
  dragEnd: () => void;
}

function TreeItem({
  node,
  depth,
  selectedId,
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
  selectedId: string | null;
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
  const isSelected = selectedId === node.id;
  const isEditing = editingId === node.id;
  const isDragOver = dropTargetId === node.id;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) setTimeout(() => inputRef.current?.focus(), 0);
  }, [isEditing]);

  const row = (
    <div
      draggable={!isEditing}
      onDragStart={(e) => {
        e.stopPropagation();
        actions.startDrag(node.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => node.isFolder && actions.dragOver(e, node.id)}
      onDragLeave={actions.dragLeave}
      onDrop={(e) => node.isFolder && actions.drop(e, node.id)}
      onDragEnd={actions.dragEnd}
      className={cn(
        "flex h-[28px] cursor-default select-none items-center gap-1.5 px-1.5 text-[13px] leading-none",
        isSelected
          ? "bg-accent text-accent-foreground"
          : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
        isDragOver && "ring-1 ring-primary bg-primary/5",
      )}
      style={{ paddingLeft: `${depth * 16 + 6}px` }}
      onClick={(e) => {
        e.stopPropagation();
        actions.select(node.id);
        if (node.isFolder) actions.toggle(node.id);
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
  );

  const childProps = {
    selectedId,
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
        <ContextMenuTrigger>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          {node.isFolder && (
            <>
              <ContextMenuItem onClick={() => actions.createIn(node.id, false)}>
                <FilePlus className="size-4" /> New File
              </ContextMenuItem>
              <ContextMenuItem onClick={() => actions.createIn(node.id, true)}>
                <FolderPlus className="size-4" /> New Folder
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={() => actions.startRename(node)}>
            <Pencil className="size-4" /> Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.moveTo(node.id)}>
            <FolderInput className="size-4" /> Move to...
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => actions.deleteNode(node.id)}>
            <Trash2 className="size-4" /> Delete
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

export function FileTree() {
  const [data, setData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const { activeSessionId, sessions } = useAppStore();

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const cwd = activeSession?.cwd;

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

  const toggle = useCallback((id: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

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
    setSelectedId(tempId);
  };

  const deleteNode = async (id: string) => {
    try {
      await request.deleteFile(id);
    } catch (err) {
      console.error("Delete failed:", err);
    }
    refresh();
  };

  const moveTo = async (id: string) => {
    const dest = (await request.pickWorkDir()) as string | null;
    if (!dest) return;
    try {
      await request.moveFile({ oldPath: id, newPath: `${dest}/${id.split("/").pop()!}` });
    } catch (err) {
      console.error("Move failed:", err);
    }
    refresh();
  };

  // --- Drag & drop ---
  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropTargetId(id);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetId(null);
      if (!dragId || dragId === targetId) return;
      // Don't drop into self or child
      if (targetId.startsWith(dragId + "/")) return;
      const srcName = dragId.split("/").pop()!;
      const newPath = `${targetId}/${srcName}`;
      if (dragId === newPath) return;
      try {
        await request.moveFile({ oldPath: dragId, newPath });
      } catch (err) {
        console.error("Move failed:", err);
      }
      setDragId(null);
      refresh();
    },
    [dragId, refresh],
  );

  const actions: Actions = {
    select: setSelectedId,
    toggle,
    startRename,
    createIn,
    deleteNode,
    moveTo,
    startDrag: setDragId,
    dragOver: handleDragOver,
    dragLeave: () => setDropTargetId(null),
    drop: handleDrop,
    dragEnd: () => {
      setDragId(null);
      setDropTargetId(null);
    },
  };

  // --- Toolbar: smart create (into selected folder or root) ---
  const getSelectedFolder = (): string | null => {
    if (!selectedId) return null;
    for (const n of data) {
      const found = findNode(n, selectedId);
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
    selectedId,
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
      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => createIn(getSelectedFolder(), false)}
          title="New File"
        >
          <FilePlus className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => createIn(getSelectedFolder(), true)}
          title="New Folder"
        >
          <FolderPlus className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-6"
          onClick={refresh}
          title="Refresh"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div
          className="py-0.5"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTargetId("__root__");
          }}
          onDragLeave={() => setDropTargetId(null)}
          onDrop={async (e) => {
            e.preventDefault();
            setDropTargetId(null);
            if (!dragId || !cwd) return;
            const srcName = dragId.split("/").pop()!;
            const newPath = `${cwd}/${srcName}`;
            if (dragId === newPath) return;
            try {
              await request.moveFile({ oldPath: dragId, newPath });
            } catch (err) {
              console.error("Move failed:", err);
            }
            setDragId(null);
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
