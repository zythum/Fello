import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileIcon } from "../../../common/file-icon";
import { getFileKind } from "./file-types";
import { CodeDetail } from "./code-detail/code-detail";
import { MarkdownDetail } from "./markdown-detail/markdown-detail";
import { ImageDetail } from "./image-detail/image-detail";
import { PdfDetail } from "./pdf-detail/pdf-detail";
import { DocxDetail } from "./docx-detail/docx-detail";
import { PptxDetail } from "./pptx-detail/pptx-detail";
import { XlsxDetail } from "./xlsx-detail/xlsx-detail";
import { HtmlDetail } from "./html-detail/html-detail";
import { LoaderCircle, FileText, FolderOpen } from "lucide-react";

interface FileDetailProps {
  fileName: string | null;
  fileContent: string | null;
  fileLoading: boolean;
  hasTask: boolean;
  hasFiles: boolean;
}

/** 检查文件内容是否为二进制（含 null 字节或超过 30% 不可打印字符） */
function isBinaryContent(content: string): boolean {
  const len = Math.min(content.length, 512);
  let nullCount = 0;
  let nonPrintableCount = 0;
  for (let i = 0; i < len; i++) {
    const code = content.charCodeAt(i);
    if (code === 0) nullCount++;
    else if (code < 8 || (code > 13 && code < 32)) nonPrintableCount++;
  }
  return nullCount > 0 || nonPrintableCount > len * 0.3;
}

export function FileDetail({
  fileName,
  fileContent,
  fileLoading,
  hasTask,
  hasFiles,
}: FileDetailProps) {
  const { t } = useTranslation();
  const fileKind = useMemo(() => getFileKind(fileName), [fileName]);

  const isUnsupportedBinary = useMemo(() => {
    if (!fileContent || !fileName) return false;
    // Binary formats that have dedicated previewers are not "unsupported"
    if (
      fileKind === "image" ||
      fileKind === "pdf" ||
      fileKind === "docx" ||
      fileKind === "pptx" ||
      fileKind === "xlsx"
    )
      return false;
    return isBinaryContent(fileContent);
  }, [fileContent, fileName, fileKind]);

  if (!hasTask) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <FileText className="size-6 text-muted-foreground/60" />
        </div>
        <p className="text-xs">
          {t("automation.selectTaskToPreview", "Select a task to preview files")}
        </p>
      </div>
    );
  }

  if (!hasFiles) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <FolderOpen className="size-6 text-muted-foreground/60" />
        </div>
        <p className="text-xs">{t("automation.noFiles", "No files generated")}</p>
      </div>
    );
  }

  if (!fileName) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <FileText className="size-6 text-muted-foreground/60" />
        </div>
        <p className="text-xs">{t("automation.selectFileToPreview", "Select a file to preview")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-w-0 relative overflow-hidden">
      {/* Header */}
      <div className="h-10 shrink-0 border-b border-border flex items-center justify-between gap-2 px-2 bg-background">
        <div className="flex items-center min-w-0 flex-1">
          <div className="min-w-0 flex items-center gap-1.5">
            <FileIcon name={fileName} className="size-4 shrink-0 text-muted-foreground/80" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs truncate leading-tight text-foreground/60">{fileName}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {fileLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : isUnsupportedBinary ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {t("fileDetail.fileFormatNotSupported", "File format not supported for preview")}
          </div>
        ) : fileKind === "image" ? (
          <ImageDetail fileName={fileName} content={fileContent ?? ""} />
        ) : fileKind === "markdown" ? (
          <MarkdownDetail fileName={fileName} content={fileContent ?? ""} />
        ) : fileKind === "html" ? (
          <HtmlDetail fileName={fileName} content={fileContent ?? ""} />
        ) : fileKind === "pdf" ? (
          <PdfDetail fileName={fileName} content={fileContent ?? ""} />
        ) : fileKind === "docx" ? (
          <DocxDetail fileName={fileName} content={fileContent ?? ""} />
        ) : fileKind === "pptx" ? (
          <PptxDetail fileName={fileName} content={fileContent ?? ""} />
        ) : fileKind === "xlsx" ? (
          <XlsxDetail fileName={fileName} content={fileContent ?? ""} />
        ) : (
          <CodeDetail fileName={fileName} content={fileContent ?? ""} />
        )}
      </div>
    </div>
  );
}
