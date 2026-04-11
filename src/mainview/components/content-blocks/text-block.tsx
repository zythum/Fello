import { memo } from "react";
import type { TextContent } from "@agentclientprotocol/sdk";
import type { SessionInfo } from "../../../shared/schema";
import { StreamMarkdown } from "../common/stream-markdown";

interface TextBlockProps {
  block: TextContent;
  session?: SessionInfo;
  isStreaming?: boolean;
}

export const TextBlock = memo(function TextBlock({
  block,
  session: _session,
  isStreaming,
}: TextBlockProps) {
  return <StreamMarkdown streaming={isStreaming}>{block.text}</StreamMarkdown>;
});
