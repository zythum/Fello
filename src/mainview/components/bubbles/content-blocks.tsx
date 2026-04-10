import { ContentBlock } from "@agentclientprotocol/sdk";
import { StreamMarkdown } from "./stream-markdown";

interface Props {
  blocks: ContentBlock[];
  streaming?: boolean;
}

export function ContentBlocks({ blocks, streaming }: Props) {
  if (!blocks || blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        const isStreaming = isLast && streaming;

        switch (block.type) {
          case "text":
            return (
              <StreamMarkdown key={index} streaming={isStreaming}>
                {block.text}
              </StreamMarkdown>
            );

          case "image":
            // TODO: 未来在此适配图片渲染
            return (
              <div key={index} className="text-sm italic text-muted-foreground">
                [Image block]
              </div>
            );

          case "resource":
            // TODO: 未来在此适配资源渲染
            return (
              <div key={index} className="text-sm italic text-muted-foreground">
                [Resource block]
              </div>
            );

          default:
            // 其他未知类型
            return null;
        }
      })}
    </div>
  );
}
