import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Astroid, Check, ChevronDown, Gauge, Loader2, PanelRightOpen, Square } from "lucide-react";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  AssistantStatus,
  SessionInfo,
  SessionNotificationFelloExt,
} from "../../../shared/schema";
import { ASSISTANT_AGENT_ID, ASSISTANT_SESSION_ID } from "../../../assistant/constants";
import { ASSISTANT_PROJECT_ID } from "../../../shared/constants";
import { request, subscribe } from "../../backend";
import { useAppStore } from "../../store";
import {
  loadAssistantHistory,
  loadPreviousAssistantHistory,
  queueAssistantNotification,
} from "../../lib/assistant-lifecycle";
import { ChatArea } from "../session/chat/chat-area";
import { ChatTextarea, type ChatTextareaSubmitValue } from "../session/chat/chat-textarea";
import { FileDetail } from "../session/detail/file/file-detail";
import { nodesToMentionText, resolveMentions } from "../../lib/mention-utils";
import { AskUserDialog } from "../session/chat/chat-ask-user-dialog";
import type { VoiceInputButtonRef } from "../common/voice-input-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Panel, type PanelTab } from "./panel/panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, extractErrorMessage, generateUUID } from "@/lib/utils";
import type { ChatMessage } from "../../lib/chat-message";
import { useMessage } from "../providers/message";

const EMPTY_MODELS: NonNullable<AssistantStatus["models"]>["availableModels"] = [];

