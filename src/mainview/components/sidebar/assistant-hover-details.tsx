import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Bot, Folder } from "lucide-react";
import type { AssistantConfig, AssistantStatus } from "../../../shared/schema";
import { ASSISTANT_AGENT_ID } from "../../../assistant/constants";
import { isWebUI, request, subscribe } from "../../backend";
import { electron } from "../../electron";
import { useMessage } from "../providers/message";
import { getErrorMessage } from "./sidebar-utils";

/**
 * 个人助理 hover 卡片的详情区。
 *
 * 助理状态不在全局 store（只存在于助理页面的局部 state），所以这里直接订阅
 * assistant-status-changed 并按需拉取一次。订阅隔离在这个小组件内，避免侧边栏
 * 跟随助理的每次状态广播（例如 usage 更新）整体重渲染。
 */
export function AssistantHoverDetails({ assistant }: { assistant: AssistantConfig }) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const [status, setStatus] = useState<AssistantStatus | null>(null);

  useEffect(() => {
    let active = true;
    const onStatus = (detail: { assistantId: string; status: AssistantStatus }) => {
      if (active && detail.assistantId === assistant.id) setStatus(detail.status);
    };
    subscribe.on("assistant-status-changed", onStatus);
    void request
      .getAssistantStatus({ assistantId: assistant.id })
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {});
    return () => {
      active = false;
      subscribe.off("assistant-status-changed", onStatus);
    };
  }, [assistant.id]);

  const agentLabel = status?.sourceAgentId ?? assistant.sourceAgentId ?? ASSISTANT_AGENT_ID;
  const statusLabel = assistant.disabled
    ? t("assistant.disabled", "Disabled")
    : status?.dreaming
      ? t("assistant.dreaming", "Dreaming…")
      : status?.isStreaming
        ? t("sidebar.assistantReplying", "Replying…")
        : status?.connectionStatus === "connected"
          ? t("assistant.ready", "Ready")
          : status?.connectionStatus === "connecting"
            ? t("assistant.connecting", "Connecting…")
            : (status?.error ?? t("assistant.unavailable", "Unavailable"));

  const revealWorkspace = async () => {
    const workspace = status?.workspace;
    if (!workspace) return;
    try {
      await electron.revealInFinder(workspace);
    } catch (err) {
      toast.error(
        getErrorMessage(err, t("sidebar.revealInFinderFailed", "Failed to reveal in Finder.")),
      );
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
        <Bot className="size-3 shrink-0" />
        <span className="truncate">{agentLabel}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
        <Folder className="size-3 shrink-0" />
        {status?.workspace && !isWebUI ? (
          <button
            type="button"
            onClick={() => void revealWorkspace()}
            title={status.workspace}
            className="min-w-0 flex-1 truncate text-left transition-colors hover:text-foreground"
          >
            {status.workspace}
          </button>
        ) : (
          <span className="truncate" title={status?.workspace}>
            {status?.workspace || t("assistant.workspace", "Workspace")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
        <Activity className="size-3 shrink-0" />
        <span className="truncate">{statusLabel}</span>
      </div>
    </>
  );
}
