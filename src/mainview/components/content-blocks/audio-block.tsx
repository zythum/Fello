import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { downloadDataUrl } from "../../lib/utils";
import { SessionInfo } from "../../../shared/schema";
import type { AudioContent } from "@agentclientprotocol/sdk";
import type { ChatMessage } from "../../chat-message";

interface AudioBlockProps {
  block: AudioContent;
  role: ChatMessage["role"];
  session?: SessionInfo;
  isStreaming?: boolean;
}

export const AudioBlock = memo(function AudioBlock({
  block,
  role: _role,
  session: _session,
  isStreaming: _isStreaming,
}: AudioBlockProps) {
  const { t } = useTranslation();
  const data = block.data;
  const mimeType = block.mimeType ?? undefined;

  const handleDownload = async () => {
    if (data && mimeType) {
      downloadDataUrl(`data:${mimeType};base64,${data}`, "audio");
    }
  };

  const hasContent = !!data;

  if (!hasContent) {
    return (
      <div className="text-sm italic text-muted-foreground">
        {t("contentBlock.invalidAudio", "[Invalid Audio block]")}
      </div>
    );
  }

  const src = data && mimeType ? `data:${mimeType};base64,${data}` : undefined;

  return (
    <Card className="flex items-center gap-2 p-0 shadow-none bg-muted/30">
      {src ? (
        <audio controls src={src} className="h-8 max-w-[200px]" />
      ) : (
        <span className="text-xs text-muted-foreground truncate flex-1">
          {t("contentBlock.audio", "Audio:")} {mimeType}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleDownload}
        title={t("contentBlock.download", "Download")}
      >
        <Download className="h-4 w-4" />
      </Button>
    </Card>
  );
});
