/**
 * 渲染层的平台探测（外设相关）。
 *
 * 只读 preload 暴露的 `window.fello` 上的平台标记；进程内不会变，所以这里同时导出
 * 一个模块级常量，调用方不必各自再求值一次。
 *
 * WebUI（无 preload）没有平台概念，统一按 `linux` 处理 —— 内置外设都不声明它，
 * 于是 `isPeripheralRuntimeAvailable` / `isPeripheralSupportedOnPlatform` 自然为假。
 */
export function getRendererPlatform(): string {
  const bridge = window.fello;
  if (!bridge) return "linux";
  if (bridge.isMacApp) return "darwin";
  if (bridge.isWinApp) return "win32";
  return "linux";
}

/** 进程内不会变：模块级求值一次即可。 */
export const RENDERER_PLATFORM = getRendererPlatform();
