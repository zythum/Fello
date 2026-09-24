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

/** 可内嵌播放的音频扩展名（MIME 缺失或不规范时的兜底） */
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  "mp3",
  "wav",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "oga",
  "opus",
  "amr",
  "wma",
  "aiff",
  "aif",
  "caf",
]);

/** 可内嵌播放的视频扩展名（MIME 缺失或不规范时的兜底） */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
  "3gp",
]);

export type MediaKind = "audio" | "video";

/**
 * 判断文件能否用 `<audio>` / `<video>` 内嵌播放。
 *
 * 先看 MIME 前缀（覆盖 `audio/x-*`、`video/x-*` 这些变体），再按扩展名兜底 ——
 * `share_to_user` 的 mimeType 来自扩展名推测，认不出来的扩展名会直接缺失。
 */
export function getMediaKind(mimeType?: string, filename?: string): MediaKind | null {
  const mime = mimeType?.trim().toLowerCase();
  if (mime?.startsWith("audio/")) return "audio";
  if (mime?.startsWith("video/")) return "video";

  const ext = filename?.split(".").pop()?.trim().toLowerCase();
  if (!ext) return null;
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

/** 所有可用的 feature 列表，也作为默认值 */
export const ALL_FEATURES: Feature[] = [
  "skills",
  "search",
  "image_generation",
  "memory",
  "ask_user",
  "share_to_user",
];

/** feature → i18n key 映射 */
export const FEATURE_I18N_KEYS: Record<Feature, string> = {
  search: "constant.feature.search",
  skills: "constant.feature.skills",
  ask_user: "constant.feature.askUser",
  share_to_user: "constant.feature.shareToUser",
  memory: "constant.feature.memory",
  image_generation: "constant.feature.imageGeneration",
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
