import type { Feature } from "./schema";

/** 支持预览的图片 MIME 类型 */
export const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/avif",
]);

export function isImageMimeType(mimeType?: string): boolean {
  return !!mimeType && IMAGE_MIME_TYPES.has(mimeType);
}

/** 所有可用的 feature 列表，也作为默认值 */
export const ALL_FEATURES: Feature[] = ["search", "skills", "ask_user", "share_to_user", "memory"];

/** feature → i18n key 映射 */
export const FEATURE_I18N_KEYS: Record<Feature, string> = {
  search: "constant.feature.search",
  skills: "constant.feature.skills",
  ask_user: "constant.feature.askUser",
  share_to_user: "constant.feature.shareToUser",
  memory: "constant.feature.memory",
};

/** launch-editor 支持的值到显示名称的映射 */
export const EDITOR_LABELS: Record<string, string> = {
  code: "VS Code",
  "code-insiders": "VS Code Insiders",
  codium: "VSCodium",
  cursor: "Cursor",
  zed: "Zed",
  atom: "Atom",
  sublime: "Sublime Text",
  idea: "IntelliJ IDEA",
  webstorm: "WebStorm",
  pycharm: "PyCharm",
  phpstorm: "PhpStorm",
  rubymine: "RubyMine",
  clion: "CLion",
  rider: "Rider",
  appcode: "AppCode",
  visualstudio: "Visual Studio",
  emacs: "Emacs",
  vim: "Vim",
  "notepad++": "Notepad++",
  brackets: "Brackets",
};
