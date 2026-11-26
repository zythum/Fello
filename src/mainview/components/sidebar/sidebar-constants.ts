/** HoverCard 展开态标识：项目用 p: 前缀，会话用 s: 前缀，避免命名空间碰撞 */
export function projectHoverId(id: string): string {
  return `p:${id}`;
}
export function sessionHoverId(id: string): string {
  return `s:${id}`;
}
export function assistantHoverId(assistantId: string): string {
  return `a:${assistantId}`;
}

/**
 * fello 文件树（file-panel）拖拽的私有 MIME 类型。
 * 拖入项目区添加项目时必须忽略它（它同时写 text/uri-list，否则会被误当成外部文件拖拽）。
 */
export const TREE_NODES_TYPE = "application/x-fello-tree-nodes";

export type SidebarNavigationItem =
  | { type: "assistant"; id: string }
  | { type: "project"; id: string }
  | { type: "session"; id: string; projectId: string };

export function sidebarNavigationItemKey(item: SidebarNavigationItem): string {
  if (item.type === "assistant") return `assistant:${item.id}`;
  return item.type === "project" ? `project:${item.id}` : `session:${item.id}`;
}
