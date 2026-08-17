import { request } from "../backend";
import type { SkillInfo, McpServerInfo } from "../../shared/schema";

export interface SearchFileItem {
  id: string;
  filename: string;
  isFolder: boolean;
}

export interface SuggestItem {
  id: string;
  display: string;
}

/** Max suggestions shown for skills / MCP in the @ mention autocomplete */
export const AT_SUGGESTION_MAX = 6;

/** Markup format used by react-mentions: @[display](id) */
export const MENTION_MARKUP = "@[__display__](__id__)";
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Replace all mention markup with the raw display text */
export function resolveMentions(value: string): string {
  return value.replace(MENTION_REGEX, (_match, display: string, _id: string) => display);
}

export function skillInfoToSuggestItem(s: SkillInfo): SuggestItem {
  return {
    id: s.id,
    display: `@skill:${s.name}`,
  };
}

export function mcpServerInfoToSuggestItem(m: McpServerInfo): SuggestItem {
  return {
    id: m.id,
    display: `@mcp:${m.id}`,
  };
}

/** 常见图片扩展名（用于决定 mention 的 #image: 前缀） */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;

export function isImagePath(p: string): boolean {
  return IMAGE_EXT_RE.test(p);
}

/** 统一优先级：文件夹 → #folder:，图片 → #image:，其余文件 → #file: */
export function searchFileItemToSuggestItem(f: SearchFileItem): SuggestItem {
  const display = f.isFolder
    ? `#folder:${f.filename}`
    : isImagePath(f.filename)
      ? `#image:${f.filename}`
      : `#file:${f.filename}`;
  return { id: f.id, display };
}

/**
 * 根据绝对路径生成 mention 标记。优先级与 # 补全列表统一：
 * 图片 → #image:file://绝对路径；项目外 → #resource:file://绝对路径；
 * 项目内 → #file:相对路径 / #folder:相对路径。
 * @param isImage 可显式指定（如拖拽 File 的 mime 判断），缺省时按扩展名判断
 */
export async function absPathToMention(
  absPath: string,
  projectId: string,
  projectCwd?: string,
  isImage?: boolean,
): Promise<string> {
  const fileUri = `file://${absPath.replace(/\\/g, "/")}`;
  // 图片优先：与 searchFileItemToSuggestItem 保持一致
  if (isImage ?? isImagePath(absPath)) {
    return `@[#image:${fileUri}](${fileUri})`;
  }
  // Project root itself or paths outside the project → treat as external resource
  if (
    projectCwd &&
    (absPath === projectCwd ||
      absPath === projectCwd.replace(/\/$/, "") ||
      !absPath.startsWith(projectCwd.replace(/\/?$/, "/")))
  ) {
    return `@[#resource:${fileUri}](${fileUri})`;
  }
  try {
    const relPath = await request.getSystemFilePath({
      projectId,
      path: absPath,
      isAbsolute: false,
    });
    const info = await request.getFileInfo({ projectId, relativePath: relPath });
    if (info) {
      const prefix = info.isFile ? "#file:" : "#folder:";
      return `@[${prefix}${relPath}](${absPath})`;
    }
  } catch {
    // not within project
  }
  return `@[#resource:${fileUri}](${fileUri})`;
}

/**
 * 在 textarea 光标处插入 mentions（#file: / #folder: / #resource: 标记）。
 * 空格规则与 fello-add-to-chat（source 加入）保持一致：
 * - 光标前已有内容且非空白 → 补 1 个前导空格
 * - 多个 mention 之间 1 个空格
 * - 末尾固定 1 个空格
 */
export function insertMentionsAtCursor(textarea: HTMLTextAreaElement, mentions: string[]): void {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const prefix = needsLeadingSpace ? " " : "";
  document.execCommand("insertText", false, `${prefix}${mentions.join(" ")} `);
}

/** 将文件树节点数组拼成 mention markup 文本 */
export function nodesToMentionText(
  nodes: { id: string; name: string; isFolder: boolean }[],
): string {
  return nodes
    .map((n) => {
      const prefix = n.isFolder ? "#folder:" : isImagePath(n.name) ? "#image:" : "#file:";
      return `@[${prefix}${n.name}](${n.id})`;
    })
    .join(" ");
}
