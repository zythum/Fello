import { useEffect, useState, useCallback, useRef, useMemo, memo } from "react";
import { request, subscribe, isWebUI } from "../../../backend";
import { EDITOR_LABELS } from "../../../../shared/constants";
import { electron } from "../../../electron";
import { useAppStore } from "../../../store";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMessage } from "../../providers/message";
import { ROOT_DROP_TARGET } from "../tree/constants";
import { FileTree } from "../tree/file-tree";
import { GIT_FOLDER_STATUS, GIT_SUMMARY_BADGES, type GitSummaryKey } from "../tree/git-status";
import type { FileTreeActions, TreeNode } from "../tree/types";
import {
  basename,
  dirname,
  findNode,
  insertTemp,
  joinRelativePath,
  movableIntoDir,
} from "../tree/tree-utils";
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
  Loader2,
  FolderOpen,
  GitBranch,
  Folders,
  Code,
  ListChevronsDownUp,
} from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { cn, extractErrorMessage } from "@/lib/utils";
import {
  isContextMenuKey,
  openContextMenuFromKeyboard,
  useFocusTarget,
} from "../../../lib/keyboard";

type FileNavigationAction =
  | "reveal"
  | "editor"
  | "new-file"
  | "new-folder"
  | "refresh"
  | "collapse";
type FileNavigationItem =
  | { type: "action"; action: FileNavigationAction }
  | { type: "tree"; id: string };

function fileNavigationItemKey(item: FileNavigationItem) {
  return item.type === "action" ? `action:${item.action}` : `tree:${item.id}`;
}

/** Drop exact relative paths (and their subtrees) from a fetched tree. */
function filterHiddenPaths(nodes: TreeNode[], hidden: Set<string>): TreeNode[] {
  if (hidden.size === 0) return nodes;
  return nodes
    .filter((node) => !hidden.has(node.id))
    .map((node) =>
      node.children ? { ...node, children: filterHiddenPaths(node.children, hidden) } : node,
    );
}

export interface FilePanelProps {
  projectId: string;
  previewFileId: string | null;
  onPreviewFile: (file: string) => void;
  /** Overrides the project cwd (used by virtual projects: assistant workspace / task outputs). */
  cwd?: string;
  /**
   * External refresh trigger. Increment to re-read the tree without remounting,
   * e.g. when an automation task finishes and its output directory changes.
   */
  refreshToken?: number;
  /**
   * Persist the expanded folders into the global project store. Virtual projects
   * that are created per page/run (task outputs) should pass false to avoid
   * unbounded growth of `projectStates`.
   */
  persistOpenFolders?: boolean;
  /** Empty-state text override (e.g. automation's "No files generated"). */
  emptyHint?: string;
  /** Hide “Add to Chat” in the tree context menu when the host page has no chat. */
  showAddToChat?: boolean;
  /**
   * Exact relative paths to omit from the tree (e.g. automation's `task.json`
   * metadata). Hidden entries are neither rendered nor keyboard/selection targets.
   */
  hiddenPaths?: string[];
}

