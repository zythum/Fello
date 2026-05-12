import { useTranslation } from "react-i18next";
import { FilePreview } from "./file-preview";
import { TerminalDetail } from "./terminal-detail";

export type DetailType = "file" | "terminal";

interface DetailViewProps {
  detailType: DetailType | null;
  projectId: string | null;
  file: string | null;
  terminalId: string | null;
  onClose: () => void;
}

export function DetailView({ detailType, projectId, file, terminalId, onClose }: DetailViewProps) {
  const { t } = useTranslation();

  if (!detailType) return null;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      {detailType === "file" && projectId && file && (
        <FilePreview projectId={projectId} file={file} onClose={onClose} />
      )}

      {detailType === "terminal" && projectId && terminalId && (
        <TerminalDetail terminalId={terminalId} projectId={projectId} onClose={onClose} />
      )}

      {(!detailType ||
        (detailType === "file" && (!projectId || !file)) ||
        (detailType === "terminal" && (!projectId || !terminalId))) && (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          <span>{t("detailView.noContent", "No content")}</span>
        </div>
      )}
    </div>
  );
}
