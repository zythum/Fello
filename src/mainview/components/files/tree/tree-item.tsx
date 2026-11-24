import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Pencil,
  Trash2,
  FolderOpen,
  Copy,
  MessageSquarePlus,
  Code,
  Eye,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { EDITOR_LABELS } from "../../../../shared/constants";
import { isWebUI } from "../../../backend";
import { useAppStore } from "../../../store";
import { cn } from "@/lib/utils";
import { FileIcon } from "../../common/file-icon";
import { resolveGitRowBadge } from "./git-status";
import type { FileTreeRowProps, TreeNode } from "./types";

export interface TreeItemProps extends FileTreeRowProps {
  node: TreeNode;
  depth: number;
}

/**
 * 文件树的一行：图标、名称（含内联重命名）、git 标记与右键菜单。
 *
 * 点击 / 键盘 / 拖拽都只调用 `actions`；真正的选中、展开、重命名提交与文件操作
 * 由 FilePanel 负责（见 `components/files/panel/file-panel.tsx`）。
 */
export function TreeItem({
  node,
  depth,
  previewId,
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
  showAddToChat = true,
  onKeyDown,
  registerRef,
  onFocus,
}: TreeItemProps) {
  const { t } = useTranslation();
  const isOpen = openFolders.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const isEditing = editingId === node.id;
  // 目标文件夹展开后的整个区域（名称行 + 所有可见子行）作为一块整体高亮，
  // 与 VS Code 的 drop feedback（feedback 覆盖整个可见子树）一致。
  const isDropTargetBlock = node.isFolder && dropTargetId === node.id;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) setTimeout(() => inputRef.current?.focus(), 0);
  }, [isEditing]);

  const handleView = (e: ReactMouseEvent) => {
    if (node.isFolder) {
      actions.toggle(node);
      actions.select(node.id, e);
    } else {
      actions.previewFile(node.id);
      actions.select(node.id, e);
    }
  };

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
    showAddToChat,
    onKeyDown,
    registerRef,
    onFocus,
  };

  const status = gitStatusMap.get(node.id);
  const { text: statusText, color: statusColor } = status
    ? resolveGitRowBadge(status)
    : { text: "", color: "" };

  return (
    <div
      className={cn(
        "rounded-md",
        isDropTargetBlock && "bg-primary/5 inset-ring-1 inset-ring-primary",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              ref={(element) => registerRef(node.id, element)}
              tabIndex={-1}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={node.isFolder ? isOpen : undefined}
              aria-selected={isSelected}
              className="outline-0 focus-visible:inset-ring-1 focus-visible:inset-ring-ring/80 rounded-md"
              onKeyDown={(e) => {
                if (e.target === e.currentTarget) onKeyDown(e, node);
              }}
              onFocus={() => onFocus(node.id)}
            />
          }
          draggable={!isEditing}
          onDragStart={(e) => {
            e.stopPropagation();
            actions.startDrag(node.id, e);
          }}
          onDragOver={(e) => actions.dragOver(e, node.id, node.isFolder)}
          onDragLeave={actions.dragLeave}
          onDrop={(e) => {
            e.stopPropagation();
            actions.drop(e, node.id, node.isFolder);
          }}
          onDragEnd={actions.dragEnd}
          onContextMenu={(e) => {
            e.stopPropagation();
            if (!selectedIds.has(node.id)) {
              actions.select(node.id, e);
            }
          }}
          className={cn(
            "flex h-6 cursor-default select-none items-center gap-1.5 px-1.5 text-sx leading-none text-foreground/60",
            node.id === previewId
              ? "bg-primary/8 hover:bg-primary/10"
              : "hover:bg-primary/5 hover:text-foreground",
            isSelected ? "text-foreground bg-primary/6" : "",
          )}
          style={{ paddingLeft: `${depth * 16 + 6}px` }}
          onClick={(e) => {
            e.stopPropagation();
            if (e.metaKey) {
              actions.select(node.id, e);
              return;
            }
            handleView(e);
          }}
        >
          {node.isFolder ? (
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground scale-110 transition-transform",
                isOpen && "rotate-90",
                node.ignored && "opacity-50",
              )}
            />
          ) : (
            <FileIcon
              name={node.name}
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/90",
                node.ignored && "opacity-50",
              )}
            />
          )}
          {isEditing ? (
            <input
              ref={inputRef}
              value={editingValue}
              onChange={(e) => onEditChange(e.target.value)}
              onBlur={onEditSubmit}
              onKeyDown={(e) => {
                // 输入法组合中（如拼音 / 假名候选未上屏）不处理：此时 Enter 是候选上屏、
                // Escape 是取消候选，直接用它们结束编辑会丢掉正在输入的内容。
                if (e.nativeEvent.isComposing) return;
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
                  node.ignored && "opacity-50",
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
          <ContextMenuItem onClick={handleView}>
            <Eye />
            {t("filePanel.view")}
          </ContextMenuItem>
          <ContextMenuSeparator />
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
              <ContextMenuItem onClick={() => actions.refresh()}>
                <RefreshCw />
                {t("filePanel.refresh", "Refresh")}
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
              <ContextMenuItem onClick={() => actions.refresh()}>
                <RefreshCw />
                {t("filePanel.refresh", "Refresh")}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {showAddToChat && (
            <>
              <ContextMenuItem
                onClick={() => {
                  actions.addToChat(node.id);
                }}
              >
                <MessageSquarePlus />
                {t("filePanel.addToChat")}
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
          {!isWebUI && (
            <ContextMenuItem
              onClick={() => {
                actions.openInEditor(node.id);
              }}
            >
              <Code />
              {t("filePanel.openInEditor", {
                editor: EDITOR_LABELS[useAppStore.getState().editor.name] ?? "Editor",
              })}
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
      {node.isFolder && (
        // 0fr → 1fr 的 grid 轨道过渡，与侧栏项目一致。子节点是异步 readDir 拿到的，
        // 所以 1fr 的条件是「已展开且 children 就绪」：数据到位那一刻才开始展开动画，
        // 否则内容会在容器已经是 1fr 之后突然出现，没有过渡。
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out",
            isOpen && node.children ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
          inert={!isOpen}
        >
          <div className="min-h-0 overflow-hidden">
            {node.children?.map((child) => (
              <TreeItem
                key={child.id}
                node={child}
                previewId={previewId}
                depth={depth + 1}
                {...childProps}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
