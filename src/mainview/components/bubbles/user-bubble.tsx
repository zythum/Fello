import { memo, useMemo } from "react";
import type { ChatMessage } from "../../store";
import { request } from "../../backend";
import { ABSOLUTE_PATH_REGEX } from "@/lib/regexp";

interface Props {
  message: ChatMessage;
  prevBubbleRole?: ChatMessage["role"];
  nextBubbleRole?: ChatMessage["role"];
}

interface PathLinkProps {
  path: string;
  children: React.ReactNode;
}

const PathLink = memo(function PathLink({ path, children }: PathLinkProps) {
  return (
    <button
      type="button"
      title={`Reveal in Finder: ${path}`}
      className="cursor-pointer rounded bg-secondary/50 mx-1 px-1 text-muted-foreground ring-1 ring-border"
      onClick={(e) => {
        e.preventDefault();
        request.revealInFinder(path);
      }}
    >
      #{children}
    </button>
  );
});

export const UserBubble = memo(function UserBubble({ message, prevBubbleRole }: Props) {
  const contentNodes = useMemo(() => {
    if (!message.content) return null;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    const matches = [...message.content.matchAll(ABSOLUTE_PATH_REGEX)];
    const validMatches = matches.filter((m) => m[0].length >= 3 && m[0] !== "/");

    for (const match of validMatches) {
      const index = match.index!;
      const path = match[0];

      if (index > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>{message.content.slice(lastIndex, index)}</span>,
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

    if (lastIndex < message.content.length) {
      parts.push(<span key={`text-${lastIndex}`}>{message.content.slice(lastIndex)}</span>);
    }

    return parts.length > 0 ? parts : <>{message.content}</>;
  }, [message.content]);

  return (
    <div className="px-4 flex flex-col">
      {prevBubbleRole != null && <div className="my-14 h-px bg-border" />}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md border border-border bg-secondary px-4 py-3 text-[13px] leading-relaxed font-normal text-card-foreground/75">
          <p className="whitespace-pre-wrap wrap-break-word font-normal">{contentNodes}</p>
        </div>
      </div>
    </div>
  );
});
