import { useTranslation } from "react-i18next";
import { FileDetail } from "./file/file-detail";
import { TerminalDetail } from "./terminal/terminal-detail";
import { TokenUsageDetail } from "./token-usage/token-usage-detail";
import type { SessionInfo } from "../../../../shared/schema";

export type DetailType = "file" | "terminal" | "token-usage";

interface DetailProps {
  detailType: DetailType | null;
  projectId: string | null;
  file: string | null;
  terminalId: string | null;
  session: SessionInfo | null;
  onClose: () => void;
}

export function Detail({ detailType, projectId, file, terminalId, session, onClose }: DetailProps) {
  const { t } = useTranslation();

  if (!detailType) return null;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      {detailType === "file" && projectId && file && (
        <FileDetail projectId={projectId} file={file} onClose={onClose} />
      )}

      {detailType === "terminal" && projectId && terminalId && (
        <TerminalDetail
          key={terminalId}
          terminalId={terminalId}
          projectId={projectId}
          onClose={onClose}
        />
      )}

      {detailType === "token-usage" && session && (
        <TokenUsageDetail session={session} onClose={onClose} />
      )}

      {(!detailType ||
        (detailType === "file" && (!projectId || !file)) ||
        (detailType === "terminal" && (!projectId || !terminalId)) ||
        (detailType === "token-usage" && !session)) && (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          <span>{t("detail.noContent", "No content")}</span>
        </div>
      )}
    </div>
  );
}
