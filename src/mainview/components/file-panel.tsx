import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { request, subscribe, isWebUI } from "../backend";
import { electron } from "../electron";
import { useAppStore } from "../store";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMessage } from "./message";
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
import { cn, extractErrorMessage } from "@/lib/utils";

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
  copyPath: (id: string, isAbsolute: boolean) => void;
}

const GIT_FOLDER_STATUS = {
  text: "•",
  color: "text-amber-500/90",
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
      statusColor = "text-muted-foreground/90";
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
            <Folder className="size-4 shrink-0 text-muted-foreground/90" />
          ) : (
            <File className="size-4 shrink-0 text-muted-foreground/90" />
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
        <ContextMenuContent>
          {node.isFolder ? (
            <>
              <ContextMenuItem onClick={() => actions.createIn(node.id, false)}>
                <FilePlus />
                {t("filePanel.newFile")}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => actions.createIn(node.id, true)}>
                <FolderPlus />
                {t("filePanel.newFolder")}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : (
            <>
              <ContextMenuItem onClick={() => actions.createIn(null, false)}>
                <FilePlus />
                {t("filePanel.newFile")}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => actions.createIn(null, true)}>
                <FolderPlus />
                {t("filePanel.newFolder")}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            onClick={() => {
              actions.startRename(node);
            }}
          >
            <Pencil />
            {t("filePanel.rename")}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              actions.copyPath(node.id, true);
            }}
          >
            <Copy />
            {t("filePanel.copyPath")}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              actions.copyPath(node.id, false);
            }}
          >
            <Copy />
            {t("filePanel.copyRelativePath")}
          </ContextMenuItem>
          {!isWebUI && (
            <ContextMenuItem
              onClick={() => {
                actions.revealInFinder(node.id);
              }}
            >
              <FolderOpen />
              {t("filePanel.revealInFinder")}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => {
              const ids =
                selectedIds.has(node.id) && selectedIds.size > 1 ? [...selectedIds] : [node.id];
              actions.deleteNode(ids);
            }}
          >
            <Trash2 />
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
  projectId: string;
  onPreviewFile?: (file: { projectId: string; relativePath: string }) => void;
}

