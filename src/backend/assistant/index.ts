import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import type {
  ContentBlock,
  SessionNotification,
  ToolCallUpdate,
  UsageUpdate,
} from "@agentclientprotocol/sdk";
import type { McpServer, Usage } from "@agentclientprotocol/sdk/unstable";
import type {
  ApiAgentInfo,
  AssistantConfig,
  AssistantDreamStartResult,
  AssistantStatus,
  AssistantWorkerHistorySegment,
  AssistantWorkerInfo,
  SessionNotificationFelloExt,
  SettingsInfo,
} from "../../shared/schema";
import type { AssistantDiary, AssistantReminderList } from "../../shared/schema";
import { listDiarySummaries, readDiary } from "../../assistant/diary-query";
import { serverTimeZone } from "../../assistant/reminders/service";
import { wasFired } from "../../shared/reminder";
import { ASSISTANT_AGENT_ID } from "../../assistant/constants";
import { AssistantStorage } from "../../assistant/storage";
import {
  assistantPaths,
  createAssistantConfig,
  deleteAssistantData,
  ensureAssistantDirectories,
  listAssistantConfigs,
  loadAssistantConfig,
  updateAssistantConfig,
} from "../../assistant/config";
import { ACPBridge, type PromptResult } from "../agent/agent-bridge";
import { ReminderService } from "../../assistant/reminders/service";
import { ReminderStore } from "../../assistant/reminders/store";
import { adapters, agentEnv, extNotificationSpecs } from "../acp-adapters/adapters";
import type { BackendContext } from "../types";
import type { AskUserModule } from "../ask-user";
import type { FileSystemTools } from "../../assistant/fs/tools";
import type { McpConfigDeps } from "../session/mcp-config";
import type { IlinkState } from "../ilink";
import {
  bufferAgentChunkForIlink,
  flushIlinkMedia,
  flushIlinkReply,
} from "../session/notifications";
import { WorkerManager } from "./worker/manager";
import { t } from "../i18n";

export interface AssistantModule {
  start: () => Promise<void>;
  stop: (options?: { shutdownWorkers?: boolean }) => Promise<void>;
  /** Re-read config and restart bridge + reminders, keeping workers alive. */
  restart: () => Promise<void>;
  /** Stops everything, including workers and reminder timers. Called on app shutdown. */
  shutdown: () => Promise<void>;
  getStatus: () => AssistantStatus;
  /** Clear the Dream failure shown in the UI (without touching the next Dream schedule). */
  dismissDreamError: () => void;
  /** Run a Dream now (manual trigger); returns why it did not start when it didn't. */
  dreamNow: () => Promise<AssistantDreamStartResult>;
  listReminders: () => Promise<AssistantReminderList>;
  listDiaries: () => Promise<AssistantDiary[]>;
  readDiary: (file: string) => ReturnType<typeof readDiary>;
  readMemory: () => Promise<{ content: string }>;
  listWorkers: () => Promise<AssistantWorkerInfo[]>;
  readWorkerHistorySegment: (params: {
    workerId: string;
    segmentId?: number;
  }) => Promise<AssistantWorkerHistorySegment>;
  getHistorySegment: (params: {
    segmentId?: number;
  }) => ReturnType<AssistantStorage["readMessageSegment"]>;
  sendPrompt: (
    contents: ContentBlock[],
    options?: { onlyIfIdle?: boolean },
  ) => Promise<PromptResult>;
  cancelPrompt: () => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setThoughtLevel: (thoughtLevelId: string) => Promise<void>;
}

export interface AssistantManager {
  startAll: () => Promise<void>;
  shutdown: () => Promise<void>;
  isAssistantSession: (assistantId: string) => boolean;
  listConfigs: () => AssistantConfig[];
  getConfig: (assistantId: string) => AssistantConfig | null;
  getStatus: (assistantId: string) => AssistantStatus;
  /** Clear the Dream failure shown in the UI; no-op when the assistant is not running. */
  dismissDreamError: (assistantId: string) => void;
  /** Run a Dream now (manual trigger); returns why it did not start when it didn't. */
  dreamNow: (assistantId: string) => Promise<AssistantDreamStartResult>;
  start: (assistantId: string) => Promise<void>;
  create: (input: {
    name?: string;
    sourceAgentId: string;
    mcpServers: string[];
  }) => Promise<AssistantConfig>;
  updateConfig: (
    assistantId: string,
    patch: { name?: string; disabled?: boolean },
  ) => Promise<AssistantConfig>;
  restart: (
    assistantId: string,
    patch?: Partial<Pick<AssistantConfig, "sourceAgentId" | "mcpServers" | "dream">>,
  ) => Promise<AssistantConfig>;
  delete: (assistantId: string) => Promise<void>;
  applySettingsChange: (previous: SettingsInfo, current: SettingsInfo) => Promise<void>;
  // Per-assistant passthroughs
  listReminders: (assistantId: string) => Promise<AssistantReminderList>;
  listDiaries: (assistantId: string) => Promise<AssistantDiary[]>;
  readDiary: (assistantId: string, file: string) => ReturnType<typeof readDiary>;
  readMemory: (assistantId: string) => Promise<{ content: string }>;
  listWorkers: (assistantId: string) => Promise<AssistantWorkerInfo[]>;
  readWorkerHistorySegment: (
    assistantId: string,
    params: { workerId: string; segmentId?: number },
  ) => Promise<AssistantWorkerHistorySegment>;
  getHistorySegment: (
    assistantId: string,
    params: { segmentId?: number },
  ) => ReturnType<AssistantStorage["readMessageSegment"]>;
  sendPrompt: (
    assistantId: string,
    contents: ContentBlock[],
    options?: { onlyIfIdle?: boolean },
  ) => Promise<PromptResult>;
  cancelPrompt: (assistantId: string) => Promise<void>;
  setModel: (assistantId: string, modelId: string) => Promise<void>;
  setThoughtLevel: (assistantId: string, thoughtLevelId: string) => Promise<void>;
}

