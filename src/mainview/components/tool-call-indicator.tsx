import { Badge } from "@/components/ui/badge";
import {
  Loader2, Check, X,
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
  toolCalls: Map<
    string,
    {
      title: string;
      status: string;
      content: string;
      kind?: string | null;
      rawInput?: unknown;
      locations?: Array<{ path: string; line?: number | null }> | null;
    }
  >;
}

export function ToolCallIndicator({ toolCalls }: Props) {
  if (toolCalls.size === 0) return null;

  return (
    <div className="space-y-1">
      {Array.from(toolCalls.entries()).map(([id, tc]) => {
        const kindIcon = tc.kind ? kindIcons[tc.kind] : null;
        return (
          <details
            key={id}
            className="rounded-md border border-border bg-card text-xs"
            open={tc.status === "in_progress" || tc.status === "pending"}
          >
            <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-muted-foreground hover:text-foreground">
              {tc.status === "in_progress" || tc.status === "pending" ? (
                <Loader2 className="size-3 animate-spin text-primary" />
              ) : tc.status === "completed" ? (
                <Check className="size-3 text-green-400" />
              ) : (
                <X className="size-3 text-destructive" />
              )}
              {kindIcon}
              <span className="font-medium text-foreground">{tc.title}</span>
              {tc.kind && <Badge variant="outline" className="text-[10px]">{tc.kind}</Badge>}
              <Badge variant="secondary" className="ml-auto text-[10px]">{tc.status}</Badge>
            </summary>
            <div className="border-t border-border">
              {tc.locations && tc.locations.length > 0 && (
                <div className="flex flex-wrap gap-1 px-3 py-1.5 border-b border-border">
                  {tc.locations.map((loc, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <FileText className="size-2.5" />
                      {loc.path.split("/").pop()}{loc.line != null && `:${loc.line}`}
                    </span>
                  ))}
                </div>
              )}
              {tc.rawInput != null && (
                <pre className="overflow-x-auto whitespace-pre-wrap break-all px-3 py-2 text-muted-foreground">
                  {typeof tc.rawInput === "string"
                    ? tc.rawInput
                    : JSON.stringify(tc.rawInput, null, 2)}
                </pre>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
