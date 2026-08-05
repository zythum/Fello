import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileIcon } from "../../../common/file-icon";
import { getFileKind } from "./file-types";
import { parseFileReference } from "../../../common/file-reference";
import { CodeDetail } from "./code-detail/code-detail";
import { MarkdownDetail } from "./markdown-detail/markdown-detail";
import { ImageDetail } from "./image-detail/image-detail";
import { PdfDetail } from "./pdf-detail/pdf-detail";
import { DocxDetail } from "./docx-detail/docx-detail";
import { PptxDetail } from "./pptx-detail/pptx-detail";
import { XlsxDetail } from "./xlsx-detail/xlsx-detail";
import { HtmlDetail } from "./html-detail/html-detail";
import { ConversationDetail } from "./conversation-detail/conversation-detail";
import { FileText, FolderOpen } from "lucide-react";

interface FileDetailProps {
  scheduleId: string;
  taskId: string;
  fileName: string | null;
  hasTask: boolean;
  hasFiles: boolean;
  onCopyPath?: (file: string) => void;
  onCopyAbsolutePath?: (file: string) => void;
  onRevealInFinder?: (file: string) => void;
}

export function FileDetail({
  scheduleId,
  taskId,
  fileName,
  hasTask,
  hasFiles,
  onCopyPath,
  onCopyAbsolutePath,
  onRevealInFinder,
}: FileDetailProps) {
  const { t } = useTranslation();
  const fileKind = useMemo(() => getFileKind(fileName), [fileName]);

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

  const filePath = parseFileReference(fileName).path;
  const contextProps = {
    scheduleId,
    taskId,
    fileName,
    onCopyPath: onCopyPath ? () => onCopyPath(filePath) : undefined,
    onCopyAbsolutePath: onCopyAbsolutePath ? () => onCopyAbsolutePath(filePath) : undefined,
    onRevealInFinder: onRevealInFinder ? () => onRevealInFinder(filePath) : undefined,
  };

  return (
    <div className="flex flex-col w-full h-full min-w-0 relative overflow-hidden">
      {/* Header */}
      <div className="h-10 shrink-0 border-b border-border flex items-center justify-between gap-2 px-2 bg-background">
        <div className="flex items-center min-w-0 flex-1">
          <div className="min-w-0 flex items-center gap-1.5">
            <FileIcon name={filePath} className="size-4 shrink-0 text-muted-foreground/80" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs truncate leading-tight text-foreground/60">{filePath}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {fileKind === "conversation" ? (
          <ConversationDetail {...contextProps} />
        ) : fileKind === "image" ? (
          <ImageDetail {...contextProps} />
        ) : fileKind === "markdown" ? (
          <MarkdownDetail {...contextProps} />
        ) : fileKind === "html" ? (
          <HtmlDetail {...contextProps} />
        ) : fileKind === "pdf" ? (
          <PdfDetail {...contextProps} />
        ) : fileKind === "docx" ? (
          <DocxDetail {...contextProps} />
        ) : fileKind === "pptx" ? (
          <PptxDetail {...contextProps} />
        ) : fileKind === "xlsx" ? (
          <XlsxDetail {...contextProps} />
        ) : (
          <CodeDetail {...contextProps} />
        )}
      </div>
    </div>
  );
}