export type AssistantModuleDeps = {
  askUser: AskUserModule;
  filesystem: FileSystemTools;
  mcpDeps: McpConfigDeps;
  ilink: IlinkState;
};

function mergeToolCallUpdate(base: ToolCallUpdate, update: ToolCallUpdate): ToolCallUpdate {
  const merged: ToolCallUpdate = { ...base };
  for (const key of [
    "title",
    "status",
    "kind",
    "rawInput",
    "locations",
    "rawOutput",
    "_meta",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(update, key) && update[key] != null) {
      Object.assign(merged, { [key]: update[key] });
    }
  }
  if (update.content?.length) {
    const types = new Set(update.content.map((item) => item.type));
    merged.content = [
      ...(merged.content ?? []).filter((item) => !types.has(item.type)),
      ...update.content,
    ];
  }
  return merged;
}

function findContentBlock(value: unknown): ContentBlock | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.type === "string" &&
    ["text", "image", "audio", "resource_link", "resource"].includes(item.type)
  )
    return item as unknown as ContentBlock;
  for (const child of Object.values(item)) {
    const found = findContentBlock(child);
    if (found) return found;
  }
  return null;
}

function getAssistantApiAgent(ctx: BackendContext, agentId: string): ApiAgentInfo | null {
  const agent = ctx.storage.getSettings().agents.find((item) => item.id === agentId);
  return agent?.type === "api" && agent.provider === "openai-compatible" && !agent.disabled
    ? agent
    : null;
}

/** The assistant's own MCP servers (separate from the worker's selection). */
function buildAssistantMcpServers(ctx: BackendContext, ids: string[]): McpServer[] {
  const settings = ctx.storage.getSettings();
  const servers: McpServer[] = [];
  for (const id of ids) {
    const config = settings.mcpServers.find((candidate) => candidate.id === id);
    if (!config) continue;
    if (config.type === "stdio") {
      servers.push({
        name: id,
        command: config.command,
        args: config.args,
        env: Object.entries(config.env).map(([name, value]) => ({ name, value })),
      });
    } else if (config.type === "http") {
      servers.push({
        type: "http",
        name: id,
        url: config.url,
        headers: Object.entries(config.headers).map(([name, value]) => ({ name, value })),
      });
    } else if (config.type === "sse") {
      servers.push({
        type: "sse",
        name: id,
        url: config.url,
        headers: Object.entries(config.headers).map(([name, value]) => ({ name, value })),
      });
    }
  }
  return servers;
}

function enrichNotification(notification: SessionNotification): SessionNotificationFelloExt {
  return {
    ...notification,
    update: {
      ...notification.update,
      _meta: {
        ...notification.update._meta,
        fello: {
          receivedAt: Date.now(),
          displayId: randomUUID(),
        },
      },
    },
  };
}

/** Thrown when a reminder is due while the assistant is streaming or dreaming. */
class AssistantBusyError extends Error {
  constructor() {
    super("Assistant is busy.");
    this.name = "AssistantBusyError";
  }
}

function emptyStatus(config: AssistantConfig | null, assistantId: string): AssistantStatus {
  const paths = assistantPaths(assistantId);
  return {
    connectionStatus: "disconnected",
    sourceAgentId: config?.sourceAgentId ?? null,
    enabled: false,
    workspace: paths.workspace,
    isStreaming: false,
    dreaming: false,
    models: null,
    thoughtLevels: null,
    usage: null,
    lastTurnUsage: null,
  };
}

