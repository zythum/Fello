import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

/** 文件树节点：id 是相对项目根目录的 POSIX 路径，children 在展开时异步读取。 */
export interface TreeNode {
  id: string;
  name: string;
  isFolder: boolean;
  ignored: boolean;
  children?: TreeNode[];
}

/**
 * 文件树行可以触发的动作。
 *
 * 树的全部状态（选中 / 展开 / 重命名 / 拖拽）仍由 FilePanel 持有，
 * 这里只声明行组件可调用的入口，避免把文件系统请求与确认弹窗下沉到展示组件。
 */
export interface FileTreeActions {
  select: (id: string, e: ReactMouseEvent) => void;
  toggle: (node: TreeNode) => void;
  startRename: (node: TreeNode) => void;
  createIn: (parentId: string | null, isFolder: boolean) => void;
  deleteNode: (ids: string[]) => void;
  startDrag: (id: string, e: ReactDragEvent) => void;
  dragOver: (e: ReactDragEvent, id: string, isFolder: boolean) => void;
  dragLeave: () => void;
  drop: (e: ReactDragEvent, id: string, isFolder: boolean) => void;
  dragEnd: () => void;
  revealInFinder: (id: string) => void;
  openInEditor: (id: string) => void;
  previewFile: (id: string) => void;
  copyPath: (id: string, isAbsolute: boolean) => void;
  addToChat: (id: string) => void;
  refresh: () => void;
}

/** FileTree 透传给每一行的受控属性。 */
export interface FileTreeRowProps {
  previewId: string | null;
  selectedIds: Set<string>;
  openFolders: Set<string>;
  editingId: string | null;
  editingValue: string;
  dropTargetId: string | null;
  gitStatusMap: Map<string, string>;
  onEditChange: (value: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  actions: FileTreeActions;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>, node: TreeNode) => void;
  registerRef: (id: string, element: HTMLDivElement | null) => void;
  onFocus: (id: string) => void;
}
