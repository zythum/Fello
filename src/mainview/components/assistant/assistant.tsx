import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Astroid, Bot, Check, ChevronDown, Gauge, Square } from "lucide-react";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  AssistantStatus,
  SessionInfo,
  SessionNotificationFelloExt,
} from "../../../shared/schema";
import { ASSISTANT_AGENT_ID, ASSISTANT_SESSION_ID } from "../../../assistant/constants";
import { request, subscribe } from "../../backend";
import { useAppStore } from "../../store";
import {
  loadAssistantHistory,
  loadPreviousAssistantHistory,
  queueAssistantNotification,
} from "../../lib/assistant-lifecycle";
import { ChatArea } from "../session/chat/chat-area";
import { ChatTextarea, type ChatTextareaSubmitValue } from "../session/chat/chat-textarea";
import type { VoiceInputButtonRef } from "../common/voice-input-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, extractErrorMessage } from "@/lib/utils";
import { useMessage } from "../providers/message";

const EMPTY_MODELS: NonNullable<AssistantStatus["models"]>["availableModels"] = [];

function assistantSession(status: AssistantStatus | null): SessionInfo {
  const now = Date.now();
  return {
    id: ASSISTANT_SESSION_ID,
    resumeId: ASSISTANT_SESSION_ID,
    projectId: "",
    projectTitle: "",
    agentId: ASSISTANT_AGENT_ID,
    title: "Personal Assistant",
    cwd: "",
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
    usage: null,
    lastTurnUsage: null,
  };
}

