import { parseFileReference } from "../../../common/file-reference";

export type FileKind =
  | "image"
  | "markdown"
  | "text"
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "html"
  | "conversation";

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

/** File names that should be treated as conversation views */
const CONVERSATION_FILES = [".fello-conversation.json"];

export function getFileKind(filename: string | null): FileKind | null {
  if (!filename) return null;
  const { path } = parseFileReference(filename);
  const basename = path.split("/").pop() ?? path;
  if (CONVERSATION_FILES.includes(basename.toLowerCase())) return "conversation";
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (ext in FILE_EXT_MAP) return FILE_EXT_MAP[ext]!;
  if (ext === "md") return "markdown";
  return "text";
}
