import { memo, useMemo } from "react";
import type { UserMessage } from "../../chat-message";
import { electron } from "../../electron";
import { isWebUI } from "../../backend";
import { ABSOLUTE_PATH_REGEX } from "@/lib/regexp";

interface Props {
  message: UserMessage;
  prevBubbleRole?: string;
  nextBubbleRole?: string;
}

interface PathLinkProps {
  path: string;
  children: React.ReactNode;
}

const PathLink = memo(function PathLink({ path, children }: PathLinkProps) {
  if (isWebUI) {
    return (
      <span className="rounded bg-secondary/50 mx-1 px-1 text-muted-foreground ring-1 ring-border">
        #{children}
      </span>
    );
  }

  return (
    <button
      type="button"
      title={`Reveal in Finder: ${path}`}
      className="cursor-pointer rounded bg-secondary/50 mx-1 px-1 text-muted-foreground ring-1 ring-border"
      onClick={(e) => {
        e.preventDefault();
        electron.revealInFinder(path);
      }}
    >
      #{children}
    </button>
  );
});

export const UserBubble = memo(function UserBubble({ message, prevBubbleRole }: Props) {
  const contentNodes = useMemo(() => {
    if (!message.contents || message.contents.length === 0) return null;

    return message.contents.map((block, blockIndex) => {
      if (block.type === "text") {
        const text = block.text;
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;

        const matches = [...text.matchAll(ABSOLUTE_PATH_REGEX)];
        const validMatches = matches.filter((m) => m[0].length >= 3 && m[0] !== "/");

        for (const match of validMatches) {
          const index = match.index!;
          const path = match[0];

          if (index > lastIndex) {
            parts.push(
              <span key={`text-${lastIndex}`}>{text.slice(lastIndex, index)}</span>,
            );
          }

          const fileName = path.split(/[/\\]/).pop() || path;
          parts.push(
            <PathLink key={`path-${index}`} path={path}>
              {fileName}
            </PathLink>,
          );

          lastIndex = index + path.length;
        }

        if (lastIndex < text.length) {
          parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>);
        }

        return (
          <span key={blockIndex}>
            {parts.length > 0 ? parts : <>{text}</>}
          </span>
        );
      }

      if (block.type === "image") {
        return (
          <div key={blockIndex} className="text-sm italic text-muted-foreground my-2">
            [Image block]
          </div>
        );
      }

      if (block.type === "resource") {
        return (
          <div key={blockIndex} className="text-sm italic text-muted-foreground my-2">
            [Resource block]
          </div>
        );
      }

      return null;
    });
  }, [message.contents]);

  return (
    <div className="px-4 flex flex-col">
      {prevBubbleRole != null && <div className="my-14 h-px bg-border" />}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl border border-border bg-secondary px-4 py-3 text-[13px] leading-relaxed font-normal text-card-foreground/75">
          <p className="whitespace-pre-wrap wrap-break-word font-normal">{contentNodes}</p>
        </div>
      </div>
    </div>
  );
});
