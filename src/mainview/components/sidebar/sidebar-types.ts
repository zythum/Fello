import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { SidebarNavigationItem } from "./sidebar-constants";

/**
 * 悬停卡片 / 右键菜单的共享状态。
 *
 * 个人助理区与项目区共用一个 hoverId 命名空间：任何一处打开右键菜单都会收起其它 hover 卡片。
 */
export type SidebarHoverState = {
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
  contextMenuId: string | null;
  setContextMenuId: (id: string | null) => void;
  /** 当前鼠标悬停的条目，用于右键菜单关闭后恢复 hover 卡片，避免闪现 */
  hoveredTriggerIdRef: RefObject<string | null>;
};

/**
 * 侧边栏键盘导航所需的 DOM 引用与按键处理。
 *
 * 个人助理区与项目区各自渲染行，但键盘顺序是全局的，因此引用表和按键处理都放在 Sidebar 里统一维护。
 */
export type SidebarNavigationBinding = {
  /** 各导航项 DOM 引用（键盘焦点定位用） */
  itemRefs: RefObject<Map<string, HTMLDivElement>>;
  /** 项目树滚动容器（焦点兜底查询用） */
  listRef: RefObject<HTMLDivElement | null>;
  /** 「添加项目」按钮（键盘导航用） */
  addProjectButtonRef: RefObject<HTMLButtonElement | null>;
  onItemKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>, item: SidebarNavigationItem) => void;
  onAddProjectKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
};