export function FilePanel({ projectId, onPreviewFile }: FilePanelProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const openFoldersRef = useRef<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState<{
    branch: string;
    files: Record<string, string>;
  } | null>(null);
  const refreshSeqRef = useRef(0);
  const { projects } = useAppStore();
  const { confirm } = useMessage();

  const activeProjectId = projectId;
  const cwd = useMemo(() => {
    return projects.find((p) => p.id === projectId)?.cwd ?? "";
  }, [projectId, projects]);
  const cwdFolderName = cwd ? (cwd.split(/[/\\]/).pop() ?? cwd) : "";

  useEffect(() => {
    refreshSeqRef.current += 1;
    setSelectedIds(new Set());
    setOpenFolders(new Set());
    openFoldersRef.current = new Set();
    setLastSelectedId(null);
    setEditingId(null);
    setGitStatus(null);
    setData([]);
  }, [cwd]);

  useEffect(() => {
    openFoldersRef.current = openFolders;
  }, [openFolders]);

  const loadTree = useCallback(async (projectId: string, seq: number) => {
    setLoading(true);
    try {
      const dirsToFetch = Array.from(new Set(["", ...Array.from(openFoldersRef.current)]));
      const settled = await Promise.allSettled(
        dirsToFetch.map(async (dir) => {
          const children = await request.readDir({ projectId, relativePath: dir });
          return { dir, children: children ?? [] };
        }),
      );

      const rootResult = settled[0];
      if (rootResult?.status !== "fulfilled") {
        throw rootResult?.reason ?? new Error("Failed to load file tree");
      }

      const results = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (refreshSeqRef.current !== seq) return;
      setData((oldData) => {
        const oldExpanded = new Map<string, TreeNode[]>();
        function buildExpandedMap(nodes: TreeNode[]) {
          for (const n of nodes) {
            if (n.children) {
              oldExpanded.set(n.id, n.children);
              buildExpandedMap(n.children);
            }
          }
        }
        buildExpandedMap(oldData);

        const fetchedByDir = new Map<string, TreeNode[]>();
        for (const r of results) {
          fetchedByDir.set(r.dir, r.children);
        }

        const nextData = fetchedByDir.get("") ?? [];

        function updateNodes(nodes: TreeNode[]): TreeNode[] {
          return nodes.map((node) => {
            const fetchedChildren = fetchedByDir.get(node.id);
            let children = node.children;

            if (
              fetchedChildren === undefined &&
              children === undefined &&
              oldExpanded.has(node.id)
            ) {
              children = oldExpanded.get(node.id);
            }

            if (fetchedChildren !== undefined) {
              children = fetchedChildren;
            }

            if (children) {
              return { ...node, children: updateNodes(children) };
            }
            return node;
          });
        }

        return updateNodes(nextData);
      });
    } catch (err) {
      if (refreshSeqRef.current !== seq) return;
      console.error("Failed to load file tree:", extractErrorMessage(err));
      setData([]);
    } finally {
      if (refreshSeqRef.current === seq) {
        setLoading(false);
      }
    }
  }, []);

  const fetchGitStatus = useCallback(async (projectId: string, seq: number) => {
    try {
      const status = await request.getGitStatus({ projectId });
      if (refreshSeqRef.current !== seq) return;
      setGitStatus(status);
    } catch {
      if (refreshSeqRef.current !== seq) return;
      setGitStatus(null);
    }
  }, []);

  const refresh = useCallback(() => {
    if (!cwd || !activeProjectId) return;

    const seq = refreshSeqRef.current + 1;
    refreshSeqRef.current = seq;
    loadTree(activeProjectId, seq);
    fetchGitStatus(activeProjectId, seq);
  }, [cwd, activeProjectId, loadTree, fetchGitStatus]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!cwd || !activeProjectId) return;

    const handleFsChanged = async (payload: { projectId: string; changes: string[] }) => {
      if (payload.projectId !== activeProjectId) return;

      const parentDirs = new Set<string>();

      for (const change of payload.changes) {
        const lastSlash = change.lastIndexOf("/");

        if (lastSlash !== -1) {
          parentDirs.add(change.slice(0, lastSlash));
        } else {
          parentDirs.add("");
        }
      }

      const dirsToFetch = Array.from(parentDirs).filter(
        (dir) => dir === "" || openFolders.has(dir),
      );

      if (dirsToFetch.length > 0) {
        try {
          const results = await Promise.all(
            dirsToFetch.map(async (dir) => {
              const children = await request.readDir({
                projectId: activeProjectId,
                relativePath: dir,
              });
              return { dir, children: children ?? [] };
            }),
          );

          setData((oldData) => {
            const oldExpanded = new Map<string, TreeNode[]>();
            function buildExpandedMap(nodes: TreeNode[]) {
              for (const n of nodes) {
                if (n.children) {
                  oldExpanded.set(n.id, n.children);
                  buildExpandedMap(n.children);
                }
              }
            }
            buildExpandedMap(oldData);

            const fetchedByDir = new Map<string, TreeNode[]>();
            for (const r of results) {
              fetchedByDir.set(r.dir, r.children);
            }

            const nextData = fetchedByDir.get("") ?? oldData;

            function updateNodes(nodes: TreeNode[]): TreeNode[] {
              return nodes.map((node) => {
                const fetchedChildren = fetchedByDir.get(node.id);
                let children = node.children;

                if (
                  fetchedChildren === undefined &&
                  children === undefined &&
                  oldExpanded.has(node.id)
                ) {
                  children = oldExpanded.get(node.id);
                }

                if (fetchedChildren !== undefined) {
                  children = fetchedChildren;
                }

                if (children) {
                  return { ...node, children: updateNodes(children) };
                }
                return node;
              });
            }

            return updateNodes(nextData);
          });
        } catch (err) {
          console.error("Partial update failed:", extractErrorMessage(err));
        }
      }

      fetchGitStatus(activeProjectId, refreshSeqRef.current);
    };

    subscribe.on("fs-changed", handleFsChanged);
    return () => subscribe.off("fs-changed", handleFsChanged);
  }, [cwd, activeProjectId, openFolders, fetchGitStatus]);

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

  const toggle = useCallback(
    (node: TreeNode) => {
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

      if (node.isFolder && node.children === undefined && activeProjectId) {
        request
          .readDir({ projectId: activeProjectId, relativePath: id })
          .then((children) => {
            setData((oldData) => {
              function updateTree(tree: TreeNode[]): TreeNode[] {
                return tree.map((n) => {
                  if (n.id === id) return { ...n, children: children ?? [] };
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
    },
    [cwd],
  );

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
    if (!editingId || !activeProjectId) return;
    const name = editingValue.trim();
    setEditingId(null);
    if (!name) {
      refresh();
      return;
    }
    if (editingId.startsWith("__new_")) {
      const parentPath = editingId.split("__parent__")[1] ?? "";
      const isFolder = editingId.includes("__folder__");
      try {
        await request.createFile({
          projectId: activeProjectId,
          relativePath: parentPath ? `${parentPath}/${name}` : name,
          isFolder,
        });
      } catch (err) {
        console.error("Create failed:", extractErrorMessage(err));
      }
    } else {
      const parts = editingId.split("/");
      parts[parts.length - 1] = name;
      const newPath = parts.join("/");
      if (editingId !== newPath) {
        try {
          await request.renameFile({
            projectId: activeProjectId,
            oldRelativePath: editingId,
            newRelativePath: newPath,
          });
        } catch (err) {
          console.error("Rename failed:", extractErrorMessage(err));
        }
      }
    }
    refresh();
  };

  const createIn = (parentId: string | null, isFolder: boolean) => {
    if (!activeProjectId) return;
    const parentPath = parentId || "";
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
          .readDir({ projectId: activeProjectId, relativePath: parentId })
          .then((children) => {
            setData((oldData) => {
              function updateTree(tree: TreeNode[]): TreeNode[] {
                return tree.map((n) => {
                  if (n.id === parentId) return { ...n, children: [tempNode, ...(children ?? [])] };
                  if (n.children) return { ...n, children: updateTree(n.children) };
                  return n;
                });
              }
              return updateTree(oldData);
            });
          })
          .catch((err) => {
            console.error("Failed to load children for create:", extractErrorMessage(err));
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

  const [osPlatform, setOsPlatform] = useState<string>("darwin");

  useEffect(() => {
    request.getPlatform().then((p) => setOsPlatform(p));
  }, []);

  const trashLabel =
    osPlatform === "darwin"
      ? t("filePanel.moveToTrash")
      : osPlatform === "win32"
        ? t("filePanel.moveToRecycleBin")
        : t("filePanel.moveToTrash");

  const deleteNode = async (ids: string[]) => {
    if (ids.length === 0 || !activeProjectId) return;

    await confirm({
      title: t("filePanel.delete"),
      content:
        ids.length === 1
          ? t("filePanel.deleteConfirmSingle", { name: ids[0].split("/").pop() })
          : t("filePanel.deleteConfirmMultiple", { count: ids.length }),
      buttons: [
        { text: t("filePanel.cancel"), value: "cancel", variant: "outline" },
        {
          text: trashLabel,
          variant: "outline",
          hidden: isWebUI,
          value: async () => {
            try {
              if (activeProjectId) {
                await Promise.all(
                  ids.map(async (id) => {
                    const absPath = await request.getSystemFilePath({
                      projectId: activeProjectId,
                      path: id,
                      isAbsolute: true,
                    });
                    return electron.trashFile(absPath);
                  }),
                );
              }
            } catch (err) {
              console.error("Delete failed:", extractErrorMessage(err));
            }
            setSelectedIds(new Set());
            refresh();
            return "trashed";
          },
        },
        {
          text: t("filePanel.delete"),
          variant: "destructive",
          value: async () => {
            try {
              await Promise.all(
                ids.map((id) =>
                  request.deleteFile({ projectId: activeProjectId, relativePath: id }),
                ),
              );
            } catch (err) {
              console.error("Delete failed:", extractErrorMessage(err));
            }
            setSelectedIds(new Set());
            refresh();
            return "deleted";
          },
        },
      ],
    });
  };

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
      ghost.textContent =
        ids.length > 1 ? t("filePanel.dragItems", { count: ids.length }) : id.split("/").pop()!;
      document.body.appendChild(ghost);
      ghost.getBoundingClientRect();
      e.dataTransfer.setDragImage(ghost, 0, 0);
      const cleanup = () => {
        ghost.remove();
        e.target.removeEventListener("dragend", cleanup);
      };
      e.target.addEventListener("dragend", cleanup);
    },
    [selectedIds, data, t],
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
      if (!activeProjectId) return;
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
        const base64 = await readFileAsBase64(file);
        await request.writeExternalFile({
          projectId: activeProjectId,
          fileName: entry.name,
          base64,
          destRelativeDir: destDir,
        });
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const subDir = destDir ? `${destDir}/${entry.name}` : entry.name;
        await request.createFile({
          projectId: activeProjectId,
          relativePath: subDir,
          isFolder: true,
        });
        const reader = dirEntry.createReader();
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        for (const child of entries) {
          await processEntry(child, subDir);
        }
      }
    },
    [readFileAsBase64, activeProjectId],
  );

  /** Handle external files/folders dropped into a target directory */
  const handleExternalDrop = useCallback(
    async (e: React.DragEvent, destDir: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetId(null);
      if (!activeProjectId) return;

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
          console.error("Drop files in failed:", extractErrorMessage(err));
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
          await request.writeExternalFile({
            projectId: activeProjectId,
            fileName: file.name,
            base64,
            destRelativeDir: destDir,
          });
        }
      } catch (err) {
        console.error("Drop files in failed:", extractErrorMessage(err));
      }
      refresh();
    },
    [refresh, processEntry, readFileAsBase64, activeProjectId],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetId(null);
      if (!activeProjectId) return;

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
            const newPath = targetId ? `${targetId}/${srcName}` : srcName;
            if (id === newPath) return Promise.resolve();
            return request.moveFile({
              projectId: activeProjectId,
              oldRelativePath: id,
              newRelativePath: newPath,
            });
          }),
        );
      } catch (err) {
        console.error("Move failed:", extractErrorMessage(err));
      }
      setDragIds([]);
      refresh();
    },
    [dragIds, refresh, isExternalDrag, handleExternalDrop, activeProjectId],
  );

  const revealInFinder = useCallback(async (path: string) => {
    try {
      await electron.revealInFinder(path);
    } catch (err) {
      console.error("revealInFinder failed:", extractErrorMessage(err));
    }
  }, []);

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
    revealInFinder: async (id: string) => {
      if (!activeProjectId) return;
      const absPath = await request.getSystemFilePath({
        projectId: activeProjectId,
        path: id,
        isAbsolute: true,
      });
      electron.revealInFinder(absPath); // TODO: Update revealInFinder API to use projectId/relativePath later
    },
    previewFile: (id: string) => {
      if (!activeProjectId) return;
      onPreviewFile?.({ projectId: activeProjectId, relativePath: id });
    },
    copyPath: async (id: string, isAbsolute: boolean) => {
      if (!activeProjectId) return;
      const text = await request.getSystemFilePath({
        projectId: activeProjectId,
        path: id,
        isAbsolute,
      });
      navigator.clipboard.writeText(text);
    },
  };

  const gitStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!gitStatus || !cwd) return map;
    for (const [rel, status] of Object.entries(gitStatus.files)) {
      map.set(rel, status);

      let parent = rel;
      while (true) {
        const slashIdx = parent.lastIndexOf("/");
        if (slashIdx === -1) break;
        parent = parent.slice(0, slashIdx);
        if (!map.has(parent)) {
          map.set(parent, GIT_FOLDER_STATUS.text);
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
            "flex shrink-0 items-center justify-between border-t border-border px-2.5 py-2 text-xs text-foreground/70 outline-none",
            hasChanges && "hover:bg-accent/50",
          )}
          disabled={!hasChanges}
        >
          <div className="flex min-w-0  items-center gap-1" title={`Branch: ${gitStatus.branch}`}>
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{gitStatus.branch}</span>
          </div>
          {hasChanges && (
            <div className="ml-2 mr-1 flex shrink-0 gap-1.5 text-[10px] font-normal tracking-tighter">
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
            className="w-[calc(var(--anchor-width)-8px)] max-h-64"
          >
            <ScrollArea className="max-h-64">
              <div>
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
                      onClick={() =>
                        activeProjectId &&
                        onPreviewFile?.({ projectId: activeProjectId, relativePath: relPath })
                      }
                    >
                      <div className="flex w-full items-center gap-2">
                        <span
                          className={cn("truncate text-[11px] font-normal", statusColor)}
                          title={fileName}
                        >
                          {fileName}
                        </span>
                        <span
                          className="truncate flex-1 text-[11px] text-muted-foreground/50"
                          title={folderPath ?? undefined}
                        >
                          {folderPath ?? ""}
                        </span>
                        <span
                          className={cn(
                            "ml-2 shrink-0 text-[10px] font-normal tracking-tighter",
                            statusColor,
                          )}
                        >
                          {statusText}
                        </span>
                      </div>
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

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No project selected
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
        <span className="truncate text-xs text-foreground/70 uppercase">{cwdFolderName}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => createIn(getSelectedFolder(), false)}
            title={t("filePanel.newFile")}
          >
            <FilePlus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => createIn(getSelectedFolder(), true)}
            title={t("filePanel.newFolder")}
          >
            <FolderPlus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={collapseAll}
            title={t("filePanel.collapseFolders")}
          >
            <ChevronsDownUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={refresh}
            title={t("filePanel.refresh", "Refresh")}
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
                await handleExternalDrop(e, "");
                return;
              }

              // Internal move to root
              if (dragIds.length === 0 || !activeProjectId) return;
              try {
                await Promise.all(
                  dragIds.map((id) => {
                    const srcName = id.split("/").pop()!;
                    const newPath = srcName;
                    if (id === newPath) return Promise.resolve();
                    return request.moveFile({
                      projectId: activeProjectId,
                      oldRelativePath: id,
                      newRelativePath: newPath,
                    });
                  }),
                );
              } catch (err) {
                console.error("Move failed:", extractErrorMessage(err));
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
          <ContextMenuContent>
            <ContextMenuItem onClick={() => createIn(null, false)}>
              <FilePlus />
              {t("filePanel.newFile")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => createIn(null, true)}>
              <FolderPlus />
              {t("filePanel.newFolder")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            {!isWebUI && (
              <ContextMenuItem onClick={() => revealInFinder(cwd ?? "")}>
                <FolderOpen />
                {t("filePanel.revealInFinder")}
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </ScrollArea>

      {gitSummary}
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
