import { memo } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import type { SessionInfo } from "../../../shared/schema";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { ChatMessage } from "../../lib/chat-message";

interface UnsupportedBlockProps {
  block?: ContentBlock;
  role: ChatMessage["role"];
  type?: string;
  session?: SessionInfo;
  isStreaming?: boolean;
}

export const UnsupportedBlock = memo(function UnsupportedBlock({
  block,
  role: _role,
  type,
  session: _session,
  isStreaming: _isStreaming,
}: UnsupportedBlockProps) {
  const { t } = useTranslation();
  const displayType = type || block?.type || "unknown";
  return (
    <div className="flex items-center gap-2 p-2 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="text-xs font-medium">
        {t("contentBlock.unsupported", {
          type: displayType,
          defaultValue: `Unsupported block type: ${displayType}`,
        })}
      </span>
    </div>
  );
});
