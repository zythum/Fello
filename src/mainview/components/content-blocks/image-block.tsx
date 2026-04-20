import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { downloadDataUrl, extractErrorMessage } from "../../lib/utils";
import { request } from "../../backend";

import { useMessage } from "../providers/message";

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
  const { toast } = useMessage();
  const data = block.data;
  const mimeType = block.mimeType ?? undefined;
  const uri = block.uri;

  const handleDownload = async () => {
    if (data && mimeType) {
      downloadDataUrl(`data:${mimeType};base64,${data}`, "image");
    } else if (uri) {
      try {
        const url = await request.readUrlAsDataUrl({ url: uri, mimeType });
        downloadDataUrl(url, "image");
      } catch (err) {
        const msg = extractErrorMessage(err);
        if (msg.includes("exceeds 20MB")) {
          toast.error(t("contentBlock.fileTooLarge", "File is too large (exceeds 20MB)"));
        } else {
          console.error("Failed to read image", err);
        }
      }
    }
  };

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
    <Card className="relative group max-w-xs overflow-hidden shadow-none p-0">
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
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="secondary"
          size="icon"
          className="h-6 w-6"
          onClick={handleDownload}
          title={t("contentBlock.download", "Download")}
        >
          <Download className="h-3 w-3" />
        </Button>
      </div>
    </Card>
  );
});
