export type FileKind = "image" | "markdown" | "text" | "pdf" | "docx" | "pptx" | "xlsx" | "html";

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

export function getFileKind(filename: string | null): FileKind | null {
  if (!filename) return null;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (ext in FILE_EXT_MAP) return FILE_EXT_MAP[ext]!;
  if (ext === "md") return "markdown";
  return "text";
}
