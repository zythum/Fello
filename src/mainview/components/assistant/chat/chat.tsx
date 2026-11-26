import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HatGlasses, TriangleAlert, X } from "lucide-react";
import type { AssistantStatus, SessionInfo } from "../../../../shared/schema";
import { ASSISTANT_AGENT_ID } from "../../../../assistant/constants";
import { assistantProjectId } from "../../../../shared/assistant";
import { request } from "../../../backend";
import { loadPreviousSessionHistory } from "../../../lib/session-lifecycle";
import { ChatArea } from "../../chat/chat-area";
import { AskUserDialog } from "../../chat/chat-ask-user-dialog";
import { AssistantChatHeader } from "./chat-header";
import { AssistantChatInput } from "./chat-input";

/** The assistant's pseudo session, shaped so the shared chat components can render it. */
function assistantSession(
  assistantId: string,
  name: string,
  status: AssistantStatus | null,
): SessionInfo {
  const now = Date.now();
  return {
    id: assistantId,
    resumeId: assistantId,
    projectId: assistantProjectId(assistantId),
    projectTitle: name,
    agentId: ASSISTANT_AGENT_ID,
    title: name,
    // 助理是伪会话，名称来自 config.json，不存在「用户自定义标题」。
    userTitle: null,
    cwd: status?.workspace ?? "",
    createdAt: now,
    updatedAt: now,
    mcpServers: [],
    features: [],
    permissionMode: "ask",
    models: status?.models ?? null,
    modes: null,
    thoughtLevels: status?.thoughtLevels ?? null,
    initializeInfo: null,
    availableCommands: [],
    connectionStatus:
      status?.connectionStatus === "connected"
        ? "connected"
        : status?.connectionStatus === "connecting"
          ? "connecting"
          : "disconnected",
    isStreaming: status?.isStreaming ?? false,
    usage: status?.usage ?? null,
    lastTurnUsage: status?.lastTurnUsage ?? null,
  };
}

/**
 * 个人助理的聊天列：header + Dream 失败提示 + 消息流 + 输入区 + Ask User 弹层。
 * 状态（`status`）仍由助理页面持有，这里通过 props / 更新回调读写。
 */
export function AssistantChat({
  assistantId,
  assistantName,
  status,
  onStatusChange,
  onOpenMemory,
  panelOpen,
  onOpenPanel,
}: {
  assistantId: string;
  assistantName: string;
  status: AssistantStatus | null;
  onStatusChange: (updater: (current: AssistantStatus | null) => AssistantStatus | null) => void;
  onOpenMemory: () => void;
  panelOpen: boolean;
  onOpenPanel: () => void;
}) {
  const { t } = useTranslation();
  const session = useMemo(
    () => assistantSession(assistantId, assistantName, status),
    [assistantId, assistantName, status],
  );
  // Dream 失败提示的显示完全由 status.dreamError 决定；关闭时由后端清空并广播。
  const dreamError = status?.dreamError ?? null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <AssistantChatHeader
        assistantId={assistantId}
        assistantName={assistantName}
        status={status}
        session={session}
        panelOpen={panelOpen}
        onOpenMemory={onOpenMemory}
        onOpenPanel={onOpenPanel}
      />

      {/* Dream 失败提示浮在 header 下方，不占聊天区布局；关闭会清掉后端的 dreamError。 */}
      {dreamError && (
        <div className="pointer-events-none absolute inset-x-0 top-12 z-20 px-3 pt-2">
          <div className="pointer-events-auto flex items-start gap-2 rounded-lg border border-destructive/30 bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">
                {t("assistant.dreamFailed", "Dream failed")}
              </p>
              <p className="mt-0.5 wrap-break-word text-[11px] text-muted-foreground">
                {dreamError}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                // 先本地隐藏，再让后端清空并广播，避免离开页面再回来又看到同一条错误。
                onStatusChange((current) =>
                  current?.dreamError ? { ...current, dreamError: undefined } : current,
                );
                void request.dismissAssistantDreamError({ assistantId }).catch(() => {});
              }}
              title={t("assistant.dismiss", "Dismiss")}
              aria-label={t("assistant.dismiss", "Dismiss")}
              className="-mr-1 -mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 outline-none transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      <ChatArea
        session={session}
        showTimeline={false}
        loadPreviousHistory={() => loadPreviousSessionHistory(assistantId)}
        avatar={HatGlasses}
        name={assistantName}
      />

      <AssistantChatInput
        assistantId={assistantId}
        assistantName={assistantName}
        status={status}
        onStatusChange={onStatusChange}
      />

      {/* 与 session 的挂法一致：弹层只覆盖 chat 列，不盖住右侧 panel。 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <AskUserDialog sessionId={assistantId} />
      </div>
    </div>
  );
}
