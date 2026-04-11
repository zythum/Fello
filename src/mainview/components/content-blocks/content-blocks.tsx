import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { SessionInfo } from "../../../shared/schema";
import { TextBlock } from "./text-block";
import { ImageBlock } from "./image-block";
import { AudioBlock } from "./audio-block";
import { ResourceBlock } from "./resource-block";
import { ResourceLinkBlock } from "./resource-link-block";
import { UnsupportedBlock } from "./unsupported-block";

interface Props {
  blocks: ContentBlock[];
  session?: SessionInfo;
  streaming?: boolean;
}

export function ContentBlocks({ blocks, session, streaming }: Props) {
  if (!blocks || blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        const isStreaming = isLast && streaming;

        switch (block.type) {
          case "text":
            return (
              <TextBlock key={index} block={block} session={session} isStreaming={isStreaming} />
            );

          case "image":
            return (
              <ImageBlock key={index} block={block} session={session} isStreaming={isStreaming} />
            );

          case "audio":
            return (
              <AudioBlock key={index} block={block} session={session} isStreaming={isStreaming} />
            );

          case "resource":
            return (
              <ResourceBlock
                key={index}
                block={block}
                session={session}
                isStreaming={isStreaming}
              />
            );

          case "resource_link":
            return (
              <ResourceLinkBlock
                key={index}
                block={block}
                session={session}
                isStreaming={isStreaming}
              />
            );

          default:
            // 其他未知类型
            return (
              <UnsupportedBlock
                key={index}
                block={block}
                session={session}
                isStreaming={isStreaming}
              />
            );
        }
      })}
    </div>
  );
}
