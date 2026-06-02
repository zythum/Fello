import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { SessionInfo } from "../../../shared/schema";
import type { ChatMessage } from "../../lib/chat-message";
import { TextBlock } from "./text-block";
import { ImageBlock } from "./image-block";
import { AudioBlock } from "./audio-block";
import { ResourceBlock } from "./resource-block";
import { ResourceLinkBlock } from "./resource-link-block";
import { UnsupportedBlock } from "./unsupported-block";

interface Props {
  blocks: ContentBlock[];
  role: ChatMessage["role"];
  session?: SessionInfo;
  isStreaming?: boolean;
}

export function ContentBlocks({ blocks, role, session, isStreaming }: Props) {
  if (!blocks || blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        const blockIsStreaming = isLast && isStreaming;
        // 优先使用 _meta.display_id（消息级稳定 ID）+ index 后缀得到唯一 key；
        // 流式追加时同一 block 的 display_id + index 组合保持不变。
        // 没有 _meta 时回退到 index。
        const blockKey =
          typeof block._meta?.display_id === "string"
            ? `${block._meta.display_id}-${index}`
            : index;

        switch (block.type) {
          case "text":
            return (
              <TextBlock
                key={blockKey}
                block={block}
                role={role}
                session={session}
                isStreaming={blockIsStreaming}
              />
            );

          case "image":
            return (
              <ImageBlock
                key={blockKey}
                block={block}
                role={role}
                session={session}
                isStreaming={blockIsStreaming}
              />
            );

          case "audio":
            return (
              <AudioBlock
                key={blockKey}
                block={block}
                role={role}
                session={session}
                isStreaming={blockIsStreaming}
              />
            );

          case "resource":
            return (
              <ResourceBlock
                key={blockKey}
                block={block}
                role={role}
                session={session}
                isStreaming={blockIsStreaming}
              />
            );

          case "resource_link":
            return (
              <ResourceLinkBlock
                key={blockKey}
                block={block}
                role={role}
                session={session}
                isStreaming={blockIsStreaming}
              />
            );

          default:
            // 其他未知类型
            return (
              <UnsupportedBlock
                key={blockKey}
                block={block}
                role={role}
                session={session}
                isStreaming={blockIsStreaming}
              />
            );
        }
      })}
    </div>
  );
}
