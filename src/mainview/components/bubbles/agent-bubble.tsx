import { memo } from "react";
import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import type { ChatMessage } from "../../store";
import { cn } from "@/lib/utils";
import { remarkFilePath } from "../../lib/remark-filepath";
import { PathLink } from "./path-link";

const code = createCodePlugin({
  themes: ["github-light", "github-dark"],
});

interface Props {
  message: ChatMessage;
  prevBubbleRole?: ChatMessage["role"];
  nextBubbleRole?: ChatMessage["role"];
}

export const AgentBubble = memo(function AssistantBubble({ message, prevBubbleRole }: Props) {
  if (!message.content) {
    return null;
  }
  return (
    <div
      className={cn(
        "w-full px-4 text-sm leading-7 font-normal text-foreground/75",
        prevBubbleRole != null && "mt-4",
      )}
    >
      <Streamdown
        className="max-w-none font-normal"
        plugins={{ code }}
        remarkPlugins={[remarkFilePath]}
        components={{
          a: ({ href, children, ...props }: any) => {
            if (href?.startsWith("reveal://")) {
              const path = href.slice(9);
              return <PathLink path={path}>{children}</PathLink>;
            }
            return (
              <a href={href} {...props}>
                {children}
              </a>
            );
          },
        }}
        shikiTheme={["github-light", "github-dark"]}
        isAnimating={message.streaming}
      >
        {message.content}
      </Streamdown>
    </div>
  );
});
