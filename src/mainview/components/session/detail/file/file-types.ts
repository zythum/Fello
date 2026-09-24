import { parseFileReference } from "../../../common/file-reference";
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "../../../../../shared/constants";

export type FileKind =
  | "image"
  | "markdown"
  | "text"
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "html"
  | "audio"
  | "video";

export interface FileDetailProps {
  projectId: string | null;
  file: string | null;
  onClose?: () => void;
}

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"];

const FILE_EXT_MAP: Record<string, FileKind> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
  xls: "xlsx",
  html: "html",
  htm: "html",
};

/** 根据文件扩展名判断 fileKind */
export function getFileKind(filename: string | null): FileKind | null {
  if (!filename) return null;
  const { path } = parseFileReference(filename);
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (ext in FILE_EXT_MAP) return FILE_EXT_MAP[ext]!;
  if (ext === "md") return "markdown";
  return "text";
}
