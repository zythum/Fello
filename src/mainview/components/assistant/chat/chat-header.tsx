import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, PanelRightOpen, RefreshCw, Settings2 } from "lucide-react";
import type { AssistantStatus, SessionInfo } from "../../../../shared/schema";
import { request } from "../../../backend";
import { electron } from "../../../electron";
import { useAppStore } from "../../../store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { CopyableRow } from "../../common/copyable-row";
import { SessionConfigFields } from "../../common/session-config";
import { TtsMenuButton, TtsReadoutButton } from "../../common/tts-header-controls";
import { UsageButton } from "../../common/usage-button";
import { useMessage } from "../../providers/message";
import { cn, extractErrorMessage } from "@/lib/utils";

/**
 * 个人助理的聊天头部：名称 / 连接状态 / TTS / 用量 / 助理配置 Popover / 面板开关。
 *
 * 配置（来源 Agent / MCP / Dream）只在「重启助理」时提交；本地草稿状态由本组件持有，
 * 打开 Popover 时从 `assistantConfig` 重新同步。
 */
export function AssistantChatHeader({
  assistantId,
  assistantName,
  status,
  session,
  panelOpen,
  onOpenMemory,
  onOpenPanel,
}: {
  assistantId: string;
  assistantName: string;
  status: AssistantStatus | null;
  session: SessionInfo;
  panelOpen: boolean;
  onOpenMemory: () => void;
  onOpenPanel: () => void;
}) {
  const { t } = useTranslation();
  const { toast, confirm } = useMessage();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const isMacApp = useAppStore((state) => state.isMacApp);
  const isFullScreen = useAppStore((state) => state.isFullScreen);
  const assistantConfig = useAppStore((state) =>
    state.assistants.find((item) => item.id === assistantId),
  );
  const configuredAgents = useAppStore((state) => state.configuredAgents);
  const availableAgents = useMemo(
    () =>
      configuredAgents.filter(
        (agent) =>
          agent.type === "api" && agent.provider === "openai-compatible" && !agent.disabled,
      ),
    [configuredAgents],
  );

  const [configOpen, setConfigOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [localSourceAgentId, setLocalSourceAgentId] = useState<string | null>(
    assistantConfig?.sourceAgentId ?? null,
  );
  const [localMcpServers, setLocalMcpServers] = useState<string[]>(
    () => assistantConfig?.mcpServers ?? [],
  );
  const [localDream, setLocalDream] = useState(
    () => assistantConfig?.dream ?? { maxContextTokens: 96_000, preferredTime: "02:00" },
  );
  // Null means no pending edit: the input shows the committed value. This keeps
  // intermediate strings (empty, "12") editable without validating on every keystroke.
  const [dreamMaxContextDraft, setDreamMaxContextDraft] = useState<string | null>(null);

  const isDreaming = status?.dreaming ?? false;
  const showMacTrafficLightSpace = isMacApp && !isFullScreen;

  const handleRestartAssistant = async () => {
    if (isRestarting) return;
    setIsRestarting(true);
    try {
      const next = await request.restartAssistant({
        assistantId,
        config: {
          sourceAgentId: localSourceAgentId,
          mcpServers: localMcpServers,
          dream: localDream,
        },
      });
      setLocalSourceAgentId(next.sourceAgentId);
      setLocalMcpServers(next.mcpServers);
      setLocalDream(next.dream);
      setDreamMaxContextDraft(null);
      setConfigOpen(false);
    } catch (error) {
      toast.error(
        extractErrorMessage(error) || t("assistant.restartFailed", "Failed to restart assistant."),
      );
    } finally {
      setIsRestarting(false);
    }
  };

  const commitDreamMaxContextDraft = () => {
    const draft = dreamMaxContextDraft;
    setDreamMaxContextDraft(null);
    if (draft === null) return;
    const value = Number(draft);
    if (Number.isSafeInteger(value) && value > 0) {
      setLocalDream((current) =>
        current.maxContextTokens === value ? current : { ...current, maxContextTokens: value },
      );
    }
  };

  /**
   * 手动触发一次记忆沉淀。界面上先按已知状态提示缺什么条件，
   * 后端仍会复核（历史为空 / 没模型 / 正在跑）并返回原因，避免状态过期时静默失败。
   */
  const handleDreamNow = async () => {
    if (!status || status.connectionStatus !== "connected") {
      toast.error(t("assistant.notConnected", "Personal Assistant is not connected."));
      return;
    }
    if (status.dreaming) {
      toast.info(t("assistant.busyDreaming", "Wait for Dream to finish."));
      return;
    }
    if (status.isStreaming) {
      toast.info(t("assistant.busyStreaming", "Wait for the current reply to finish."));
      return;
    }
    // 沉淀会清空模型可见的对话历史，一次误点代价不小，先讲清后果再执行。
    const confirmed = await confirm({
      title: t("assistant.dreamConfirmTitle", "Run Dream now?"),
      content: t(
        "assistant.dreamConfirmContent",
        "The assistant reviews this conversation, writes a diary entry, and updates its long-term memory. Afterwards it continues from that memory instead of re-reading the conversation; the chat transcript itself stays.",
      ),
      buttons: [
        { text: t("message.cancel", "Cancel"), value: null, variant: "outline" },
        {
          text: t("assistant.dreamConfirmAction", "Start"),
          value: "confirm",
          variant: "default",
        },
      ],
    });
    if (!confirmed) return;
    try {
      const result = await request.runAssistantDream({ assistantId });
      if (result.started) return;
      switch (result.reason) {
        case "empty":
          toast.info(
            t("assistant.dreamEmpty", "Nothing to consolidate yet — chat a little first."),
          );
          break;
        case "no-model":
          toast.error(t("assistant.dreamNoModel", "No model available, so Dream cannot run."));
          break;
        case "busy":
          toast.info(t("assistant.busyDreaming", "Wait for Dream to finish."));
          break;
        case "not-connected":
          toast.error(t("assistant.notConnected", "Personal Assistant is not connected."));
          break;
        default:
          toast.error(t("assistant.dreamFailed", "Dream failed"));
      }
    } catch (error) {
      toast.error(extractErrorMessage(error) || t("assistant.dreamFailed", "Dream failed"));
    }
  };

  return (
    <header
      className={cn(
        "relative flex h-12 items-center border-b border-border gap-2 pr-2.5 bg-background shrink-0 transition-[padding] duration-200",
        sidebarOpen ? "pl-2.5" : showMacTrafficLightSpace ? "pl-27" : "pl-10",
      )}
      style={{ WebkitAppRegion: "drag" }}
    >
      {status?.sourceAgentId && (
        <Badge variant="outline" className="px-1 text-[9px] uppercase select-none">
          {status.sourceAgentId}
        </Badge>
      )}
      <div className="flex flex-1 min-w-0 items-baseline gap-2">
        <span className="truncate text-[13px] font-normal text-sidebar-foreground/85">
          {assistantName}
        </span>
        <span className="flex-1 text-[10px] text-muted-foreground truncate">
          {isDreaming
            ? t("assistant.dreaming", "Dreaming…")
            : status?.connectionStatus === "connected"
              ? t("assistant.ready", "Ready")
              : status?.connectionStatus === "connecting"
                ? t("assistant.connecting", "Connecting…")
                : (status?.error ?? t("assistant.unavailable", "Unavailable"))}
        </span>
      </div>
      <div className="ml-1 flex items-center shrink-0 gap-1" style={{ WebkitAppRegion: "no-drag" }}>
        <TtsReadoutButton />
        <TtsMenuButton />
        <UsageButton
          session={session}
          onOpenMemory={onOpenMemory}
          onDreamNow={() => void handleDreamNow()}
        />
        <PopoverPrimitive.Root
          open={configOpen}
          onOpenChange={(open) => {
            setConfigOpen(open);
            if (open) {
              setLocalSourceAgentId(assistantConfig?.sourceAgentId ?? null);
              setLocalMcpServers(assistantConfig?.mcpServers ?? []);
              setLocalDream(
                assistantConfig?.dream ?? {
                  maxContextTokens: 96_000,
                  preferredTime: "02:00",
                },
              );
              setDreamMaxContextDraft(null);
            }
          }}
        >
          <PopoverPrimitive.Trigger className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors data-pressed:bg-sidebar-accent/40">
            <Settings2 className="size-4" />
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner side="bottom" align="end" sideOffset={4}>
              <PopoverPrimitive.Popup className="z-10 max-h-[70vh] w-110 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none p-2 origin-(--transform-origin) data-ending-style:scale-90 data-starting-style:scale-90 data-ending-style:opacity-0 data-starting-style:opacity-0 transition-[transform,opacity] duration-100">
                <div className="space-y-px py-1">
                  <div className="px-2">
                    <CopyableRow
                      label={t("assistant.config.id", "Assistant ID")}
                      value={assistantId}
                      openFolderTitle={t(
                        "assistant.config.openDataFolder",
                        "Open Assistant Folder",
                      )}
                      onOpenFolder={() => {
                        void request
                          .getAssistantDataSystemPath({ assistantId })
                          .then((dirPath) => electron.revealInFinder(dirPath))
                          .catch(() => {});
                      }}
                    />
                  </div>
                  <div className="px-2">
                    <CopyableRow
                      label={t("assistant.config.workspace", "Workspace")}
                      value={status?.workspace ?? ""}
                      openFolderTitle={t(
                        "assistant.config.openWorkspaceFolder",
                        "Open Workspace Folder",
                      )}
                      onOpenFolder={() => {
                        if (status?.workspace) {
                          void electron.revealInFinder(status.workspace).catch(() => {});
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="my-1 border-t border-border/50" />
                <div className="flex flex-col gap-2 px-2 pt-0.5 pb-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("assistant.config.sourceAgent", "Source agent")}
                    </span>
                    <Select
                      value={localSourceAgentId ?? ""}
                      onValueChange={(value) => {
                        if (typeof value === "string") {
                          setLocalSourceAgentId(value || null);
                        }
                      }}
                    >
                      <SelectTrigger size="sm" className="h-7 w-49 text-xs">
                        <SelectValue
                          placeholder={t("assistant.config.selectAgent", "Select an agent")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {availableAgents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            {agent.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="my-1 border-t border-border/50" />
                <div>
                  <div className="mt-0.5 px-2 py-1 text-xs font-semibold text-foreground/80">
                    {t("assistant.config.groupDream", "Dream")}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-2 py-2">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {t("assistant.config.dreamMaxContext", "Max tokens")}
                      </span>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        className="h-7 w-full rounded-md bg-background text-xs! text-muted-foreground hover:text-foreground focus:text-foreground"
                        value={dreamMaxContextDraft ?? String(localDream.maxContextTokens)}
                        onChange={(event) => setDreamMaxContextDraft(event.target.value)}
                        onBlur={commitDreamMaxContextDraft}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {t("assistant.config.dreamPreferredTime", "Preferred time")}
                      </span>
                      <Input
                        type="time"
                        step={60}
                        className="h-7 w-full rounded-md bg-background text-xs! text-muted-foreground hover:text-foreground focus:text-foreground appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                        value={localDream.preferredTime}
                        onChange={(event) =>
                          setLocalDream((current) => ({
                            ...current,
                            preferredTime: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
                <SessionConfigFields
                  variant="popover"
                  showFeatures={false}
                  features={[]}
                  onFeaturesChange={() => {}}
                  mcpServers={localMcpServers}
                  onMcpServersChange={setLocalMcpServers}
                />

                <div className="mt-2 px-1">
                  <Button
                    size="xs"
                    className="h-7 w-full gap-1.5 text-xs font-normal"
                    onClick={() => void handleRestartAssistant()}
                    disabled={isRestarting}
                  >
                    {isRestarting ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    <span>
                      {isRestarting
                        ? t("assistant.restarting", "Restarting…")
                        : t("assistant.restart", "Restart Assistant")}
                    </span>
                  </Button>
                </div>
              </PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
        {!panelOpen && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenPanel}
            title={t("panel.expand", "Expand panel")}
            aria-label={t("panel.expand", "Expand panel")}
            className="text-sidebar-foreground/45 hover:text-sidebar-foreground/70"
          >
            <PanelRightOpen className="size-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
