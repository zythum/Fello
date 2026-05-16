export type FileKind = "image" | "markdown" | "text" | "pdf" | "docx" | "pptx" | "xlsx";

export type ViewMode = "preview" | "code" | "compare";

export interface FileDetailProps {
  projectId: string | null;
  file: string | null;
  onClose?: () => void;
}

export const FILE_MODES_MAP: Record<FileKind, ViewMode[]> = {
  text: ["code", "compare"],
  markdown: ["preview", "code", "compare"],
  image: ["preview"],
  pdf: ["preview"],
  docx: ["preview"],
  pptx: ["preview"],
  xlsx: ["preview"],
};

export const IMAGE_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico",
];

export const OFFICE_EXTENSIONS: Record<string, FileKind> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
  xls: "xlsx",
};