function assistantSession(status: AssistantStatus | null): SessionInfo {
  const now = Date.now();
  return {
    id: ASSISTANT_SESSION_ID,
    resumeId: ASSISTANT_SESSION_ID,
    projectId: ASSISTANT_PROJECT_ID,
    projectTitle: "Personal Assistant",
    agentId: ASSISTANT_AGENT_ID,
    title: "Personal Assistant",
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
  const [panelTab, setPanelTab] = useState<PanelTab>("reminders");
  const [detailFile, setDetailFile] = useState<string | null>(null);
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  const isHistoryLoading = useAppStore(
    (state) => state.sessionStates.get(ASSISTANT_SESSION_ID)?.isLoading ?? true,
  );
  const panelOpen = useAppStore((state) => state.panelOpen);
  const setPanelOpen = useAppStore((state) => state.setPanelOpen);
  const isMacApp = useAppStore((state) => state.isMacApp);
  const isFullScreen = useAppStore((state) => state.isFullScreen);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voiceInputRef = useRef<VoiceInputButtonRef>(null);

  useEffect(() => {
    let active = true;
    resetSessionState(ASSISTANT_SESSION_ID);
    // reset 会清空 askUser 队列：把后端仍然挂着的请求补回来（离开页面期间可能产生）。
    void request
      .getPendingAskUserRequests({ sessionId: ASSISTANT_SESSION_ID })
      .then((pending) => {
        for (const req of pending) {
          useAppStore.getState().addAskUserRequest(ASSISTANT_SESSION_ID, req);
        }
      })
      .catch(() => {});

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
          workspace: "",
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

  useEffect(() => {
    const handleAddToChat = (event: Event) => {
      const nodes = (event as CustomEvent<{ id: string; name: string; isFolder: boolean }[]>).detail;
      if (!nodes || nodes.length === 0) return;
      const mentions = nodesToMentionText(nodes);
      setInput((prev) => (prev ? `${prev} ${mentions} ` : `${mentions} `));
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    document.addEventListener("fello-add-to-chat", handleAddToChat);
    return () => document.removeEventListener("fello-add-to-chat", handleAddToChat);
  }, []);

  useEffect(() => {
    if (!mainEl) return;
    const callback = () => setCompact(mainEl.offsetWidth < 1000);
    const observer = new ResizeObserver(callback);
    observer.observe(mainEl);
    callback();
    return () => observer.disconnect();
  }, [mainEl]);

  const session = useMemo(() => assistantSession(status), [status]);
  const isInitializing =
    status === null || status.connectionStatus === "connecting" || isHistoryLoading;
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
      const text = resolveMentions(value.text).trim();
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
      // Same as Session: show the message at once with optimistic ids. The backend's copy
      // carries the same optimistic_id and replaces this one when it arrives.
      const displayId = generateUUID();
      const contents: ContentBlock[] = [
        {
          type: "text",
          text,
          _meta: { display_id: displayId, optimistic_id: generateUUID() },
        },
      ];
      useAppStore.getState().addMessage(ASSISTANT_SESSION_ID, {
        role: "user_message",
        contents,
        displayId,
        receivedAt: Date.now(),
      } satisfies ChatMessage);
      document.dispatchEvent(
        new CustomEvent("fello-scroll-to-bottom", { detail: { duration: 0 } }),
      );
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
        // The message never reached the backend, so drop the optimistic copy (matched by its displayId).
        useAppStore.getState().updateSessionState(ASSISTANT_SESSION_ID, (state) => ({
          messages: state.messages.filter((message) => message.displayId !== displayId),
        }));
        setStatus((current) => ({
          ...(current ?? {
            models: null,
            thoughtLevels: null,
            sourceAgentId: null,
            workspace: "",
          }),
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
            workspace: "",
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
            workspace: "",
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
    <main
      ref={setMainEl}
      className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >

      {/* Content stays mounted and fades in once initialization finishes, like Session's chat area. */}
      <ResizablePanelGroup
        className={cn(
          "flex min-h-0 flex-1 transition-opacity duration-500",
          isInitializing && "pointer-events-none opacity-0",
        )}
      >
        <ResizablePanel
          id="chat"
          minSize={400}
          disabled={compact && detailFile !== null}
          collapsedSize={0}
          maxSize={compact && detailFile ? 0 : undefined}
        >
          <div className="relative flex h-full min-h-0 flex-col">
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
              {t("assistant.title", "Personal Assistant")}
            </span>
            <span className="flex-1 text-[10px] text-muted-foreground truncate">
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
          </div>
          <div className="ml-1 flex items-center shrink-0 gap-1" style={{ WebkitAppRegion: "no-drag" }}>
            {status?.connectionStatus === "error" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/settings/assistant")}
              >
                {t("assistant.configure", "Configure assistant")}
              </Button>
            )}
            {!panelOpen && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setPanelOpen(true)}
                title={t("panel.expand", "Expand panel")}
                aria-label={t("panel.expand", "Expand panel")}
                className="text-sidebar-foreground/45 hover:text-sidebar-foreground/70"
              >
                <PanelRightOpen className="size-4" />
              </Button>
            )}
          </div>
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
              projectId={ASSISTANT_PROJECT_ID}
              projectCwd={status?.workspace ?? ""}
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

        {/* 与 session 的挂法一致：弹层只覆盖 chat 列，不盖住右侧 panel。 */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <AskUserDialog sessionId={ASSISTANT_SESSION_ID} />
        </div>
          </div>
        </ResizablePanel>

        {detailFile && (
          <>
            {!compact && (
              <ResizableHandle className="bg-border/70 data-[separator=hover]:bg-ring/50 data-[separator=focus]:bg-ring/50 data-[separator=active]:bg-ring/80 duration-250" />
            )}
            <ResizablePanel id="detail" defaultSize={500} minSize={300}>
              <FileDetail
                compact={compact}
                projectId={ASSISTANT_PROJECT_ID}
                file={detailFile}
                onClose={() => setDetailFile(null)}
              />
            </ResizablePanel>
          </>
        )}

        {/* Collapsed: no handle, and the panel cannot be dragged open. Same pattern as Session. */}
        <ResizableHandle
          disabled={!panelOpen}
          className={cn(
            "bg-border/70 data-[separator=hover]:bg-ring/50 data-[separator=focus]:bg-ring/50 data-[separator=active]:bg-ring/80 duration-250",
            !panelOpen && "opacity-0",
          )}
        />

        <ResizablePanel
          id="panel"
          groupResizeBehavior="preserve-pixel-size"
          defaultSize={280}
          minSize={250}
          maxSize={panelOpen ? 400 : 0}
          inert={!panelOpen}
        >
          <Panel
            tab={panelTab}
            onTabChange={setPanelTab}
            onOpenChange={setPanelOpen}
            workspace={status?.workspace ?? ""}
            previewFileId={detailFile}
            onPreviewFile={setDetailFile}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {isInitializing && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background animate-in fade-in"
          style={{ WebkitAppRegion: "drag" }}
        >
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm font-normal text-muted-foreground/60">
            {t("assistant.connecting", "Connecting…")}
          </p>
        </div>
      )}
    </main>
  );
}
