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
  AssistantStatus,
  AssistantWorkerInfo,
  SessionNotificationFelloExt,
} from "../../shared/schema";
import type { AssistantReminderList } from "../../shared/schema";
import { serverTimeZone } from "../../assistant/reminders/service";
import { wasFired } from "../../shared/reminder";
import { ASSISTANT_AGENT_ID, ASSISTANT_SESSION_ID } from "../../assistant/constants";
import {
  appendAssistantMessage,
  type AssistantMessageSegment,
  beginAssistantMessageTurn,
  endAssistantMessageTurn,
  readAssistantMessageSegment,
} from "../../assistant/storage";
import { ACPBridge, type PromptResult } from "../agent/agent-bridge";
import { CATCH_UP_WINDOW_MS, ReminderService } from "../../assistant/reminders/service";
import { ReminderStore } from "../../assistant/reminders/store";
import { adapters, agentEnv, extNotificationSpecs } from "../acp-adapters/adapters";
import { ASSISTANT_WORKSPACE } from "../storage/constant";
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

export interface AssistantModule {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Stops the assistant bridge, workers and reminder timers. Called on app shutdown. */
  shutdown: () => Promise<void>;
  getStatus: () => AssistantStatus;
  listReminders: () => AssistantReminderList;
  listWorkers: () => Promise<AssistantWorkerInfo[]>;
  getHistorySegment: (params: {
    segmentId?: number;
  }) => ReturnType<typeof readAssistantMessageSegment>;
  sendPrompt: (contents: ContentBlock[], options?: { onlyIfIdle?: boolean }) => Promise<PromptResult>;
  cancelPrompt: () => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setThoughtLevel: (thoughtLevelId: string) => Promise<void>;
  refreshConfiguration: () => Promise<void>;
}

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
function buildAssistantMcpServers(ctx: BackendContext): McpServer[] {
  const settings = ctx.storage.getSettings();
  const servers: McpServer[] = [];
  for (const id of settings.assistant.mcpServers) {
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

export function createAssistantModule(
  ctx: BackendContext,
  deps: {
    askUser: AskUserModule;
    filesystem: FileSystemTools;
    mcpDeps: McpConfigDeps;
    ilink: IlinkState;
  },
): AssistantModule {
  let bridge: ACPBridge | null = null;
  let starting: Promise<void> | null = null;
  let generation = 0;
  let status: AssistantStatus = {
    connectionStatus: "disconnected",
    sourceAgentId: null,
    enabled: false,
    workspace: ASSISTANT_WORKSPACE,
    isStreaming: false,
    dreaming: false,
    models: null,
    thoughtLevels: null,
    usage: null,
    lastTurnUsage: null,
  };

  // Wakes are messages injected into the assistant's chat: reminder deliveries and worker
  // events. They wait until the assistant is connected and idle. Reminder wakes expire after
  // CATCH_UP_WINDOW_MS; worker wakes stay queued until delivered.
  type Wake = {
    key: string;
    text: string;
    at: number;
    expireMs?: number;
    isValid?: () => boolean;
    onDelivered?: () => Promise<void> | void;
  };
  const pendingWakes: Wake[] = [];
  let draining = false;
  let drainRetry: ReturnType<typeof setTimeout> | null = null;

  async function publishWorkers(): Promise<void> {
    try {
      ctx.sendEvent("assistant-workers-changed", await workerManager.list());
    } catch (error) {
      console.error("[assistant] Failed to publish workers:", error);
    }
  }

  const workerManager = new WorkerManager({
    ctx,
    mcpDeps: deps.mcpDeps,
    workspaceRoot: ASSISTANT_WORKSPACE,
    notify: (text) => {
      enqueueWake({ key: `worker:${randomUUID()}`, text, at: Date.now() });
    },
    onChange: () => {
      void publishWorkers();
    },
  });
  void workerManager
    .init()
    .then(() => publishWorkers())
    .catch((error) => {
      console.error("[assistant] Failed to load workers:", error);
    });

  const reminders = new ReminderService({
    store: new ReminderStore(),
    onDue: (due) => {
      // The native notification is shown when a reminder is due, even if the chat message
      // waits for the assistant to be idle.
      const reminder = reminders.get(due.id);
      if (reminder && !reminder.disabled && !wasFired(reminder, due.dueAt)) {
        ctx.sendEvent("assistant-reminder-due", {
          id: reminder.id,
          text: reminder.text,
          dueAt: due.dueAt,
        });
      }
      enqueueWake({
        key: `reminder:${due.id}:${due.dueAt}`,
        text: `[Reminder id="${reminder?.id ?? due.id}"] ${reminder?.text ?? ""}`,
        at: due.dueAt,
        expireMs: CATCH_UP_WINDOW_MS,
        isValid: () => {
          const current = reminders.get(due.id);
          return !!current && !current.disabled && !wasFired(current, due.dueAt);
        },
        onDelivered: () => reminders.markDelivered(due.id, due.dueAt),
      });
    },
    onChange: () => {
      ctx.sendEvent("assistant-reminders-changed", {
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
        try {
          await sendPrompt([{ type: "text", text: wake.text }], { onlyIfIdle: true });
        } catch (error) {
          // Busy is not a failure: the wake waits for the assistant to become idle.
          if (!(error instanceof AssistantBusyError)) {
            console.error("[assistant] Failed to deliver wake:", error);
          }
          pendingWakes.unshift(wake);
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
    ctx.sendEvent("assistant-status-changed", { status });
  }

  function updateStatus(next: Partial<AssistantStatus>) {
    const { enabled, sourceAgentId } = ctx.storage.getSettings().assistant;
    status = { ...status, ...next, enabled, sourceAgentId };
    publishStatus();
  }

  const pendingToolCalls = new Map<string, ToolCallUpdate>();
  let activeMessageSegment: AssistantMessageSegment | null = null;
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
    segment: AssistantMessageSegment | null,
  ): Promise<void> {
    const enriched = enrichNotification(notification);
    const type = enriched.update.sessionUpdate;

    // Same iLink forwarding as regular sessions: the assistant can drive WeChat when selected.
    bufferAgentChunkForIlink(deps.ilink, ASSISTANT_SESSION_ID, enriched);
    const ilinkActive = deps.ilink.getActiveSessionId() === ASSISTANT_SESSION_ID;
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
      ctx.sendEvent("assistant-update", { notification: enriched });
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
        await appendAssistantMessage(
          { ...enriched, update: safeUpdate as SessionNotificationFelloExt["update"] },
          segment ?? undefined,
        );
        if (ilinkActive) flushIlinkMedia(deps.ilink);
      }
    } else {
      await appendAssistantMessage(enriched, segment ?? undefined);
    }
    ctx.sendEvent("assistant-update", { notification: enriched });
  }

  async function getHistorySegment({ segmentId }: { segmentId?: number }) {
    return readAssistantMessageSegment(segmentId);
  }

  async function start(): Promise<void> {
    if (bridge?.isConnected) return;
    if (starting) return starting;

    starting = (async () => {
      const currentGeneration = ++generation;
      const { enabled, sourceAgentId } = ctx.storage.getSettings().assistant;
      if (!enabled) {
        updateStatus({
          connectionStatus: "disconnected",
          error: undefined,
          enabled: false,
          isStreaming: false,
          models: null,
          thoughtLevels: null,
        });
        return;
      }
      const agentInfo = sourceAgentId ? getAssistantApiAgent(ctx, sourceAgentId) : null;
      if (!agentInfo) {
        updateStatus({
          connectionStatus: "error",
          error: sourceAgentId
            ? "The selected Personal Assistant agent is no longer enabled or compatible."
            : "Select an enabled OpenAI-compatible API agent to use Personal Assistant.",
          sourceAgentId,
          isStreaming: false,
          models: null,
          thoughtLevels: null,
        });
        return;
      }

      await mkdir(ASSISTANT_WORKSPACE, { recursive: true });
      if (generation !== currentGeneration) return;
      updateStatus({
        connectionStatus: "connecting",
        error: undefined,
        sourceAgentId,
        enabled: true,
      });

      const nextBridge = new ACPBridge(ASSISTANT_AGENT_ID, {
        agentInfo: {
          id: ASSISTANT_AGENT_ID,
          type: "assistant",
          sourceAgent: agentInfo,
          getMcpServers: () => buildAssistantMcpServers(ctx),
          getDream: () => ctx.storage.getSettings().assistant.dream,
          getName: () => ctx.storage.getSettings().assistant.name,
          reminders,
          worker: workerManager,
          askUser: (options) =>
            deps.askUser.askUser({ sessionId: ASSISTANT_SESSION_ID, ...options }),
          shareToUser: deps.mcpDeps.shareToUser,
          filesystem: deps.filesystem,
          onDreamStatus: ({ dreaming, error }) => {
            updateStatus({ dreaming, dreamError: error });
            if (!dreaming) void drainWakes();
          },
        },
        cwd: ASSISTANT_WORKSPACE,
        extNotificationSpecs,
        agentEnv,
        onSessionConnect: () => {},
        onSessionUpdate: (notification) => {
          void queuePersistAndPublish(notification).catch((error) => {
            console.error("[assistant] Failed to persist notification:", error);
          });
        },
        onExtNotification: (method, params) => {
          for (const adapter of adapters) {
            const notifications = adapter.handleExtNotification(
              nextBridge,
              method,
              ASSISTANT_SESSION_ID,
              params,
            );
            if (notifications.length > 0) {
              for (const notification of notifications) {
                void queuePersistAndPublish(notification).catch((error) => {
                  console.error("[assistant] Failed to persist notification:", error);
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
          sessionId: ASSISTANT_SESSION_ID,
          cwd: ASSISTANT_WORKSPACE,
          mcpServers: [],
        });
        if (generation !== currentGeneration || bridge !== nextBridge) {
          await nextBridge.kill().catch(() => {});
          return;
        }
        updateStatus({
          connectionStatus: "connected",
          models: load.models ?? nextBridge.getModelState(ASSISTANT_SESSION_ID) ?? null,
          thoughtLevels:
            load.thoughtLevels ?? nextBridge.getThoughtLevelState(ASSISTANT_SESSION_ID) ?? null,
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
    })().finally(() => {
      starting = null;
    });

    return starting;
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
    if (options.onlyIfIdle && (status.isStreaming || status.dreaming)) throw new AssistantBusyError();
    if (status.isStreaming) await cancelPrompt();
    updateStatus({ isStreaming: true });
    ctx.sendEvent("assistant-prompt-start", undefined);

    const messageSegment = await beginAssistantMessageTurn();
    activeMessageSegment = messageSegment;
    try {
      for (const content of contents) {
        await queuePersistAndPublish(
          {
            sessionId: ASSISTANT_SESSION_ID,
            update: { sessionUpdate: "user_message_chunk", content },
          },
          messageSegment,
        );
      }
      const result: PromptResult & { usage?: Usage | null } = await activeBridge.sendPrompt({
        sessionId: ASSISTANT_SESSION_ID,
        prompt: contents,
      });
      if (result.usage) updateStatus({ lastTurnUsage: result.usage });
      return result;
    } finally {
      await notificationTail;
      // Flush any buffered reply even when the turn was interrupted (or started by a wake).
      if (deps.ilink.getActiveSessionId() === ASSISTANT_SESSION_ID) {
        await flushIlinkReply(deps.ilink);
        flushIlinkMedia(deps.ilink);
      }
      endAssistantMessageTurn(messageSegment);
      if (activeMessageSegment?.id === messageSegment.id) {
        activeMessageSegment = null;
      }
      updateStatus({ isStreaming: false });
      ctx.sendEvent("assistant-prompt-end", undefined);
      void drainWakes();
    }
  }

  async function cancelPrompt(): Promise<void> {
    if (!bridge?.isConnected) return;
    await bridge.cancel({ sessionId: ASSISTANT_SESSION_ID }).catch(() => {});
  }

  async function setModel(modelId: string): Promise<void> {
    const activeBridge = await requireBridge();
    await activeBridge.setSessionModel({ sessionId: ASSISTANT_SESSION_ID, modelId });
    updateStatus({ models: activeBridge.getModelState(ASSISTANT_SESSION_ID) ?? status.models });
  }

  async function setThoughtLevel(thoughtLevelId: string): Promise<void> {
    const activeBridge = await requireBridge();
    await activeBridge.setThoughtLevel({
      sessionId: ASSISTANT_SESSION_ID,
      thoughtLevelId,
    });
    updateStatus({
      thoughtLevels:
        activeBridge.getThoughtLevelState(ASSISTANT_SESSION_ID) ?? status.thoughtLevels,
    });
  }

  async function refreshConfiguration(): Promise<void> {
    await cancelPrompt();
    await stop();
    await start();
  }

  async function stop(): Promise<void> {
    generation += 1;
    const activeBridge = bridge;
    bridge = null;
    starting = null;
    updateStatus({ connectionStatus: "disconnected", isStreaming: false });
    await activeBridge?.kill().catch(() => {});
  }

  /**
   * Final cleanup. Order matters: abort the assistant first (its ACP agent's
   * abortAll runs when the bridge closes), then cancel every worker.
   */
  async function shutdown(): Promise<void> {
    reminders.stop();
    if (drainRetry) {
      clearTimeout(drainRetry);
      drainRetry = null;
    }
    pendingWakes.length = 0;
    await stop();
    await workerManager.shutdown();
  }

  void reminders.start().catch((error) => {
    console.error("[assistant] Failed to load reminders:", error);
  });

  return {
    start,
    stop,
    shutdown,
    getStatus: () => status,
    listReminders: () => ({ reminders: reminders.listAll(), timeZone: serverTimeZone() }),
    listWorkers: () => workerManager.list(),
    getHistorySegment,
    sendPrompt,
    cancelPrompt,
    setModel,
    setThoughtLevel,
    refreshConfiguration,
  };
}
