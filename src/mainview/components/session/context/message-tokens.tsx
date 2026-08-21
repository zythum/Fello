import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSessionMessages } from "../../../lib/session-selectors";
import type { ChatMessage } from "../../../lib/chat-message";
import { ScrollArea } from "@/components/ui/scroll-area";
import { chatMessageText, formatTokens } from "./context-utils";

interface MessageTokensProps {
  sessionId: string;
}

function messageTokenEstimate(msg: ChatMessage): number {
  return Math.max(1, Math.ceil(chatMessageText(msg).length / 4));
}

const ROLE_LABEL: Record<string, string> = {
  user_message: "user",
  agent_message: "assistant",
  agent_thought: "thought",
  tool_call: "tool",
  system_message: "system",
  plan: "plan",
};

/** 当前模型可见消息列表（最新在前），每条带估算 token 成本 */
export function MessageTokens({ sessionId }: MessageTokensProps) {
  const { t } = useTranslation();
  const messages = useSessionMessages(sessionId);

  const items = useMemo(() => {
    if (!messages) return [];
    return [...messages]
      .reverse()
      .map((msg) => ({
        key: msg.displayId,
        role: ROLE_LABEL[msg.role] ?? msg.role,
        tokens: messageTokenEstimate(msg),
        preview: chatMessageText(msg).slice(0, 120),
      }));
  }, [messages]);

  if (!messages || messages.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
        {t("context.emptyMessages", "No messages yet")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t("context.messages.estimated", "Token estimates (~4 chars/token)")}
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="pr-2">
        <div className="space-y-1">
          {items.map((item) => (
            <div
              key={item.key}
              className="flex items-baseline gap-2 rounded-md border border-border/50 bg-muted/20 px-2 py-1"
            >
              <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                {item.role}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/70">
                {item.preview}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground/80">
                {formatTokens(item.tokens)}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
