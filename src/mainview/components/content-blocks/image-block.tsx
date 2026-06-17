import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";

import { SessionInfo } from "../../../shared/schema";
import type { ImageContent } from "@agentclientprotocol/sdk";
import type { ChatMessage } from "../../lib/chat-message";

interface ImageBlockProps {
  block: ImageContent;
  role: ChatMessage["role"];
  session?: SessionInfo;
  isStreaming?: boolean;
}

export const ImageBlock = memo(function ImageBlock({
  block,
  role: _role,
  session: _session,
  isStreaming: _isStreaming,
}: ImageBlockProps) {
  const { t } = useTranslation();
  const data = block.data;
  const mimeType = block.mimeType ?? undefined;
  const uri = block.uri;

  const hasContent = !!data || !!uri;

  if (!hasContent) {
    return (
      <div className="text-sm italic text-muted-foreground">
        {t("contentBlock.invalidImage", "[Invalid Image block]")}
      </div>
    );
  }

  const src = data && mimeType ? `data:${mimeType};base64,${data}` : undefined;

  return (
    <Card className="relative group max-w-xs overflow-hidden shadow-none">
      {src ? (
        <img
          src={src}
          alt={t("contentBlock.imageAlt", "Agent provided image")}
          className="w-full h-auto object-contain"
        />
      ) : (
        <div className="p-4 flex items-center justify-center bg-muted/50">
          <span className="text-xs text-muted-foreground">
            {t("contentBlock.image", "Image:")} {uri}
          </span>
        </div>
      )}
    </Card>
  );
});
