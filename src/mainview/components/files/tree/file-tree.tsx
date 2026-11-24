import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { ROOT_DROP_TARGET } from "./constants";
import { TreeItem } from "./tree-item";
import type { FileTreeRowProps, TreeNode } from "./types";

export interface FileTreeProps extends FileTreeRowProps {
  nodes: TreeNode[];
  /** 由 FilePanel 持有：焦点兜底查询需要按可见行序号定位。 */
  treeRef: RefObject<HTMLDivElement | null>;
  /** 点击树内空白区域（清空选中）。 */
  onBlankClick: (event: ReactMouseEvent) => void;
  /** 树末尾空白区作为项目根目录的放置目标。 */
  onBlankDragOver: (event: ReactDragEvent) => void;
  onBlankDrop: (event: ReactDragEvent) => void;
}

/**
 * 文件树的展示层：`role="tree"` 行列表 + 根目录空白落点 + 根落点高亮。
 *
 * 这里不访问 store / backend：选中、展开、重命名、拖拽移动与文件操作都由 FilePanel
 * 通过 `FileTreeRowProps` / `actions` 注入，因此本组件可以独立复用到其它文件面板。
 */
export function FileTree({
  nodes,
  treeRef,
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
  showAddToChat,
  onKeyDown,
  registerRef,
  onFocus,
  onBlankClick,
  onBlankDragOver,
  onBlankDrop,
}: FileTreeProps) {
  const { t } = useTranslation();
  const rowProps: FileTreeRowProps = {
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
    showAddToChat,
    onKeyDown,
    registerRef,
    onFocus,
  };

  return (
    <>
      {/* 全区域高亮单独画一层绝对定位的框：垂直 inset-y-1（4px）、水平 inset-x-1
          （再叠加 ScrollArea 的 px-1，实际离面板左右各 8px），不影响行布局 */}
      {dropTargetId === ROOT_DROP_TARGET && (
        <div className="pointer-events-none absolute inset-x-0 inset-y-1 rounded-md bg-primary/5 inset-ring-1 inset-ring-primary" />
      )}
      <div
        ref={treeRef}
        role="tree"
        aria-label={t("filePanel.title", "Files")}
        onClick={onBlankClick}
      >
        {nodes.map((node) => (
          <TreeItem key={node.id} node={node} depth={0} {...rowProps} />
        ))}
      </div>
      {/* 树末尾的空白区：落到项目根目录的放置目标 */}
      <div
        className="min-h-6 flex-1 rounded-md"
        onClick={onBlankClick}
        onDragOver={onBlankDragOver}
        onDrop={onBlankDrop}
      />
    </>
  );
}
