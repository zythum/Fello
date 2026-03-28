import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";

const code = createCodePlugin({
  themes: ["github-light", "tokyo-night"],
});
import type { ChatMessage } from "../store";
import { Badge } from "@/components/ui/badge";
import {
  Check, X, User, Bot,
  FileText, Pencil, Trash2, Move, Search, Terminal, Brain, Globe, ArrowRightLeft, Wrench,
} from "lucide-react";

const kindIcons: Record<string, React.ReactNode> = {
  read: <FileText className="size-3 text-blue-400" />,
  edit: <Pencil className="size-3 text-yellow-400" />,
  delete: <Trash2 className="size-3 text-red-400" />,
  move: <Move className="size-3 text-orange-400" />,
  search: <Search className="size-3 text-purple-400" />,
  execute: <Terminal className="size-3 text-green-400" />,
  think: <Brain className="size-3 text-cyan-400" />,
  fetch: <Globe className="size-3 text-sky-400" />,
  switch_mode: <ArrowRightLeft className="size-3 text-pink-400" />,
  other: <Wrench className="size-3 text-muted-foreground" />,
};

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  if (message.role === "tool") {
    const status =
      message.toolStatus === "completed" || message.toolStatus === "failed"
        ? message.toolStatus
        : "completed";
    const kindIcon = message.toolKind ? kindIcons[message.toolKind] : null;

    return (
      <details className="rounded-md border border-border bg-card text-xs">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-muted-foreground hover:text-foreground">
          {status === "completed" ? (
            <Check className="size-3 text-green-400" />
          ) : (
            <X className="size-3 text-destructive" />
          )}
          {kindIcon}
          <span className="font-medium text-foreground">{message.toolTitle || "Tool"}</span>
          {message.toolKind && (
            <Badge variant="outline" className="text-[10px]">{message.toolKind}</Badge>
          )}
          <Badge variant="secondary" className="ml-auto text-[10px]">{status}</Badge>
        </summary>
        <div className="border-t border-border">
          {/* Locations */}
          {message.locations && message.locations.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 py-1.5 border-b border-border">
              {message.locations.map((loc, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <FileText className="size-2.5" />
                  {loc.path.split("/").pop()}{loc.line != null && `:${loc.line}`}
                </span>
              ))}
            </div>
          )}
          {/* Raw input */}
          {message.rawInput != null && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all px-3 py-2 text-muted-foreground">
              {typeof message.rawInput === "string"
                ? message.rawInput
                : JSON.stringify(message.rawInput, null, 2)}
            </pre>
          )}
          {/* Content */}
          {message.content && !message.rawInput && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all px-3 py-2 text-muted-foreground">
              {message.content.slice(0, 500)}
              {message.content.length > 500 && "..."}
            </pre>
          )}
        </div>
      </details>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="size-4 text-primary" />
        </div>
      )}
      <div
        className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "max-w-[85%] rounded-br-md bg-primary text-primary-foreground"
            : "w-full rounded-bl-md bg-card text-card-foreground"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none [&_pre]:rounded-lg [&_pre]:bg-muted [&_code]:text-primary">
            <Streamdown plugins={{ code }}>{message.content}</Streamdown>
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary">
          <User className="size-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}
