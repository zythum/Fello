import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { downloadDataUrl, getBasename } from "../../lib/utils";
import { StreamMarkdown } from "../common/stream-markdown";
import { request } from "../../backend";
import { toast } from "sonner";
import { SessionInfo } from "../../../shared/schema";
import type {
  EmbeddedResource,
  TextResourceContents,
  BlobResourceContents,
} from "@agentclientprotocol/sdk";
import type { ChatMessage } from "../../chat-message";

interface ResourceBlockProps {
  block: EmbeddedResource;
  role: ChatMessage["role"];
  session?: SessionInfo;
  isStreaming?: boolean;
}

const TextResourceBlock = memo(function TextResourceBlock({
  resource,
}: {
  resource: TextResourceContents;
}) {
  const { t } = useTranslation();

  const handleDownload = async () => {
    const b64 = btoa(unescape(encodeURIComponent(resource.text)));
    downloadDataUrl(
      `data:${resource.mimeType || "text/plain"};base64,${b64}`,
      getBasename(resource.uri),
    );
  };

  return (
    <Card className="group overflow-hidden shadow-none">
      <details>
        <summary className="flex cursor-pointer items-center gap-2 p-2 hover:bg-muted/50 select-none">
          <FileText className="h-4 w-4 text-blue-400 shrink-0" />
          <span className="text-xs font-medium truncate flex-1">{getBasename(resource.uri)}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.preventDefault();
              handleDownload();
            }}
            title={t("contentBlock.download")}
          >
            <Download className="h-3 w-3" />
          </Button>
        </summary>
        <div className="p-2 border-t border-border bg-muted/20 text-xs">
          <StreamMarkdown>{resource.text}</StreamMarkdown>
        </div>
      </details>
    </Card>
  );
});

const BlobResourceBlock = memo(function BlobResourceBlock({
  resource,
}: {
  resource: BlobResourceContents;
}) {
  const { t } = useTranslation();

  const handleDownload = async () => {
    downloadDataUrl(
      `data:${resource.mimeType || "application/octet-stream"};base64,${resource.blob}`,
      getBasename(resource.uri),
    );
  };

  return (
    <Card className="flex items-center gap-3 p-0 shadow-none">
      <FileCode className="h-6 w-6 text-purple-400 shrink-0" />
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-xs font-medium truncate">{getBasename(resource.uri)}</span>
        {resource.mimeType && (
          <span className="text-[10px] text-muted-foreground truncate">{resource.mimeType}</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleDownload}
        title={t("contentBlock.download")}
      >
        <Download className="h-4 w-4" />
      </Button>
    </Card>
  );
});

const FallbackResourceBlock = memo(function FallbackResourceBlock({
  uri,
  mimeType,
}: {
  uri: string;
  mimeType?: string;
}) {
  const { t } = useTranslation();

  const handleDownload = async () => {
    try {
      const url = await request.readUrlAsDataUrl({
        url: uri,
        mimeType: mimeType,
      });
      downloadDataUrl(url, getBasename(uri));
    } catch (err) {
      const msg = (err as Error).message || String(err);
      if (msg.includes("exceeds 20MB")) {
        toast.error(t("contentBlock.fileTooLarge", "File is too large (exceeds 20MB)"));
      } else {
        console.error("Failed to read resource", err);
      }
    }
  };

  return (
    <Card className="flex items-center gap-3 p-2 shadow-none">
      <FileCode className="h-6 w-6 text-purple-400 shrink-0" />
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-xs font-medium truncate">{getBasename(uri)}</span>
        {mimeType && <span className="text-[10px] text-muted-foreground truncate">{mimeType}</span>}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleDownload}
        title={t("contentBlock.download")}
      >
        <Download className="h-4 w-4" />
      </Button>
    </Card>
  );
});

export const ResourceBlock = memo(function ResourceBlock({
  block,
  role: _role,
  session: _session,
  isStreaming: _isStreaming,
}: ResourceBlockProps) {
  const resource = block.resource;

  if ("text" in resource) {
    return <TextResourceBlock resource={resource} />;
  }

  if ("blob" in resource) {
    return <BlobResourceBlock resource={resource} />;
  }

  const fallbackResource = resource as unknown as { uri?: string; mimeType?: string };
  if (fallbackResource.uri) {
    return (
      <FallbackResourceBlock uri={fallbackResource.uri} mimeType={fallbackResource.mimeType} />
    );
  }

  return null;
});
