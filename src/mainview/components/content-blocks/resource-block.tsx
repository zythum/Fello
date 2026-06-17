import { memo } from "react";
import { FileText, FileCode } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getBasename } from "../../lib/utils";
import { StreamMarkdown } from "../common/stream-markdown";
import { SessionInfo } from "../../../shared/schema";
import type {
  EmbeddedResource,
  TextResourceContents,
  BlobResourceContents,
} from "@agentclientprotocol/sdk";
import type { ChatMessage } from "../../lib/chat-message";

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
  return (
    <Card className="group shadow-none">
      <Collapsible>
        <CollapsibleTrigger
          render={<div />}
          nativeButton={false}
          className="flex h-8 items-center gap-1 py-1 px-2 hover:bg-muted/50 select-none"
        >
          <FileText className="size-3.5 text-blue-400 shrink-0" />
          <span className="text-xs font-medium min-w-40 truncate flex-1">
            {getBasename(resource.uri)}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="p-2 border-t border-border bg-muted/20">
          <StreamMarkdown>{resource.text}</StreamMarkdown>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
});

const BlobResourceBlock = memo(function BlobResourceBlock({
  resource,
}: {
  resource: BlobResourceContents;
}) {
  return (
    <Card className="flex items-center gap-3 p-0 shadow-none">
      <FileCode className="h-6 w-6 text-purple-400 shrink-0" />
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-xs font-medium truncate">{getBasename(resource.uri)}</span>
        {resource.mimeType && (
          <span className="text-[10px] text-muted-foreground truncate">{resource.mimeType}</span>
        )}
      </div>
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
  return (
    <Card className="flex items-center gap-3 p-2 shadow-none">
      <FileCode className="h-6 w-6 text-purple-400 shrink-0" />
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-xs font-medium truncate">{getBasename(uri)}</span>
        {mimeType && <span className="text-[10px] text-muted-foreground truncate">{mimeType}</span>}
      </div>
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