export const FilePanel = memo(function FilePanel({
  projectId,
  previewFileId,
  onPreviewFile,
  cwd: cwdOverride,
  refreshToken,
  persistOpenFolders = true,
  emptyHint,
  showAddToChat = true,
  hiddenPaths = [],
}: FilePanelProps) {
  const { t } = useTranslation();
  // Keep the latest hidden list without re-creating load/refresh callbacks.
  const hiddenPathsRef = useRef<Set<string>>(new Set(hiddenPaths));
  // eslint-disable-next-line react/refs
  hiddenPathsRef.current = new Set(hiddenPaths);
  const treeRef = useRef<HTMLDivElement>(null);
  const treeItemRefs = useRef(new Map<string, HTMLDivElement>());
  const navigationActionRefs = useRef(new Map<FileNavigationAction, HTMLElement>());
  const lastFocusedActionRef = useRef<FileNavigationAction | null>(null);
  const focusedTreeItemIdRef = useRef<string | null>(null);
  const pendingFocusIdRef = useRef<string | null>(null);
  const pendingFocusRestoreRef = useRef(false);
  const [data, setData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!loading) {
      // eslint-disable-next-line react/set-state-in-effect
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), 500);
    return () => clearTimeout(timer);
  }, [loading]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    const ps = useAppStore.getState().projectStates.get(projectId);
    return new Set(ps?.openFolders ?? []);
  });
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
  // 相邻行之间移动时先不立刻清空高亮，避免 drop 反馈出现一帧闪烁
  const dropTargetClearTimerRef = useRef<number | null>(null);
  const projects = useAppStore((s) => s.projects);
  const { confirm, toast } = useMessage();

  const activeProjectId = projectId;
  const projectCwd = useMemo(() => {
    return projects.find((p) => p.id === projectId)?.cwd ?? "";
  }, [projectId, projects]);
  const cwd = cwdOverride ?? projectCwd;

  useEffect(() => {
    refreshSeqRef.current += 1;
    // eslint-disable-next-line react/set-state-in-effect
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setEditingId(null);
    setGitStatus(null);
    setData([]);
  }, [cwd]);

  // When switching to a different project, restore openFolders from the store
  // instead of clearing them, so per-project expansion state is preserved
  // across session switches.
  useEffect(() => {
    const ps = useAppStore.getState().projectStates.get(projectId);
    const restored = new Set(ps?.openFolders ?? []);
    // eslint-disable-next-line react/set-state-in-effect
    setOpenFolders(restored);
    openFoldersRef.current = restored;
  }, [projectId]);

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

        return filterHiddenPaths(updateNodes(nextData), hiddenPathsRef.current);
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
    // eslint-disable-next-line react/set-state-in-effect
    refresh();
  }, [refresh]);

  // External refresh trigger: run once per token change, not on mount (the
  // effect above already performs the initial load).
  const refreshTokenRef = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken === undefined || refreshTokenRef.current === refreshToken) return;
    refreshTokenRef.current = refreshToken;
    refresh();
  }, [refresh, refreshToken]);

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

            return filterHiddenPaths(updateNodes(nextData), hiddenPathsRef.current);
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

  const flattenTree = useCallback(
    (nodes: TreeNode[]): string[] => {
      const result: string[] = [];
      for (const node of nodes) {
        result.push(node.id);
        if (node.isFolder && openFolders.has(node.id) && node.children) {
          // eslint-disable-next-line react/immutability
          result.push(...flattenTree(node.children));
        }
      }
      return result;
    },
    [openFolders],
  );

  const registerTreeItemRef = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) {
      treeItemRefs.current.set(id, element);
    } else {
      treeItemRefs.current.delete(id);
    }
  }, []);

  const registerNavigationActionRef = useCallback(
    (action: FileNavigationAction, element: HTMLElement | null) => {
      if (element) {
        navigationActionRefs.current.set(action, element);
      } else {
        navigationActionRefs.current.delete(action);
      }
    },
    [],
  );

  const handleTreeItemFocus = useCallback((id: string) => {
    focusedTreeItemIdRef.current = id;
  }, []);

  const focusTreeItem = useCallback(
    (id: string) => {
      let element = treeItemRefs.current.get(id);
      if (!element) {
        const visibleIds = flattenTree(data);
        const itemIndex = visibleIds.indexOf(id);
        if (itemIndex !== -1) {
          // 收起目录的行仍挂载（为了保留收起动画），但被包在 inert 容器里，
          // 不能参与索引，否则焦点会落到错误的行上。
          element = Array.from(
            treeRef.current?.querySelectorAll<HTMLDivElement>('[role="treeitem"]') ?? [],
          ).filter((candidate) => !candidate.closest("[inert]"))[itemIndex];
        }
      }
      if (!element) return;
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "nearest" });
    },
    [data, flattenTree],
  );

  const fileNavigationItems = useMemo<FileNavigationItem[]>(() => {
    const items: FileNavigationItem[] = [];
    if (!isWebUI && cwd) {
      items.push({ type: "action", action: "reveal" });
      items.push({ type: "action", action: "editor" });
    }
    if (!loading) {
      items.push(
        { type: "action", action: "new-file" },
        { type: "action", action: "new-folder" },
        { type: "action", action: "refresh" },
        { type: "action", action: "collapse" },
      );
    }
    items.push(...flattenTree(data).map((id): FileNavigationItem => ({ type: "tree", id })));
    return items;
  }, [cwd, data, flattenTree, loading]);

  const fileActionItems = useMemo(
    () =>
      fileNavigationItems.filter(
        (item): item is Extract<FileNavigationItem, { type: "action" }> => item.type === "action",
      ),
    [fileNavigationItems],
  );
  const treeNavigationItems = useMemo(
    () =>
      fileNavigationItems.filter(
        (item): item is Extract<FileNavigationItem, { type: "tree" }> => item.type === "tree",
      ),
    [fileNavigationItems],
  );

  const focusFileNavigationItem = useCallback(
    (item: FileNavigationItem) => {
      if (item.type === "action") {
        const element = navigationActionRefs.current.get(item.action);
        if (!element) return;
        element.focus({ preventScroll: true });
        return;
      }
      focusTreeItem(item.id);
    },
    [focusTreeItem],
  );

  const handleFileNavigationKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLElement>,
      items: FileNavigationItem[],
      item: FileNavigationItem,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (items.length === 0) return;

      const currentIndex = items.findIndex(
        (navigationItem) => fileNavigationItemKey(navigationItem) === fileNavigationItemKey(item),
      );
      const nextIndex = Math.max(
        0,
        Math.min(
          items.length - 1,
          currentIndex + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1),
        ),
      );
      const nextItem = items[nextIndex];
      if (nextItem) focusFileNavigationItem(nextItem);
    },
    [focusFileNavigationItem],
  );

  const focusFileTree = useCallback(() => {
    const visibleIds = flattenTree(data);
    const targetId =
      (lastSelectedId && visibleIds.includes(lastSelectedId) && lastSelectedId) ||
      visibleIds.find((id) => selectedIds.has(id)) ||
      visibleIds[0];

    if (targetId) {
      focusTreeItem(targetId);
    } else if (fileActionItems[0]) {
      focusFileNavigationItem(fileActionItems[0]);
    }
  }, [
    data,
    fileActionItems,
    flattenTree,
    focusFileNavigationItem,
    focusTreeItem,
    lastSelectedId,
    selectedIds,
  ]);

  useFocusTarget("file-tree-content", focusFileTree);

  useEffect(() => {
    if (!pendingFocusRestoreRef.current || loading) return;

    const visibleIds = flattenTree(data);
    const pendingId = pendingFocusIdRef.current;
    const targetId = pendingId && visibleIds.includes(pendingId) ? pendingId : visibleIds[0];
    const fallbackAction = fileActionItems[0];
    pendingFocusRestoreRef.current = false;
    pendingFocusIdRef.current = null;

    window.requestAnimationFrame(() => {
      if (targetId) {
        focusTreeItem(targetId);
      } else if (fallbackAction) {
        focusFileNavigationItem(fallbackAction);
      }
    });
  }, [data, fileActionItems, flattenTree, focusFileNavigationItem, focusTreeItem, loading]);

  // Sync openFolders to ProjectState whenever it changes, so folder expansion
  // state persists across session switches within the same project.
  useEffect(() => {
    if (!persistOpenFolders) return;
    useAppStore.getState().updateProjectState(projectId, () => ({
      openFolders: Array.from(openFolders),
    }));
  }, [openFolders, persistOpenFolders, projectId]);

  const toggle = useCallback(
    (node: TreeNode) => {
      const id = node.id;
      setOpenFolders((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          // Also collapse all descendants
          const prefix = id + "/";
          for (const key of prev) {
            if (key.startsWith(prefix)) next.delete(key);
          }
        } else {
          next.add(id);
        }
        openFoldersRef.current = next;
        return next;
      });

      if (node.isFolder && activeProjectId) {
        request
          .readDir({ projectId: activeProjectId, relativePath: id })
          .then((children) => {
            setData((oldData) => {
              function updateTree(tree: TreeNode[]): TreeNode[] {
                return tree.map((n) => {
                  if (n.id === id)
                    return {
                      ...n,
                      children: filterHiddenPaths(children ?? [], hiddenPathsRef.current),
                    };
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
    [activeProjectId],
  );

  const handleTreeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, node: TreeNode) => {
      const { key } = event;
      const isVerticalNavigationKey = key === "ArrowUp" || key === "ArrowDown";

      if (isVerticalNavigationKey) {
        const treeItem = { type: "tree", id: node.id } as const;
        const currentIndex = treeNavigationItems.findIndex((item) => item.id === node.id);
        if (key === "ArrowUp" && currentIndex === 0) {
          const actionItem =
            fileActionItems.find((item) => item.action === lastFocusedActionRef.current) ??
            fileActionItems[0];
          if (actionItem) {
            event.preventDefault();
            event.stopPropagation();
            focusFileNavigationItem(actionItem);
            return;
          }
        }
        handleFileNavigationKeyDown(event, treeNavigationItems, treeItem);
        return;
      }

      if (isContextMenuKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        openContextMenuFromKeyboard(event.currentTarget);
        return;
      }

      if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();

        if (key === "ArrowRight" && node.isFolder) {
          if (!openFolders.has(node.id)) {
            toggle(node);
          } else {
            const firstChild = node.children?.[0];
            if (firstChild) focusTreeItem(firstChild.id);
          }
        } else if (key === "ArrowLeft") {
          if (node.isFolder && openFolders.has(node.id)) {
            toggle(node);
          } else {
            const parentId = node.id.slice(0, node.id.lastIndexOf("/"));
            if (parentId) focusTreeItem(parentId);
          }
        }
        return;
      }

      if (key === "Enter" || key === " " || key === "Spacebar") {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIds(new Set([node.id]));
        setLastSelectedId(node.id);
        if (node.isFolder) {
          toggle(node);
        } else {
          onPreviewFile(node.id);
        }
      }
    },
    [
      fileActionItems,
      focusFileNavigationItem,
      focusTreeItem,
      handleFileNavigationKeyDown,
      onPreviewFile,
      openFolders,
      toggle,
      treeNavigationItems,
    ],
  );

  const collapseAll = useCallback(() => {
    setOpenFolders(new Set());
    openFoldersRef.current = new Set();
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
        toast.error(extractErrorMessage(err) || t("filePanel.createFailed", "Failed to create."));
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
          toast.error(extractErrorMessage(err) || t("filePanel.renameFailed", "Failed to rename."));
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
      ignored: false,
      children: isFolder ? [] : undefined,
    };
    if (parentId) {
      setOpenFolders((prev) => {
        const next = new Set(prev).add(parentId);
        openFoldersRef.current = next;
        return next;
      });
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
                  if (n.id === parentId)
                    return {
                      ...n,
                      children: [
                        tempNode,
                        ...filterHiddenPaths(children ?? [], hiddenPathsRef.current),
                      ],
                    };
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

  const prepareFocusAfterDelete = (ids: string[]) => {
    const isDeletedId = (id: string) =>
      ids.some((deletedId) => id === deletedId || id.startsWith(`${deletedId}/`));
    const referenceId =
      (focusedTreeItemIdRef.current && isDeletedId(focusedTreeItemIdRef.current)
        ? focusedTreeItemIdRef.current
        : null) ??
      (lastSelectedId && isDeletedId(lastSelectedId) ? lastSelectedId : null) ??
      ids.find(isDeletedId);

    if (!referenceId) return;

    const visibleIds = flattenTree(data);
    const referenceIndex = visibleIds.indexOf(referenceId);
    const targetId =
      (referenceIndex !== -1
        ? visibleIds.slice(referenceIndex + 1).find((id) => !isDeletedId(id))
        : undefined) ??
      (referenceIndex !== -1
        ? [...visibleIds.slice(0, referenceIndex)].reverse().find((id) => !isDeletedId(id))
        : undefined) ??
      visibleIds.find((id) => !isDeletedId(id));

    pendingFocusIdRef.current = targetId ?? null;
    pendingFocusRestoreRef.current = true;
  };

  const deleteNode = async (ids: string[]) => {
    if (ids.length === 0 || !activeProjectId) return;

    await confirm({
      title: t("filePanel.delete"),
      content:
        ids.length === 1
          ? t("filePanel.deleteConfirmSingle", { name: ids[0].split("/").pop() })
          : t("filePanel.deleteConfirmMultiple", { count: ids.length }),
      buttons: [
        { text: t("filePanel.cancel"), value: null, variant: "outline" },
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
            prepareFocusAfterDelete(ids);
            setSelectedIds(new Set());
            setLastSelectedId(null);
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
            prepareFocusAfterDelete(ids);
            setSelectedIds(new Set());
            setLastSelectedId(null);
            refresh();
            return "deleted";
          },
        },
      ],
    });
  };

  const isExternalDrag = useCallback(
    (e: React.DragEvent) => {
      return e.dataTransfer.types.includes("Files") && dragIds.length === 0;
    },
    [dragIds],
  );

  const cancelDropTargetClear = useCallback(() => {
    if (dropTargetClearTimerRef.current !== null) {
      window.clearTimeout(dropTargetClearTimerRef.current);
      dropTargetClearTimerRef.current = null;
    }
  }, []);

  const clearDropTarget = useCallback(() => {
    cancelDropTargetClear();
    setDropTargetId(null);
  }, [cancelDropTargetClear]);

  // 参考 VS Code（listView 的 dragleave 延迟清理）：离开某一行时延迟一小段时间再清空高亮，
  // 期间落到相邻行会直接取消这次清空，避免在行与行之间滑动时闪烁。
  const scheduleDropTargetClear = useCallback(() => {
    cancelDropTargetClear();
    dropTargetClearTimerRef.current = window.setTimeout(() => {
      dropTargetClearTimerRef.current = null;
      setDropTargetId(null);
    }, 50);
  }, [cancelDropTargetClear]);

  useEffect(() => () => cancelDropTargetClear(), [cancelDropTargetClear]);

  // 参考 VS Code 的落点解析：文件夹行落到自身，文件行落到其父目录，
  // 目录展开后的可见子块整体都算该目录的落点。只有真的能移动时才接受放置。
  const updateDropTarget = useCallback(
    (e: React.DragEvent, destDir: string) => {
      cancelDropTargetClear();
      const external = isExternalDrag(e);
      if (!external && movableIntoDir(dragIds, destDir).length === 0) {
        // 不接受放置：不阻止默认行为，浏览器会显示禁止光标
        setDropTargetId(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = external ? "copy" : "move";
      setDropTargetId(destDir || ROOT_DROP_TARGET);
    },
    [cancelDropTargetClear, dragIds, isExternalDrag],
  );

  const handleStartDrag = useCallback(
    (id: string, e: React.DragEvent) => {
      const ids = selectedIds.has(id) && selectedIds.size > 1 ? [...selectedIds] : [id];
      setDragIds(ids);
      e.dataTransfer.effectAllowed = "copyMove";

      const nodesPayloads = ids.map((nodeId) => {
        let isFolder = false;
        for (const root of data) {
          const found = findNode(root, nodeId);
          if (found) {
            isFolder = found.isFolder;
            break;
          }
        }
        // Use full relative path as name for proper display in chat mentions
        return { id: nodeId, name: nodeId, isFolder };
      });

      e.dataTransfer.setData("application/x-fello-tree-nodes", JSON.stringify(nodesPayloads));

      // 同时写入标准 text/uri-list 格式，允许拖到外部应用（Finder 等）使用
      const fileUris = nodesPayloads
        .filter((p) => !p.isFolder)
        .map((p) => {
          const absPath = cwd ? `${cwd.replace(/\/?$/, "/")}${p.id}` : p.id;
          return `file://${absPath}`;
        })
        .join("\n");
      if (fileUris) {
        e.dataTransfer.setData("text/uri-list", fileUris);
      }

      const downloadablePayload = nodesPayloads.find((p) => !p.isFolder);
      if (downloadablePayload) {
        // DownloadURL needs just the filename (basename), not the full path
        const fileName = downloadablePayload.id.split("/").pop() ?? "unknown";
        const fileUrl = `file://${downloadablePayload.id}`;
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
    [selectedIds, data, t, cwd],
  );

  const readFileAsBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] ?? "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

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
          // Importing a folder may merge into an existing directory.
          allowExistingFolder: true,
        });
        const reader = dirEntry.createReader();
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        for (const child of entries) {
          // eslint-disable-next-line react/immutability
          await processEntry(child, subDir);
        }
      }
    },
    [readFileAsBase64, activeProjectId],
  );

  const handleExternalDrop = useCallback(
    async (e: React.DragEvent, destDir: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetId(null);
      if (!activeProjectId) return;

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

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
          toast.error(
            extractErrorMessage(err) || t("filePanel.dropFailed", "Failed to import files."),
          );
        }
        refresh();
        return;
      }

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
        toast.error(
          extractErrorMessage(err) || t("filePanel.dropFailed", "Failed to import files."),
        );
      }
      refresh();
    },
    [refresh, processEntry, readFileAsBase64, activeProjectId, t, toast],
  );

  // destDir 为空串表示项目根目录
  const handleDropTo = useCallback(
    async (e: React.DragEvent, destDir: string) => {
      e.preventDefault();
      e.stopPropagation();
      clearDropTarget();

      if (isExternalDrag(e)) {
        await handleExternalDrop(e, destDir);
        return;
      }

      if (dragIds.length === 0 || !activeProjectId) return;
      const validIds = movableIntoDir(dragIds, destDir);
      if (validIds.length === 0) {
        setDragIds([]);
        return;
      }

      const destName = basename(destDir);
      const result = await confirm({
        title: t("filePanel.moveConfirmTitle"),
        content:
          destDir === ""
            ? validIds.length === 1
              ? t("filePanel.moveConfirmSingleToRoot", { name: basename(validIds[0]) })
              : t("filePanel.moveConfirmMultipleToRoot", { count: validIds.length })
            : validIds.length === 1
              ? t("filePanel.moveConfirmSingle", { name: basename(validIds[0]), dest: destName })
              : t("filePanel.moveConfirmMultiple", { count: validIds.length, dest: destName }),
      });
      if (!result) {
        setDragIds([]);
        return;
      }

      try {
        await Promise.all(
          validIds.map((id) =>
            request.moveFile({
              projectId: activeProjectId,
              oldRelativePath: id,
              newRelativePath: joinRelativePath(destDir, basename(id)),
            }),
          ),
        );
      } catch (err) {
        console.error("Move failed:", extractErrorMessage(err));
        toast.error(extractErrorMessage(err) || t("filePanel.moveFailed", "Failed to move."));
      }
      setDragIds([]);
      refresh();
    },
    [
      dragIds,
      refresh,
      isExternalDrag,
      handleExternalDrop,
      activeProjectId,
      confirm,
      t,
      toast,
      clearDropTarget,
    ],
  );

  const clearSelectionOnBlankClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) clearSelection();
    },
    [clearSelection],
  );

  const revealInFinder = useCallback(async (path: string) => {
    if (isWebUI) return;
    try {
      await electron.revealInFinder(path);
    } catch (err) {
      console.error("revealInFinder failed:", extractErrorMessage(err));
    }
  }, []);

  const actions: FileTreeActions = {
    select: handleSelect,
    toggle,
    startRename,
    createIn,
    deleteNode,
    startDrag: handleStartDrag,
    dragOver: (e, id, isFolder) => updateDropTarget(e, isFolder ? id : dirname(id)),
    dragLeave: scheduleDropTargetClear,
    drop: (e, id, isFolder) => handleDropTo(e, isFolder ? id : dirname(id)),
    dragEnd: () => {
      setDragIds([]);
      clearDropTarget();
    },
    revealInFinder: async (id: string) => {
      if (!activeProjectId || isWebUI) return;
      const absPath = await request.getSystemFilePath({
        projectId: activeProjectId,
        path: id,
        isAbsolute: true,
      });
      electron.revealInFinder(absPath);
    },
    openInEditor: async (id: string) => {
      if (!activeProjectId || isWebUI) return;
      const absPath = await request.getSystemFilePath({
        projectId: activeProjectId,
        path: id,
        isAbsolute: true,
      });
      const editorName = useAppStore.getState().editor.name;
      electron.openInEditor(absPath, editorName);
    },
    previewFile: (id: string) => {
      onPreviewFile(id);
    },
    copyPath: async (id: string, isAbsolute: boolean) => {
      if (!activeProjectId) return;
      const ids = selectedIds.has(id) && selectedIds.size > 1 ? [...selectedIds] : [id];
      const paths = await Promise.all(
        ids.map((nodeId) =>
          request.getSystemFilePath({
            projectId: activeProjectId,
            path: nodeId,
            isAbsolute,
          }),
        ),
      );
      await copyText(paths.join("\n"));
    },
    addToChat: (id: string) => {
      const ids = selectedIds.has(id) && selectedIds.size > 1 ? [...selectedIds] : [id];
      const nodesPayloads = ids.map((nodeId) => {
        let isFolder = false;
        for (const root of data) {
          const found = findNode(root, nodeId);
          if (found) {
            isFolder = found.isFolder;
            break;
          }
        }
        // Use full relative path as name for proper display in chat mentions
        return { id: nodeId, name: nodeId, isFolder };
      });
      document.dispatchEvent(new CustomEvent("fello-add-to-chat", { detail: nodesPayloads }));
    },
    refresh,
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
            <div className="ml-2 mr-1 flex shrink-0 gap-1.5 text-[10px] font-normal">
              {GIT_SUMMARY_BADGES.map(({ key, color }) =>
                counts[key] > 0 ? (
                  <span key={key} className={cn(color, "font-medium")}>
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

                  let slashIdx = relPath.lastIndexOf("/");
                  if (slashIdx > 0 && slashIdx === relPath.length - 1) {
                    slashIdx = relPath.slice(0, slashIdx).lastIndexOf("/");
                  }
                  const folderPath = slashIdx !== -1 ? relPath.slice(0, slashIdx) : "";
                  const name = slashIdx !== -1 ? relPath.slice(slashIdx + 1) : relPath;

                  return (
                    <DropdownMenuItem
                      key={relPath}
                      onClick={() => {
                        if (!activeProjectId) return;
                        onPreviewFile(relPath);
                      }}
                    >
                      <div className="flex w-full items-center gap-2">
                        <span
                          className={cn("truncate text-sx font-normal", statusColor)}
                          title={name}
                        >
                          {name}
                        </span>
                        <span
                          className="truncate flex-1 text-sx text-muted-foreground/50"
                          title={folderPath ?? undefined}
                        >
                          {folderPath ?? ""}
                        </span>
                        <span
                          className={cn(
                            "ml-2 shrink-0 text-[10px] font-medium tracking-tighter",
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
  }, [gitStatus, activeProjectId, onPreviewFile]);

  const getSelectedFolder = (): string | null => {
    if (selectedIds.size !== 1) return null;
    const id = [...selectedIds][0];
    for (const n of data) {
      const found = findNode(n, id);
      if (found?.isFolder) return found.id;
    }
    return null;
  };

  const handleFileActionKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
    action: FileNavigationAction,
  ) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      handleFileNavigationKeyDown(event, fileActionItems, { type: "action", action });
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      const firstTreeItem = treeNavigationItems[0];
      if (firstTreeItem) focusFileNavigationItem(firstTreeItem);
      return;
    }

    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
    event.stopPropagation();

    switch (action) {
      case "reveal":
        if (cwd) void revealInFinder(cwd);
        break;
      case "editor":
        if (cwd) {
          const editorName = useAppStore.getState().editor.name;
          void electron.openInEditor(cwd, editorName).catch((err) => {
            console.error("openInEditor failed:", extractErrorMessage(err));
          });
        }
        break;
      case "new-file":
        createIn(getSelectedFolder(), false);
        break;
      case "new-folder":
        createIn(getSelectedFolder(), true);
        break;
      case "refresh":
        refresh();
        break;
      case "collapse":
        collapseAll();
        break;
    }
  };

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t("filePanel.noProject", "No project selected")}
      </div>
    );
  }

  if (showLoading && data.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <div className="size-10 rounded-full bg-muted flex items-center justify-center mb-3">
          <Loader2 className="size-5 text-muted-foreground/60 animate-spin" />
        </div>
        <p className="text-xs text-muted-foreground/70">{t("filePanel.loading")}</p>
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
    showAddToChat,
    onKeyDown: handleTreeKeyDown,
    registerRef: registerTreeItemRef,
    onFocus: handleTreeItemFocus,
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-xs w-full">
      {/* Header */}
      <div className="flex h-10 items-center gap-0.5 border-b border-border">
        <div className="flex text-muted-foreground items-center gap-1 px-3">
          <Folders className="size-3.5" />
          <span className="text-xs font-medium text-nowrap">{t("filePanel.title")}</span>
        </div>
        <div className="ml-auto mr-2 flex items-center gap-0.5">
          {!isWebUI && (
            <>
              <Button
                ref={(element) => registerNavigationActionRef("reveal", element)}
                variant="ghost"
                size="icon"
                tabIndex={-1}
                className="size-6 text-muted-foreground hover:text-foreground"
                disabled={!cwd}
                onKeyDown={(event) => handleFileActionKeyDown(event, "reveal")}
                onFocus={() => {
                  lastFocusedActionRef.current = "reveal";
                }}
                onClick={() => revealInFinder(cwd)}
                title={t("filePanel.revealInFinder")}
              >
                <FolderOpen className="size-3.5" />
              </Button>
              <Button
                ref={(element) => registerNavigationActionRef("editor", element)}
                variant="ghost"
                size="icon"
                tabIndex={-1}
                className="size-6 text-muted-foreground hover:text-foreground"
                disabled={!cwd}
                onKeyDown={(event) => handleFileActionKeyDown(event, "editor")}
                onFocus={() => {
                  lastFocusedActionRef.current = "editor";
                }}
                onClick={() => {
                  if (!cwd) return;
                  const editorName = useAppStore.getState().editor.name;
                  void electron.openInEditor(cwd, editorName).catch((err) => {
                    console.error("openInEditor failed:", extractErrorMessage(err));
                  });
                }}
                title={t("filePanel.openInEditor", {
                  editor: EDITOR_LABELS[useAppStore.getState().editor.name] ?? "Editor",
                })}
              >
                <Code className="size-3.5" />
              </Button>
            </>
          )}
          <Button
            ref={(element) => registerNavigationActionRef("new-file", element)}
            variant="ghost"
            size="icon"
            tabIndex={-1}
            className="size-6 text-muted-foreground hover:text-foreground"
            disabled={loading}
            onKeyDown={(event) => handleFileActionKeyDown(event, "new-file")}
            onFocus={() => {
              lastFocusedActionRef.current = "new-file";
            }}
            onClick={() => createIn(getSelectedFolder(), false)}
            title={t("filePanel.newFile")}
          >
            <FilePlus className="size-3.5" />
          </Button>
          <Button
            ref={(element) => registerNavigationActionRef("new-folder", element)}
            variant="ghost"
            size="icon"
            tabIndex={-1}
            className="size-6 text-muted-foreground hover:text-foreground"
            disabled={loading}
            onKeyDown={(event) => handleFileActionKeyDown(event, "new-folder")}
            onFocus={() => {
              lastFocusedActionRef.current = "new-folder";
            }}
            onClick={() => createIn(getSelectedFolder(), true)}
            title={t("filePanel.newFolder")}
          >
            <FolderPlus className="size-3.5" />
          </Button>
          <Button
            ref={(element) => registerNavigationActionRef("refresh", element)}
            variant="ghost"
            size="icon"
            tabIndex={-1}
            className="size-6 text-muted-foreground hover:text-foreground"
            disabled={loading}
            onKeyDown={(event) => handleFileActionKeyDown(event, "refresh")}
            onFocus={() => {
              lastFocusedActionRef.current = "refresh";
            }}
            onClick={refresh}
            title={t("filePanel.refresh", "Refresh")}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            ref={(element) => registerNavigationActionRef("collapse", element)}
            variant="ghost"
            size="icon"
            tabIndex={-1}
            className="size-6 text-muted-foreground hover:text-foreground"
            disabled={loading}
            onKeyDown={(event) => handleFileActionKeyDown(event, "collapse")}
            onFocus={() => {
              lastFocusedActionRef.current = "collapse";
            }}
            onClick={collapseAll}
            title={t("filePanel.collapseFolders")}
          >
            <ListChevronsDownUp className="size-3.5" />
          </Button>
        </div>
      </div>

      {data.length === 0 ? (
        <div
          className="flex-1 flex flex-col items-center justify-center text-muted-foreground"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => void handleExternalDrop(e, "")}
        >
          <div className="size-10 rounded-full bg-muted flex items-center justify-center mb-3 -mt-10">
            <Folders className="size-5 text-muted-foreground/60" />
          </div>
          <p className="text-xs text-muted-foreground/70">
            {emptyHint ?? t("filePanel.emptyDirectory")}
          </p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1 px-1">
          <ContextMenu>
            {/* 全区域高亮单独画一层绝对定位的框：垂直 inset-y-1（4px）、水平 inset-x-1（再叠加
                ScrollArea 的 px-1，实际离面板左右各 8px），上下留白小于左右，且不影响行布局 */}
            <ContextMenuTrigger
              render={<div className="relative flex min-h-full flex-col py-1" />}
              onDragLeave={scheduleDropTargetClear}
            >
              <FileTree
                nodes={data}
                treeRef={treeRef}
                previewId={previewFileId}
                onBlankClick={clearSelectionOnBlankClick}
                onBlankDragOver={(e) => updateDropTarget(e, "")}
                onBlankDrop={(e) => void handleDropTo(e, "")}
                {...sharedProps}
              />
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
              <ContextMenuItem onClick={refresh}>
                <RefreshCw />
                {t("filePanel.refresh", "Refresh")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              {!isWebUI && (
                <>
                  <ContextMenuItem onClick={() => revealInFinder(cwd ?? "")}>
                    <FolderOpen />
                    {t("filePanel.revealInFinder")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      if (!cwd) return;
                      const editorName = useAppStore.getState().editor.name;
                      void electron.openInEditor(cwd, editorName).catch((err) => {
                        console.error("openInEditor failed:", extractErrorMessage(err));
                      });
                    }}
                  >
                    <Code />
                    {t("filePanel.openInEditor", {
                      editor: EDITOR_LABELS[useAppStore.getState().editor.name] ?? "Editor",
                    })}
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        </ScrollArea>
      )}

      {gitSummary}
    </div>
  );
});