function createAssistantRuntime(
  ctx: BackendContext,
  deps: AssistantModuleDeps,
  manager: { getConfig: (assistantId: string) => AssistantConfig | null },
  initialConfig: AssistantConfig,
): AssistantModule {
  const assistantId = initialConfig.id;
  const paths = ensureAssistantDirectories(assistantId);
  const storage = new AssistantStorage(paths);
  let runtimeConfig: Pick<AssistantConfig, "sourceAgentId" | "mcpServers" | "dream"> = {
    sourceAgentId: initialConfig.sourceAgentId,
    mcpServers: [...initialConfig.mcpServers],
    dream: { ...initialConfig.dream },
  };
  const getName = () => manager.getConfig(assistantId)?.name ?? "";
  const isEnabled = () => {
    const settings = ctx.storage.getSettings();
    return settings.assistant.enabled && manager.getConfig(assistantId)?.disabled !== true;
  };

  let bridge: ACPBridge | null = null;
  let starting: Promise<void> | null = null;
  let generation = 0;
  let status: AssistantStatus = {
    ...emptyStatus(initialConfig, assistantId),
    enabled: isEnabled(),
  };

  // Wakes are messages injected into the assistant's chat: reminder deliveries and worker
  // events. They wait until the assistant is connected and idle. A reminder wake that cannot be
  // delivered within REMINDER_WAKE_EXPIRY_MS is dropped; worker wakes stay queued until delivered.
  const REMINDER_WAKE_EXPIRY_MS = 60 * 60 * 1000;
  type Wake = {
    key: string;
    at: number;
    expireMs?: number;
    isValid?: () => boolean;
    onDelivered?: () => Promise<void> | void;
    /**
     * Renders the message for one delivery attempt. `attempt` is 1 on the first try and
     * grows after every failed one, so a retry can say so (reminder retries carry
     * retry="N"). A failed attempt also leaves a user message in the model history, so
     * without the marker the model would read the same reminder as repeated user input.
     */
    render: (attempt: number) => string;
    /** Failed delivery attempts so far. The next attempt number is this plus one. */
    failedAttempts?: number;
  };
  const pendingWakes: Wake[] = [];
  let draining = false;
  let drainRetry: ReturnType<typeof setTimeout> | null = null;

  async function publishWorkers(): Promise<void> {
    try {
      ctx.sendEvent("assistant-workers-changed", {
        assistantId,
        workers: await workerManager.list(),
      });
    } catch (error) {
      console.error(`[assistant:${assistantId}] Failed to publish workers:`, error);
    }
  }

  const workerManager = new WorkerManager({
    ctx,
    mcpDeps: deps.mcpDeps,
    assistantSessionId: assistantId,
    workersDir: paths.workersDir,
    workspaceRoot: paths.workspace,
    notify: (text) => {
      enqueueWake({ key: `worker:${randomUUID()}`, render: () => text, at: Date.now() });
    },
    onChange: () => {
      void publishWorkers();
    },
    onNotification: (workerId, notification) => {
      ctx.sendEvent("assistant-worker-update", { assistantId, workerId, notification });
    },
  });
  void workerManager
    .init()
    .then(() => publishWorkers())
    .catch((error) => {
      console.error(`[assistant:${assistantId}] Failed to load workers:`, error);
    });

  const reminders = new ReminderService({
    store: new ReminderStore(paths.remindersPath),
    onDue: (due) => {
      // The native notification is shown when a reminder is due, even if the chat message
      // waits for the assistant to be idle.
      const reminder = reminders.get(due.id);
      if (reminder && !reminder.disabled && !wasFired(reminder, due.dueAt)) {
        ctx.sendEvent("assistant-reminder-due", {
          assistantId,
          name: getName(),
          id: reminder.id,
          text: reminder.text,
          dueAt: due.dueAt,
        });
      }
      enqueueWake({
        key: `reminder:${due.id}:${due.dueAt}`,
        render: (attempt) => {
          // The tag parser and the UI badge only need the leading tag; retry is extra
          // context for the model, which keeps failed attempts in its history.
          const id = reminder?.id ?? due.id;
          // retry counts retries, not attempts: the second delivery carries retry="1".
          const retry = attempt - 1;
          const tag =
            retry > 0 ? `[Reminder id="${id}" retry="${retry}"]` : `[Reminder id="${id}"]`;
          return `${tag} ${reminder?.text ?? ""}`;
        },
        at: due.dueAt,
        expireMs: REMINDER_WAKE_EXPIRY_MS,
        isValid: () => {
          const current = reminders.get(due.id);
          return !!current && !current.disabled && !wasFired(current, due.dueAt);
        },
        onDelivered: () => reminders.markDelivered(due.id, due.dueAt),
      });
    },
    onChange: () => {
      ctx.sendEvent("assistant-reminders-changed", {
        assistantId,
        reminders: reminders.listAll(),
        timeZone: serverTimeZone(),
      });
    },
  });

  function enqueueWake(wake: Wake): void {
    pendingWakes.push(wake);
    void drainWakes();
  }

  function scheduleDrainRetry() {
    if (drainRetry) return;
    drainRetry = setTimeout(() => {
      drainRetry = null;
      void drainWakes();
    }, 60_000);
  }

  async function drainWakes(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (pendingWakes.length > 0) {
        const wake = pendingWakes[0];
        // Expiry and validity are checked before connection state, so a long disconnect
        // still expires or drops outdated items.
        if (wake.expireMs !== undefined && Date.now() - wake.at > wake.expireMs) {
          pendingWakes.shift();
          continue;
        }
        if (wake.isValid && !wake.isValid()) {
          pendingWakes.shift();
          continue;
        }
        if (!bridge?.isConnected || status.isStreaming || status.dreaming) break;
        pendingWakes.shift();
        const attempt = (wake.failedAttempts ?? 0) + 1;
        try {
          await sendPrompt([{ type: "text", text: wake.render(attempt) }], { onlyIfIdle: true });
        } catch (error) {
          // Busy is not a failure: the wake waits for the assistant to become idle.
          if (error instanceof AssistantBusyError) {
            pendingWakes.unshift(wake);
            break;
          }
          console.error(`[assistant:${assistantId}] Failed to deliver wake:`, error);
          // The failed attempt most likely appended its user message to the model history
          // already, so the next delivery is marked as a retry instead of looking like the
          // user sent the same reminder again.
          pendingWakes.unshift({ ...wake, failedAttempts: attempt });
          break;
        }
        await wake.onDelivered?.();
      }
    } finally {
      draining = false;
    }
    if (pendingWakes.length > 0) scheduleDrainRetry();
  }

  function publishStatus() {
    ctx.sendEvent("assistant-status-changed", { assistantId, status });
  }

  function updateStatus(next: Partial<AssistantStatus>) {
    status = {
      ...status,
      ...next,
      enabled: isEnabled(),
      sourceAgentId: runtimeConfig.sourceAgentId,
      workspace: paths.workspace,
    };
    publishStatus();
  }

  const pendingToolCalls = new Map<string, ToolCallUpdate>();
  let activeMessageSegment: import("../../assistant/storage").AssistantMessageSegment | null = null;
  let notificationTail = Promise.resolve();

  function queuePersistAndPublish(
    notification: SessionNotification,
    segment = activeMessageSegment,
  ): Promise<void> {
    const current = notificationTail.then(() => persistAndPublish(notification, segment));
    notificationTail = current.catch(() => {});
    return current;
  }

  async function persistAndPublish(
    notification: SessionNotification,
    segment: import("../../assistant/storage").AssistantMessageSegment | null,
  ): Promise<void> {
    const enriched = enrichNotification(notification);
    const type = enriched.update.sessionUpdate;

    // Same iLink forwarding as regular sessions: the assistant can drive WeChat when selected.
    bufferAgentChunkForIlink(deps.ilink, assistantId, enriched);
    const ilinkActive = deps.ilink.getActiveSessionId() === assistantId;
    if (type === "tool_call" && ilinkActive) {
      void flushIlinkReply(deps.ilink);
      flushIlinkMedia(deps.ilink);
    }

    if (type === "usage_update" || type === "available_commands_update") {
      if (type === "usage_update") {
        const usage = enriched.update as UsageUpdate;
        updateStatus({
          usage: { used: usage.used, size: usage.size, cost: usage.cost },
        });
      }
      ctx.sendEvent("assistant-update", { assistantId, notification: enriched });
      return;
    }
    if (type === "tool_call_update") {
      const update = enriched.update as ToolCallUpdate;
      const key = update.toolCallId;
      if (!update.content && update.rawOutput) {
        const content = findContentBlock(update.rawOutput);
        if (content) update.content = [{ type: "content", content }];
      }
      const prior = pendingToolCalls.get(key);
      if (update.status !== "completed" && update.status !== "failed") {
        pendingToolCalls.set(key, prior ? mergeToolCallUpdate(prior, update) : { ...update });
      } else {
        if (prior)
          enriched.update = mergeToolCallUpdate(
            prior,
            update,
          ) as SessionNotificationFelloExt["update"];
        pendingToolCalls.delete(key);
        const {
          rawInput: _rawInput,
          rawOutput: _rawOutput,
          ...safeUpdate
        } = enriched.update as ToolCallUpdate;
        await storage.appendMessage(
          { ...enriched, update: safeUpdate as SessionNotificationFelloExt["update"] },
          segment ?? undefined,
        );
        if (ilinkActive) flushIlinkMedia(deps.ilink);
      }
    } else {
      await storage.appendMessage(enriched, segment ?? undefined);
    }
    ctx.sendEvent("assistant-update", { assistantId, notification: enriched });
  }

  async function getHistorySegment({ segmentId }: { segmentId?: number }) {
    return storage.readMessageSegment(segmentId);
  }

  async function start(): Promise<void> {
    if (bridge?.isConnected) return;
    if (starting) return starting;

    const current = (async () => {
      const currentGeneration = ++generation;
      if (!isEnabled()) {
        updateStatus({
          connectionStatus: "disconnected",
          error: undefined,
          isStreaming: false,
          models: null,
          thoughtLevels: null,
        });
        return;
      }
      const sourceAgentId = runtimeConfig.sourceAgentId;
      const agentInfo = sourceAgentId ? getAssistantApiAgent(ctx, sourceAgentId) : null;
      if (!agentInfo) {
        updateStatus({
          connectionStatus: "error",
          error: sourceAgentId
            ? "The selected Personal Assistant agent is no longer enabled or compatible."
            : "Select an enabled OpenAI-compatible API agent to use Personal Assistant.",
          isStreaming: false,
          models: null,
          thoughtLevels: null,
        });
        return;
      }

      await mkdir(paths.workspace, { recursive: true });
      if (generation !== currentGeneration) return;
      // Reminders belong to the assistant lifecycle: their timers only run while it is started,
      // so a disabled assistant never pops notifications it cannot deliver.
      await reminders.start().catch((error) => {
        console.error(`[assistant:${assistantId}] Failed to load reminders:`, error);
      });
      updateStatus({
        connectionStatus: "connecting",
        error: undefined,
        enabled: true,
      });

      const nextBridge = new ACPBridge(ASSISTANT_AGENT_ID, {
        agentInfo: {
          id: ASSISTANT_AGENT_ID,
          type: "assistant",
          sessionId: assistantId,
          storage,
          sourceAgent: agentInfo,
          getMcpServers: () => buildAssistantMcpServers(ctx, runtimeConfig.mcpServers),
          getDream: () => runtimeConfig.dream,
          getName,
          reminders,
          worker: workerManager,
          askUser: (options) => deps.askUser.askUser({ sessionId: assistantId, ...options }),
          shareToUser: deps.mcpDeps.shareToUser,
          filesystem: deps.filesystem,
          onDreamStatus: ({ dreaming, error }) => {
            updateStatus({ dreaming, dreamError: error });
            if (!dreaming) void drainWakes();
          },
        },
        cwd: paths.workspace,
        extNotificationSpecs,
        agentEnv,
        onSessionConnect: () => {},
        onSessionUpdate: (notification) => {
          void queuePersistAndPublish(notification).catch((error) => {
            console.error(`[assistant:${assistantId}] Failed to persist notification:`, error);
          });
        },
        onExtNotification: (method, params) => {
          for (const adapter of adapters) {
            const notifications = adapter.handleExtNotification(
              nextBridge,
              method,
              assistantId,
              params,
            );
            if (notifications.length > 0) {
              for (const notification of notifications) {
                void queuePersistAndPublish(notification).catch((error) => {
                  console.error(
                    `[assistant:${assistantId}] Failed to persist notification:`,
                    error,
                  );
                });
              }
              return;
            }
          }
        },
        onPermissionRequest: async () => ({
          outcome: { outcome: "selected", optionId: "deny" },
        }),
        onAgentTerminalOutput: () => {},
      });

      bridge = nextBridge;
      try {
        await nextBridge.connect();
        if (generation !== currentGeneration || bridge !== nextBridge) {
          await nextBridge.kill().catch(() => {});
          return;
        }
        const load = await nextBridge.loadSession({
          sessionId: assistantId,
          cwd: paths.workspace,
          mcpServers: [],
        });
        if (generation !== currentGeneration || bridge !== nextBridge) {
          await nextBridge.kill().catch(() => {});
          return;
        }
        updateStatus({
          connectionStatus: "connected",
          models: load.models ?? nextBridge.getModelState(assistantId) ?? null,
          thoughtLevels: load.thoughtLevels ?? nextBridge.getThoughtLevelState(assistantId) ?? null,
        });
        void drainWakes();
      } catch (error) {
        if (generation !== currentGeneration || bridge !== nextBridge) return;
        bridge = null;
        await nextBridge.kill().catch(() => {});
        updateStatus({
          connectionStatus: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    starting = current;
    void current.finally(() => {
      if (starting === current) starting = null;
    });

    return current;
  }

  async function requireBridge(): Promise<ACPBridge> {
    await start();
    if (!bridge?.isConnected) {
      throw new Error(status.error ?? "Personal Assistant is not connected.");
    }
    return bridge;
  }

  async function sendPrompt(
    contents: ContentBlock[],
    options: { onlyIfIdle?: boolean } = {},
  ): Promise<PromptResult> {
    const activeBridge = await requireBridge();
    // Check and set the busy state with no await in between, so a user prompt and a reminder cannot both start.
    if (options.onlyIfIdle && (status.isStreaming || status.dreaming))
      throw new AssistantBusyError();
    if (status.isStreaming) await cancelPrompt();
    updateStatus({ isStreaming: true });
    ctx.sendEvent("assistant-prompt-start", { assistantId });

    const messageSegment = await storage.beginMessageTurn();
    activeMessageSegment = messageSegment;
    let stopReason: string | undefined;
    let promptError: string | undefined;
    try {
      for (const content of contents) {
        await queuePersistAndPublish(
          {
            sessionId: assistantId,
            update: { sessionUpdate: "user_message_chunk", content },
          },
          messageSegment,
        );
      }
      const result: PromptResult & { usage?: Usage | null } = await activeBridge.sendPrompt({
        sessionId: assistantId,
        prompt: contents,
      });
      stopReason = result.stopReason;
      if (result.error) promptError = result.error;
      if (result.usage) updateStatus({ lastTurnUsage: result.usage });
      return result;
    } catch (error) {
      promptError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await notificationTail;
      // Flush any buffered reply even when the turn was interrupted (or started by a wake).
      if (deps.ilink.getActiveSessionId() === assistantId) {
        await flushIlinkReply(deps.ilink);
        flushIlinkMedia(deps.ilink);
      }
      storage.endMessageTurn(messageSegment);
      if (activeMessageSegment === messageSegment) {
        activeMessageSegment = null;
      }
      updateStatus({ isStreaming: false });
      ctx.sendEvent("assistant-prompt-end", {
        assistantId,
        ...(stopReason ? { stopReason } : {}),
        ...(promptError ? { error: promptError } : {}),
      });
      void drainWakes();
    }
  }

  async function cancelPrompt(): Promise<void> {
    if (!bridge?.isConnected) return;
    await bridge.cancel({ sessionId: assistantId }).catch(() => {});
  }

  async function setModel(modelId: string): Promise<void> {
    const activeBridge = await requireBridge();
    await activeBridge.setSessionModel({ sessionId: assistantId, modelId });
    updateStatus({ models: activeBridge.getModelState(assistantId) ?? status.models });
  }

  async function setThoughtLevel(thoughtLevelId: string): Promise<void> {
    const activeBridge = await requireBridge();
    await activeBridge.setThoughtLevel({
      sessionId: assistantId,
      thoughtLevelId,
    });
    updateStatus({
      thoughtLevels: activeBridge.getThoughtLevelState(assistantId) ?? status.thoughtLevels,
    });
  }

  async function stop(options: { shutdownWorkers?: boolean } = {}): Promise<void> {
    generation += 1;
    const activeBridge = bridge;
    bridge = null;
    starting = null;
    reminders.stop();
    if (drainRetry) {
      clearTimeout(drainRetry);
      drainRetry = null;
    }
    updateStatus({
      connectionStatus: "disconnected",
      isStreaming: false,
      dreaming: false,
      dreamError: undefined,
    });
    await activeBridge?.kill().catch(() => {});
    if (options.shutdownWorkers) await workerManager.shutdown().catch(() => {});
  }

  async function restart(): Promise<void> {
    const config = manager.getConfig(assistantId);
    runtimeConfig = {
      sourceAgentId: config?.sourceAgentId ?? null,
      mcpServers: [...(config?.mcpServers ?? [])],
      dream: { ...(config?.dream ?? runtimeConfig.dream) },
    };
    await stop();
    await start();
  }

  /** Final cleanup. Order matters: abort the assistant first, then cancel every worker. */
  async function shutdown(): Promise<void> {
    if (drainRetry) {
      clearTimeout(drainRetry);
      drainRetry = null;
    }
    pendingWakes.length = 0;
    await stop();
    await workerManager.shutdown();
  }

  return {
    start,
    stop,
    restart,
    shutdown,
    getStatus: () => status,
    dismissDreamError: () => {
      if (status.dreamError) updateStatus({ dreamError: undefined });
    },
    dreamNow: async () => {
      if (!bridge?.isConnected) return { started: false, reason: "not-connected" };
      return bridge.runDreamNow();
    },
    listReminders: async () => {
      // Loads reminders even before the assistant starts, so the calendar never shows an empty list.
      await reminders.load().catch((error) => {
        console.error(`[assistant:${assistantId}] Failed to load reminders:`, error);
      });
      return { reminders: reminders.listAll(), timeZone: serverTimeZone() };
    },
    listDiaries: () => listDiarySummaries(paths.diaryDir),
    readDiary: (file: string) => readDiary(paths.diaryDir, file),
    readMemory: async () => ({ content: await storage.loadMemory() }),
    listWorkers: () => workerManager.list(),
    readWorkerHistorySegment: (params) => workerManager.readHistorySegment(params),
    getHistorySegment,
    sendPrompt,
    cancelPrompt,
    setModel,
    setThoughtLevel,
  };
}

function nextAssistantName(existing: AssistantConfig[]): string {
  // Same N as the create dialog placeholder. Duplicate names are allowed by design.
  return t("assistant.defaultName", { n: existing.length + 1 });
}

export function createAssistantManager(
  ctx: BackendContext,
  deps: AssistantModuleDeps,
): AssistantManager {
  const configs = new Map<string, AssistantConfig>(
    listAssistantConfigs().map((config) => [config.id, config]),
  );
  const runtimes = new Map<string, AssistantModule>();

  const getConfig = (assistantId: string): AssistantConfig | null =>
    configs.get(assistantId) ?? null;

  function emitConfigs(): void {
    ctx.sendEvent(
      "assistants-changed",
      [...configs.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    );
  }

  function ensureRuntime(config: AssistantConfig): AssistantModule {
    const existing = runtimes.get(config.id);
    if (existing) return existing;
    const runtime = createAssistantRuntime(ctx, deps, { getConfig }, config);
    runtimes.set(config.id, runtime);
    return runtime;
  }

  function requireRuntime(assistantId: string): AssistantModule {
    const config = configs.get(assistantId);
    if (!config) throw new Error(`Assistant ${assistantId} does not exist.`);
    return ensureRuntime(config);
  }

  function isGloballyEnabled(): boolean {
    return ctx.storage.getSettings().assistant.enabled;
  }

  async function startAll(): Promise<void> {
    if (!isGloballyEnabled()) return;
    const tasks = [...configs.values()]
      .filter((config) => !config.disabled)
      .map(async (config) => {
        try {
          await ensureRuntime(config).start();
        } catch (error) {
          console.error(`[assistant:${config.id}] Failed to start:`, error);
        }
      });
    await Promise.allSettled(tasks);
  }

  function validateDream(assistantId: string, config: AssistantConfig): void {
    const agentId = config.sourceAgentId;
    const agent = agentId
      ? ctx.storage.getSettings().agents.find((candidate) => candidate.id === agentId)
      : undefined;
    const contextWindowTokens =
      agent?.type === "api" ? (agent.contextWindowTokens ?? 128_000) : 128_000;
    if (
      !Number.isSafeInteger(config.dream.maxContextTokens) ||
      config.dream.maxContextTokens <= 0 ||
      config.dream.maxContextTokens > contextWindowTokens
    ) {
      throw new Error(
        `Dream max context tokens must be a positive integer up to ${contextWindowTokens}.`,
      );
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.dream.preferredTime)) {
      throw new Error("Dream preferred time must use HH:mm format.");
    }
    void assistantId;
  }

  async function applySettingsChange(previous: SettingsInfo, current: SettingsInfo): Promise<void> {
    const enabledChanged = previous.assistant.enabled !== current.assistant.enabled;
    if (enabledChanged) {
      if (!current.assistant.enabled) {
        await Promise.allSettled([...runtimes.values()].map((runtime) => runtime.shutdown()));
        runtimes.clear();
        return;
      }
      await startAll();
    }
    if (!current.assistant.enabled) return;

    const changedAgents = new Set<string>();
    const oldAgents = new Map(previous.agents.map((agent) => [agent.id, agent]));
    const newAgents = new Map(current.agents.map((agent) => [agent.id, agent]));
    for (const [id, oldAgent] of oldAgents) {
      const newAgent = newAgents.get(id);
      if (!newAgent || JSON.stringify(oldAgent) !== JSON.stringify(newAgent)) {
        changedAgents.add(id);
      }
    }
    for (const id of newAgents.keys()) {
      if (!oldAgents.has(id)) changedAgents.add(id);
    }

    const changedMcp = new Set<string>();
    const oldMcp = new Map(previous.mcpServers.map((server) => [server.id, server]));
    const newMcp = new Map(current.mcpServers.map((server) => [server.id, server]));
    for (const [id, oldServer] of oldMcp) {
      const newServer = newMcp.get(id);
      if (!newServer || JSON.stringify(oldServer) !== JSON.stringify(newServer)) {
        changedMcp.add(id);
      }
    }
    for (const id of newMcp.keys()) {
      if (!oldMcp.has(id)) changedMcp.add(id);
    }

    for (const config of configs.values()) {
      if (config.disabled) continue;
      const runtime = runtimes.get(config.id);
      if (!runtime) continue;
      const agentChanged = config.sourceAgentId ? changedAgents.has(config.sourceAgentId) : false;
      const mcpChanged = config.mcpServers.some((id) => changedMcp.has(id));
      if (agentChanged || mcpChanged) {
        await runtime.restart().catch((error) => {
          console.error(`[assistant:${config.id}] Failed to apply settings:`, error);
        });
      }
    }
  }

  return {
    startAll,
    shutdown: async () => {
      await Promise.allSettled([...runtimes.values()].map((runtime) => runtime.shutdown()));
      runtimes.clear();
    },
    isAssistantSession: (assistantId) => configs.has(assistantId),
    listConfigs: () =>
      [...configs.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    getConfig,
    getStatus: (assistantId) => {
      const config = configs.get(assistantId);
      const runtime = runtimes.get(assistantId);
      if (runtime) return runtime.getStatus();
      return {
        ...emptyStatus(config ?? null, assistantId),
        enabled: !!config && !config.disabled && isGloballyEnabled(),
      };
    },
    dismissDreamError: (assistantId) => {
      runtimes.get(assistantId)?.dismissDreamError();
    },
    dreamNow: (assistantId) => requireRuntime(assistantId).dreamNow(),
    start: async (assistantId) => {
      await requireRuntime(assistantId).start();
    },
    create: async (input) => {
      const config = createAssistantConfig({
        ...input,
        name: input.name?.trim() || nextAssistantName([...configs.values()]),
      });
      configs.set(config.id, config);
      emitConfigs();
      if (!config.disabled && isGloballyEnabled()) {
        await ensureRuntime(config)
          .start()
          .catch((error) => {
            console.error(`[assistant:${config.id}] Failed to start:`, error);
          });
      }
      return config;
    },
    updateConfig: async (assistantId, patch) => {
      if (!configs.has(assistantId)) {
        throw new Error(`Assistant ${assistantId} does not exist.`);
      }
      const next = updateAssistantConfig(assistantId, patch);
      configs.set(assistantId, next);
      emitConfigs();
      const runtime = runtimes.get(assistantId);
      if (patch.disabled === true) {
        if (runtime) {
          await runtime.shutdown().catch(() => {});
          runtimes.delete(assistantId);
        }
      } else if (patch.disabled === false) {
        await ensureRuntime(next)
          .start()
          .catch((error) => {
            console.error(`[assistant:${assistantId}] Failed to start:`, error);
          });
      }
      return next;
    },
    restart: async (assistantId, patch) => {
      const current = configs.get(assistantId) ?? loadAssistantConfig(assistantId);
      if (!current) throw new Error(`Assistant ${assistantId} does not exist.`);
      let next = current;
      if (patch) {
        const candidate: AssistantConfig = {
          ...current,
          ...patch,
          dream: { ...(patch.dream ?? current.dream) },
        };
        validateDream(assistantId, candidate);
        next = updateAssistantConfig(assistantId, patch);
        configs.set(assistantId, next);
      }
      emitConfigs();
      const runtime = runtimes.get(assistantId);
      if (runtime) {
        await runtime.restart();
      } else if (!next.disabled && isGloballyEnabled()) {
        await ensureRuntime(next)
          .start()
          .catch((error) => {
            console.error(`[assistant:${assistantId}] Failed to start:`, error);
          });
      }
      return next;
    },
    delete: async (assistantId) => {
      if (!configs.has(assistantId)) throw new Error(`Assistant ${assistantId} does not exist.`);
      const runtime = runtimes.get(assistantId);
      if (runtime) {
        await runtime.shutdown().catch(() => {});
        runtimes.delete(assistantId);
      }
      configs.delete(assistantId);
      try {
        deleteAssistantData(assistantId);
      } finally {
        emitConfigs();
      }
    },
    applySettingsChange,
    listReminders: (assistantId) => requireRuntime(assistantId).listReminders(),
    listDiaries: (assistantId) => requireRuntime(assistantId).listDiaries(),
    readDiary: (assistantId, file) => requireRuntime(assistantId).readDiary(file),
    readMemory: (assistantId) => requireRuntime(assistantId).readMemory(),
    listWorkers: (assistantId) => requireRuntime(assistantId).listWorkers(),
    readWorkerHistorySegment: (assistantId, params) =>
      requireRuntime(assistantId).readWorkerHistorySegment(params),
    getHistorySegment: (assistantId, params) =>
      requireRuntime(assistantId).getHistorySegment(params),
    sendPrompt: (assistantId, contents, options) =>
      requireRuntime(assistantId).sendPrompt(contents, options),
    cancelPrompt: (assistantId) => requireRuntime(assistantId).cancelPrompt(),
    setModel: (assistantId, modelId) => requireRuntime(assistantId).setModel(modelId),
    setThoughtLevel: (assistantId, thoughtLevelId) =>
      requireRuntime(assistantId).setThoughtLevel(thoughtLevelId),
  };
}
