import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextCategory, ContextSnapshot } from "../../../../shared/schema";
import { chatMessageText, CONTEXT_CATEGORIES, formatTokens } from "./context-utils";
import { useSessionMessages } from "../../../lib/session-selectors";
import type { ChatMessage } from "../../../lib/chat-message";
import { StreamMarkdown } from "@/components/common/stream-markdown";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

interface ContextBrowserProps {
  snapshot: ContextSnapshot | null;
  sessionId: string;
}

interface BrowserItem {
  id: string;
  title?: string;
  content: string;
  kind: "text" | "tool";
  toolRows?: Array<{ name: string; type: string; description: string }>;
}

type ViewMode = "raw" | "md";

function parseParameters(schema: string): BrowserItem["toolRows"] {
  try {
    const parsed = JSON.parse(schema);
    const props = (parsed?.parameters ?? parsed)?.properties ?? {};
    return Object.entries(props).map(([name, p]) => ({
      name,
      type: String((p as { type?: unknown })?.type ?? "any"),
      description: String((p as { description?: unknown })?.description ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * 工具展示名：优先用快照里存的工具名（修复后为 map key，如 mcp_skills__list_skills）；
 * 旧快照里可能是 "unknown"（修复前生成），此时从 schema JSON 里解析 title 兜底。
 */
function toolDisplayName(tool: { name: string; schema: string }): string {
  if (tool.name && tool.name !== "unknown") return tool.name;
  try {
    const parsed = JSON.parse(tool.schema) as { title?: unknown };
    if (typeof parsed.title === "string" && parsed.title.trim()) {
      return parsed.title.trim();
    }
  } catch {
    // ignore malformed schema
  }
  return tool.name || "unknown";
}

function frontendMessageItems(
  messages: ChatMessage[] | null,
  match: (role: ChatMessage["role"]) => boolean,
): BrowserItem[] {
  if (!messages) return [];
  return messages
    .filter((m) => match(m.role))
    .map((m) => ({
      id: m.displayId,
      title: m.role,
      content: chatMessageText(m),
      kind: "text" as const,
    }));
}

/** 上下文浏览器：六类可折叠分区，下钻到真实内容，Raw | Markdown 切换 */
export function ContextBrowser({ snapshot, sessionId }: ContextBrowserProps) {
  const { t } = useTranslation();
  const messages = useSessionMessages(sessionId);
  const [expanded, setExpanded] = useState<Set<ContextCategory>>(
    () => new Set(["system", "user"] as ContextCategory[]),
  );
  const [viewByCategory, setViewByCategory] = useState<Partial<Record<ContextCategory, ViewMode>>>({});

  const sections = useMemo(() => {
    const content = snapshot?.content;
    const result: Array<{
      key: ContextCategory;
      tokenCount: number;
      items: BrowserItem[];
    }> = [];

    const push = (key: ContextCategory, items: BrowserItem[], tokenCount: number) => {
      result.push({ key, items, tokenCount });
    };

    // system
    const systemItems: BrowserItem[] = (content?.system ?? []).map((text, i) => ({
      id: `system-${i}`,
      content: text,
      kind: "text",
    }));
    push("system", systemItems, snapshot?.composition.system ?? 0);

    // tools
    const toolItems: BrowserItem[] = (content?.tools ?? []).map((tool, i) => ({
      id: `tool-${i}`,
      title: toolDisplayName(tool),
      content: tool.schema,
      kind: "tool",
      toolRows: parseParameters(tool.schema),
    }));
    push("tools", toolItems, snapshot?.composition.tools ?? 0);

    // user
    const userItems: BrowserItem[] =
      (content?.messages ?? [])
        .filter((m) => m.role === "user")
        .map((m, i) => ({ id: `u-${i}`, title: "user", content: m.text, kind: "text" as const }));
    const frontendUser = frontendMessageItems(messages, (r) => r === "user_message");
    push("user", userItems.length > 0 ? userItems : frontendUser, snapshot?.composition.user ?? 0);

    // assistant
    const assistantItems: BrowserItem[] =
      (content?.messages ?? [])
        .filter((m) => m.role === "assistant")
        .map((m, i) => ({
          id: `a-${i}`,
          title: "assistant",
          content: m.text,
          kind: "text" as const,
        }));
    const frontendAssistant = frontendMessageItems(
      messages,
      (r) => r === "agent_message" || r === "agent_thought",
    );
    push(
      "assistant",
      assistantItems.length > 0 ? assistantItems : frontendAssistant,
      snapshot?.composition.assistant ?? 0,
    );

    // toolResults
    const toolResultItems: BrowserItem[] =
      (content?.messages ?? [])
        .filter((m) => m.role === "tool")
        .map((m, i) => ({ id: `tr-${i}`, title: "tool", content: m.text, kind: "text" as const }));
    const frontendTool = frontendMessageItems(messages, (r) => r === "tool_call");
    push(
      "toolResults",
      toolResultItems.length > 0 ? toolResultItems : frontendTool,
      snapshot?.composition.toolResults ?? 0,
    );

    // injections
    const injectionItems: BrowserItem[] = (content?.injections ?? []).map((text, i) => ({
      id: `inject-${i}`,
      content: text,
      kind: "text",
    }));
    push("injections", injectionItems, snapshot?.composition.injections ?? 0);

    return result;
  }, [snapshot, messages]);

  if (!snapshot) {
    return (
      <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
        {t("context.browser.empty", "Pick a step to inspect its context")}
      </div>
    );
  }

  const toggle = (key: ContextCategory) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setView = (key: ContextCategory, mode: ViewMode) => {
    setViewByCategory((prev) => ({ ...prev, [key]: mode }));
  };

  return (
    <div className="space-y-1.5">
      {sections.map((section) => {
        const isOpen = expanded.has(section.key);
        const meta = CONTEXT_CATEGORIES.find((c) => c.key === section.key);
        const view = viewByCategory[section.key] ?? "raw";
        const showFallbackNote = section.items.length === 0 && section.tokenCount > 0;

        return (
          <div key={section.key} className="rounded-lg border border-border/60 bg-background/60">
            <button
              onClick={() => toggle(section.key)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/30"
            >
              <ChevronRight
                className={cn("size-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")}
              />
              <span className={cn("size-2 shrink-0 rounded-sm", meta?.color)} />
              <span className="flex-1 text-xs font-medium text-foreground/85">
                {t(meta?.i18nKey ?? section.key)}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {formatTokens(section.tokenCount)}
              </span>
            </button>

            {isOpen && (
              <div className="space-y-1.5 px-2 pb-2">
                {section.items.length > 0 && (
                  <div className="flex justify-end gap-1">
                    {(["raw", "md"] as ViewMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setView(section.key, mode)}
                        className={cn(
                          "rounded-full border px-1.5 py-px text-[9px] uppercase transition-colors",
                          view === mode
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/70 text-muted-foreground hover:bg-muted/40",
                        )}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                )}

                {section.items.length === 0 ? (
                  <div className="px-1 py-1 text-[11px] text-muted-foreground/70">
                    {showFallbackNote
                      ? t("context.browser.noContent", "Content not retained for this step")
                      : t("context.browser.emptyCategory", "Nothing here")}
                  </div>
                ) : (
                  section.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border border-border/50 bg-muted/20 px-2 py-1.5"
                    >
                      {item.title && (
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">
                          {item.title}
                        </div>
                      )}
                      {item.kind === "tool" && item.toolRows && item.toolRows.length > 0 && (
                        <div className="mb-1 overflow-x-auto">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="border-b border-border/60 text-left text-muted-foreground">
                                <th className="py-0.5 pr-2 font-medium">{t("context.tool.name", "Name")}</th>
                                <th className="py-0.5 pr-2 font-medium">{t("context.tool.type", "Type")}</th>
                                <th className="py-0.5 font-medium">{t("context.tool.description", "Description")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.toolRows.map((row) => (
                                <tr key={row.name} className="border-b border-border/30 align-top">
                                  <td className="py-0.5 pr-2 font-mono text-foreground/85">{row.name}</td>
                                  <td className="py-0.5 pr-2 font-mono text-muted-foreground">{row.type}</td>
                                  <td className="py-0.5 text-muted-foreground/80">{row.description}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {view === "raw" ? (
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-1.5 font-mono text-[10px] leading-relaxed text-foreground/80">
                          {item.content}
                        </pre>
                      ) : (
                        <div className="max-h-48 overflow-auto">
                          <StreamMarkdown className="prose prose-sm dark:prose-invert prose-p:my-1 prose-p:text-[11px] prose-headings:my-1 prose-headings:text-[12px]">
                            {item.content}
                          </StreamMarkdown>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