export function Assistant() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useMessage();
  const resetSessionState = useAppStore((state) => state.resetSessionState);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const isMacApp = useAppStore((state) => state.isMacApp);
  const isFullScreen = useAppStore((state) => state.isFullScreen);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voiceInputRef = useRef<VoiceInputButtonRef>(null);

  useEffect(() => {
    let active = true;
    resetSessionState(ASSISTANT_SESSION_ID);

    const onStatus = (detail: { status: AssistantStatus }) => {
      if (active) setStatus(detail.status);
    };
    const onUpdate = (detail: { notification: SessionNotificationFelloExt }) => {
      if (active) queueAssistantNotification(detail.notification);
    };

    subscribe.on("assistant-status-changed", onStatus);
    subscribe.on("assistant-update", onUpdate);
    void Promise.all([request.getAssistantStatus(), loadAssistantHistory()])
      .then(([nextStatus]) => {
        if (active) setStatus(nextStatus);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus({
          connectionStatus: "error",
          error: error instanceof Error ? error.message : String(error),
          sourceAgentId: null,
          enabled: true,
          isStreaming: false,
          dreaming: false,
          models: null,
          thoughtLevels: null,
        });
      });

    return () => {
      active = false;
      subscribe.off("assistant-status-changed", onStatus);
      subscribe.off("assistant-update", onUpdate);
    };
  }, [resetSessionState]);

  const session = useMemo(() => assistantSession(status), [status]);
  const isConnected = status?.connectionStatus === "connected";
  const isStreaming = status?.isStreaming ?? false;
  const isDreaming = status?.dreaming ?? false;
  const showMacTrafficLightSpace = isMacApp && !isFullScreen;
  const availableModels = status?.models?.availableModels ?? EMPTY_MODELS;
  const currentModelId = status?.models?.currentModelId ?? null;
  const currentModel = availableModels.find((model) => model.modelId === currentModelId);
  const groupedModels = useMemo(() => {
    const groups = new Map<string, typeof availableModels>();
    for (const model of availableModels) {
      const slashIndex = model.name.indexOf("/");
      const group = slashIndex > 0 ? model.name.slice(0, slashIndex) : "";
      const items = groups.get(group) ?? [];
      items.push(model);
      groups.set(group, items);
    }
    return groups;
  }, [availableModels]);
  const availableThoughtLevels = status?.thoughtLevels?.availableThoughtLevels ?? [];
  const currentThoughtLevelId = status?.thoughtLevels?.currentThoughtLevelId ?? null;

  const send = useCallback(
    async (value: ChatTextareaSubmitValue) => {
      const text = value.text.trim();
      if (!text) return;
      if (!isConnected) {
        toast.error(t("assistant.notConnected", "Personal Assistant is not connected."));
        return;
      }
      if (isDreaming) {
        toast.error(t("assistant.busyDreaming", "Wait for Dream to finish."));
        return;
      }
      if (isStreaming) {
        toast.error(t("assistant.busyStreaming", "Wait for the current reply to finish."));
        return;
      }
      setInput("");
      setStatus((current) =>
        current?.promptError ? { ...current, promptError: undefined } : current,
      );
      document.dispatchEvent(
        new CustomEvent("fello-scroll-to-bottom", { detail: { duration: 0 } }),
      );
      const contents: ContentBlock[] = [{ type: "text", text }];
      try {
        const result = await request.sendAssistantPrompt({ contents });
        const finishedNormally =
          result.stopReason === "end_turn" || result.stopReason === "cancelled";
        if (result.error || !finishedNormally) {
          const message =
            result.error || result.stopReason || t("assistant.failed", "Assistant failed");
          toast.error(message);
          setStatus((current) =>
            current
              ? { ...current, promptError: message, isStreaming: false, dreaming: false }
              : current,
          );
        }
      } catch (error) {
        setStatus((current) => ({
          ...(current ?? { models: null, thoughtLevels: null, sourceAgentId: null }),
          connectionStatus: "error",
          error: error instanceof Error ? error.message : String(error),
          sourceAgentId: null,
          enabled: true,
          isStreaming: false,
          dreaming: false,
        }));
      }
    },
    [isConnected, isStreaming, isDreaming, t, toast],
  );

  const changeModel = useCallback(
    async (modelId: string | null) => {
      if (!modelId || modelId === currentModelId) return;
      try {
        await request.setAssistantModel({ modelId });
      } catch (error) {
        setStatus((current) => ({
          ...(current ?? {
            models: null,
            thoughtLevels: null,
            sourceAgentId: null,
            enabled: true,
          }),
          connectionStatus: "error",
          error: extractErrorMessage(error) || "Failed to update Assistant model.",
          isStreaming: false,
          dreaming: false,
        }));
      }
    },
    [currentModelId],
  );

  const changeThoughtLevel = useCallback(
    async (thoughtLevelId: string | null) => {
      if (!thoughtLevelId || thoughtLevelId === currentThoughtLevelId) return;
      try {
        await request.setAssistantThoughtLevel({ thoughtLevelId });
      } catch (error) {
        setStatus((current) => ({
          ...(current ?? {
            models: null,
            thoughtLevels: null,
            sourceAgentId: null,
            enabled: true,
          }),
          connectionStatus: "error",
          error: extractErrorMessage(error) || "Failed to update Assistant thinking level.",
          isStreaming: false,
          dreaming: false,
        }));
      }
    },
    [currentThoughtLevelId],
  );

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header
        className={cn(
          "relative flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background pr-4 transition-[padding] duration-200",
          sidebarOpen ? "pl-2.5" : showMacTrafficLightSpace ? "pl-27" : "pl-10",
        )}
        style={{ WebkitAppRegion: "drag" }}
      >
        <Bot className="size-4 text-primary" />
        <span className="text-sm font-medium">{t("assistant.title", "Personal Assistant")}</span>
        <span className="text-xs text-muted-foreground">
          {isDreaming
            ? t("assistant.dreaming", "Dreaming…")
            : status?.dreamError
              ? status.dreamError
              : status?.promptError
                ? status.promptError
                : status?.connectionStatus === "connected"
                  ? t("assistant.ready", "Ready")
                  : status?.connectionStatus === "connecting"
                    ? t("assistant.connecting", "Connecting…")
                    : (status?.error ?? t("assistant.unavailable", "Unavailable"))}
        </span>
        {status?.connectionStatus === "error" && (
          <Button
            className="ml-auto"
            size="sm"
            variant="outline"
            style={{ WebkitAppRegion: "no-drag" }}
            onClick={() => navigate("/settings/assistant")}
          >
            {t("assistant.configure", "Configure assistant")}
          </Button>
        )}
      </header>

      <ChatArea
        session={session}
        showTimeline={false}
        loadPreviousHistory={loadPreviousAssistantHistory}
      />

      <div className="-mt-6 relative p-6 transition-opacity duration-300">
        <div className="mx-auto max-w-5xl">
          <ChatTextarea
            sessionId={ASSISTANT_SESSION_ID}
            className="shadow-[0_0_20px] shadow-primary/10 dark:shadow-primary/20"
            textValue={input}
            onTextValueChange={setInput}
            inputRef={inputRef}
            onSubmit={(value) => void send(value)}
            placeholder={t("assistant.placeholder", "Message your assistant")}
            voiceInputRef={voiceInputRef}
            attachments={null}
            rightSlot={
              <>
                {availableModels.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 min-w-16 max-w-48 shrink gap-2 overflow-hidden text-xs text-muted-foreground hover:text-foreground"
                        />
                      }
                    >
                      <Astroid className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {currentModel?.name ?? t("assistant.selectModel", "Model")}
                      </span>
                      <ChevronDown className="size-3 shrink-0 opacity-60" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-auto! max-w-72 min-w-(--anchor-width)"
                    >
                      {groupedModels.size <= 1
                        ? availableModels.map((model) => (
                            <DropdownMenuItem
                              key={model.modelId}
                              onClick={() => void changeModel(model.modelId)}
                              className="gap-2"
                            >
                              <Check
                                className={`size-3 shrink-0 ${model.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                              />
                              <div className="flex min-w-0 flex-col gap-0.5 pr-3">
                                <span className="truncate">{model.name}</span>
                                {model.description && (
                                  <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                                    {model.description}
                                  </span>
                                )}
                              </div>
                            </DropdownMenuItem>
                          ))
                        : Array.from(groupedModels.entries()).map(([group, models]) =>
                            group ? (
                              <DropdownMenuSub key={group}>
                                <DropdownMenuSubTrigger>{group}</DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="max-w-72">
                                  {models.map((model) => (
                                    <DropdownMenuItem
                                      key={model.modelId}
                                      onClick={() => void changeModel(model.modelId)}
                                      className="gap-2"
                                    >
                                      <Check
                                        className={`size-3 shrink-0 ${model.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                                      />
                                      <span className="truncate">{model.name}</span>
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            ) : (
                              models.map((model) => (
                                <DropdownMenuItem
                                  key={model.modelId}
                                  onClick={() => void changeModel(model.modelId)}
                                  className="gap-2"
                                >
                                  <Check
                                    className={`size-3 shrink-0 ${model.modelId === currentModelId ? "opacity-100" : "opacity-0"}`}
                                  />
                                  <span className="truncate">{model.name}</span>
                                </DropdownMenuItem>
                              ))
                            ),
                          )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {availableThoughtLevels.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 min-w-16 max-w-32 shrink gap-2 overflow-hidden text-xs text-muted-foreground hover:text-foreground"
                        />
                      }
                    >
                      <Gauge className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {availableThoughtLevels.find((level) => level.id === currentThoughtLevelId)
                          ?.name ?? t("assistant.selectThinking", "Thinking")}
                      </span>
                      <ChevronDown className="size-3 shrink-0 opacity-60" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto! min-w-(--anchor-width)">
                      {availableThoughtLevels.map((level) => (
                        <DropdownMenuItem
                          key={level.id}
                          onClick={() => void changeThoughtLevel(level.id)}
                          className="gap-2"
                        >
                          <Check
                            className={`size-3 shrink-0 ${level.id === currentThoughtLevelId ? "opacity-100" : "opacity-0"}`}
                          />
                          <span>{level.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            }
            primaryAction={
              isStreaming ? (
                <Button
                  variant="destructive"
                  size="icon"
                  className="size-7 cursor-default rounded-lg"
                  onClick={() => void request.cancelAssistantPrompt()}
                >
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="size-7 rounded-lg"
                  disabled={!input.trim() || !isConnected}
                  onClick={() => void send({ text: input, attachments: [], source: "input" })}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
              )
            }
          />
        </div>
      </div>
    </main>
  );
}
