import { webUIBaseUrl, isWebUI } from "../backend";

/**
 * 根据当前环境将 pathname 解析为完整 URL。
 *
 * - WebUI 模式: http://host/<pathname>
 * - Electron 模式: fello://web/<pathname>
 *
 * @param pathname 以 / 开头的路径（如 /project/xxx 或 /share/xxx）
 */
export function resolveFileUrl(pathname: string): string {
  if (isWebUI && webUIBaseUrl) return `${webUIBaseUrl}${pathname}`;
  return `fello://web${pathname}`;
}
