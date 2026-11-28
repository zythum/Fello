import { createHash, randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { basename, join } from "path";
import type {
  McpServer,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { ACPBridge } from "../../agent/agent-bridge";
import { resolveAgentInfo } from "../../agent/resolve-agent-info";
import { adapters, agentEnv, extNotificationSpecs } from "../../acp-adapters/adapters";
import type { BackendContext } from "../../types";
import type {
  AssistantWorkerHistorySegment,
  Feature,
  ProjectInfo,
  SessionNotificationFelloExt,
} from "../../../shared/schema";
import { HISTORY_PAGE_SIZE, WORKER_FEATURES } from "../../../shared/constants";
import { assertWritablePath, resolveAssistantPath } from "../../../assistant/fs/path";
import { generateSocketPath, startSocketServer, type SocketServer } from "../../socket-server";
import { buildMcpServersConfig, type McpConfigDeps } from "../../session/mcp-config";
import {
  buildConversationTurns,
  truncateConversationTurn,
  type ConversationTurn,
} from "../../../shared/conversation";
import type {
  WorkerConnectionStatus,
  WorkerCreateInput,
  WorkerCreateResult,
  WorkerLifecycleStatus,
  WorkerListItem,
  WorkerPermissionDecision,
  WorkerReadInput,
  WorkerReadResult,
  WorkerSendInput,
  WorkerSendResult,
  WorkerService,
  WorkerStatusResult,
  WorkerTypeInfo,
} from "../../../assistant/worker/types";
import { WorkerStore, type WorkerRecord, type WorkerTurn } from "./store";

/** A permission request left unanswered is denied after this long. */
const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Appended to every worker prompt. The worker is somebody else's agent, so the reporting
 * contract has to travel with the prompt rather than live in a system prompt we don't own.
 * The block is wrapped in [META] so chat bubbles hide it from the user.
 */
const WORKER_REPORT_FOOTER = [
  "",
  "",
  "[META]",
  "When this turn is done, end your reply with a short report in this shape:",
  "",
  "```text",
  "Status: done|blocked",
  "Done: <what you finished>",
  "Files: <paths you created or changed>",
  "Blockers: <what stopped you, or none>",
  "```",
  "[/META]",
].join("\n");

const SUMMARY_ASSISTANT_CHARS = 600;
const FULL_ASSISTANT_CHARS = 8_000;
const SUMMARY_PROMPT_CHARS = 200;
const FULL_PROMPT_CHARS = 2_000;
const SUMMARY_TOOL_CHARS = 200;
const FULL_TOOL_CHARS = 4_000;

type PermissionOption = { optionId: string; kind: string; name: string };

type PendingPermission = {
  permissionId: string;
  workerId: string;
  title: string;
  input: string | null;
  options: PermissionOption[];
  finish: (optionId: string | null) => void;
};

type WorkerHandle = {
  record: WorkerRecord;
  bridge: ACPBridge | null;
  connectPromise: Promise<ACPBridge> | null;
  running: { turnId: string; startedAt: number; text: string } | null;
  /** Socket server for this worker's feature MCP servers. */
  socketServer: SocketServer | null;
  /** True while connecting/loading, when the agent may replay old notifications. */
  suppressNotifications: boolean;
  /** Set by terminate: late notifications and prompt completion must not write again. */
  terminated: boolean;
};

type SegmentCacheEntry = {
  size: number;
  mtimeMs: number;
  turns: ConversationTurn[];
};

export type WorkerManagerOptions = {
  ctx: BackendContext;
  /** Feature MCP builders shared with the session layer. */
  mcpDeps: McpConfigDeps;
  /** Pseudo session id of the owning assistant (used by ask_user / share routes). */
  assistantSessionId: string;
  /** Directory holding all worker records for this assistant. */
  workersDir: string;
  /** Default root for relative workspaces, i.e. the assistant's own workspace. */
  workspaceRoot: string;
  /**
   * Assistant runtime directories a worker must not write to. Comes from the host
   * (`assistantProtectedRoots(FELLO_DIR)`), same value the fs tools use.
   */
  protectedWriteRoots: readonly string[];
  /** Queues a message for the assistant's next turn. */
  notify: (text: string) => void;
  /** Called after any worker state or connection change, for the UI panel. */
  onChange?: () => void;
  /** Called for every persisted notification, for the read-only worker detail view. */
  onNotification?: (workerId: string, notification: SessionNotificationFelloExt) => void;
};

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function enrich(notification: SessionNotification): SessionNotificationFelloExt {
  const meta = notification.update._meta as
    | { fello?: { receivedAt?: number; displayId?: string } }
    | null
    | undefined;
  return {
    ...notification,
    update: {
      ...notification.update,
      _meta: {
        ...(notification.update._meta ?? {}),
        fello: {
          ...meta?.fello,
          receivedAt: Date.now(),
          displayId: meta?.fello?.displayId ?? randomUUID(),
        },
      },
    },
  };
}

function messageText(notification: SessionNotification): string | null {
  const content = (notification.update as { content?: { type?: string; text?: string } }).content;
  return content?.type === "text" && typeof content.text === "string" ? content.text : null;
}

export class WorkerManager implements WorkerService {
  private readonly store: WorkerStore;
  private readonly handles = new Map<string, WorkerHandle>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly segmentCache = new Map<string, SegmentCacheEntry>();
  private shuttingDown = false;

  constructor(private readonly options: WorkerManagerOptions) {
    this.store = new WorkerStore(options.workersDir);
  }

  private notifyChange(): void {
    this.options.onChange?.();
  }

  /**
   * Marks workers that were mid-turn when the process died as interrupted. No wake
   * is queued: recovery is the assistant's job (worker_status / worker_read /
   * worker_send). A clean shutdown cancels its turns, so those stay idle.
   */
  listTypes(): WorkerTypeInfo[] {
    const settings = this.options.ctx.storage.getSettings();
    return settings.assistant.workerTypes
      .filter(
        (type) =>
          type.enabled &&
          type.agentId &&
          settings.agents.some((agent) => agent.id === type.agentId && !agent.disabled),
      )
      .map((type) => ({
        id: type.id,
        name: type.name,
        description: type.description,
        agentId: type.agentId,
        features: type.features.filter((feature) => WORKER_FEATURES.includes(feature)),
        mcpServers: type.mcpServers.slice(),
      }));
  }

  async init(): Promise<void> {
    await this.store.load();
    for (const record of this.store.list()) {
      let changed = false;
      // Old records predate turnCount; backfill once from the authoritative turns log.
      if (record.turnCount == null) {
        record.turnCount = (await this.store.readTurns(record.id)).length;
        changed = true;
      }
      if (record.status === "running" || record.status === "awaiting_permission") {
        record.status = "interrupted";
        record.lastActiveAt = Date.now();
        changed = true;
      }
      if (changed) await this.store.upsert(record);
    }
    this.notifyChange();
  }

  async create(input: WorkerCreateInput): Promise<WorkerCreateResult> {
    const settings = this.options.ctx.storage.getSettings();
    const requestedTypeId = input.typeId?.trim() ?? "";
    const available = settings.assistant.workerTypes
      .filter(
        (candidate) =>
          candidate.enabled &&
          candidate.agentId &&
          settings.agents.some((agent) => agent.id === candidate.agentId && !agent.disabled),
      )
      .map((candidate) => candidate.id)
      .join(", ");
    if (!requestedTypeId) {
      throw new Error(
        `Choose a worker type explicitly.${available ? ` Available: ${available}.` : ""}`,
      );
    }
    const requested = requestedTypeId.toLowerCase();
    const type = settings.assistant.workerTypes.find(
      (candidate) =>
        candidate.enabled &&
        (candidate.id.toLowerCase() === requested || candidate.name.toLowerCase() === requested),
    );
    if (!type) {
      throw new Error(
        `Unknown or disabled worker type "${requestedTypeId}".${available ? ` Available: ${available}.` : ""}`,
      );
    }
    const agentId = type.agentId;
    if (!agentId) {
      throw new Error(
        `Worker type "${type.name}" has no agent configured. Ask the user to update Settings → Personal Assistant → Worker types.`,
      );
    }
    const agent = settings.agents.find((candidate) => candidate.id === agentId);
    if (!agent || agent.disabled) {
      throw new Error(
        `Worker agent "${agentId}" is missing or disabled. Ask the user to update Settings → Personal Assistant → Worker types.`,
      );
    }

    const cwd = resolveAssistantPath(input.workspace, this.options.workspaceRoot);
    assertWritablePath(cwd, this.options.protectedWriteRoots);
    await mkdir(cwd, { recursive: true });

    const now = Date.now();
    const record: WorkerRecord = {
      id: `w_${randomUUID().slice(0, 8)}`,
      name: input.name?.trim() || basename(cwd),
      agentId,
      modelId: type.modelId,
      permissionMode: type.permissionMode ?? "ask",
      typeId: type.id,
      typeName: type.name,
      features: type.features.filter((feature) => WORKER_FEATURES.includes(feature)),
      mcpServers: type.mcpServers.slice(),
      instructions: type.instructions.trim(),
      cwd,
      resumeId: null,
      status: "idle",
      createdAt: now,
      lastActiveAt: now,
      turnCount: 0,
      lastStopReason: null,
      lastError: null,
    };
    await this.store.upsert(record);
    this.handles.set(record.id, {
      record,
      bridge: null,
      connectPromise: null,
      running: null,
      socketServer: null,
      suppressNotifications: false,
      terminated: false,
    });
    this.notifyChange();
    return { workerId: record.id, cwd, typeId: type.id, typeName: type.name };
  }

  async send(input: WorkerSendInput): Promise<WorkerSendResult> {
    const handle = await this.requireHandle(input.workerId);
    if (handle.terminated) throw new Error(`Worker ${input.workerId} is being terminated.`);
    // Check before connecting so a busy worker does not trigger a needless reload.
    this.assertIdle(handle);
    const bridge = await this.ensureBridge(handle);
    // Re-check after the await: two concurrent sends must not both start a prompt.
    this.assertIdle(handle);
    if (!handle.record.resumeId) throw new Error(`Worker ${input.workerId} has no ACP session.`);

    const turnId = randomUUID();
    const startedAt = Date.now();
    const instructions = handle.record.instructions?.trim();
    const prompt = `${instructions ? `${instructions}\n\n---\n` : ""}${input.message}${WORKER_REPORT_FOOTER}`;

    const segmentId = await this.store.beginTurn(handle.record.id);
    await this.store.append(handle.record.id, {
      sessionId: handle.record.resumeId,
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: prompt },
        _meta: { fello: { receivedAt: startedAt, displayId: turnId } },
      },
    });
    await this.store.appendTurn(handle.record.id, {
      turnId,
      prompt,
      startedAt,
      endedAt: null,
      stopReason: null,
      error: null,
      segmentId,
    });

    handle.running = { turnId, startedAt, text: "" };
    handle.record.status = "running";
    handle.record.turnCount = (handle.record.turnCount ?? 0) + 1;
    handle.record.lastActiveAt = startedAt;
    await this.store.upsert(handle.record);
    handle.suppressNotifications = false;
    this.notifyChange();

    void this.runTurn(handle, bridge, turnId, prompt, startedAt, segmentId);
    return { turnId, startedAt };
  }

  async status(input: { workerId: string }): Promise<WorkerStatusResult> {
    await this.store.load();
    const record = this.store.get(input.workerId);
    if (!record) throw new Error(`Worker ${input.workerId} does not exist.`);
    const handle = this.handles.get(record.id);
    const running = handle?.running ?? null;
    const turns = (await this.store.readTurns(record.id))
      .slice()
      .sort((a, b) => a.startedAt - b.startedAt);
    const pending = [...this.pendingPermissions.values()].find(
      (permission) => permission.workerId === record.id,
    );
    return {
      ...this.toListItem(record, running?.turnId ?? null, turns.at(-1)?.turnId ?? null),
      runningForMs: running ? Date.now() - running.startedAt : null,
      pendingPermission: pending
        ? {
            permissionId: pending.permissionId,
            title: pending.title,
            options: pending.options.map((option) => option.kind),
          }
        : null,
      turns: turns.slice(-10).map((turn) => ({
        id: turn.turnId,
        startedAt: turn.startedAt,
        endedAt: turn.endedAt,
        stopReason: turn.stopReason,
        error: turn.error,
        prompt: truncate(turn.prompt, 200),
      })),
    };
  }

  async list(): Promise<WorkerListItem[]> {
    await this.store.load();
    return this.store.list().map((record) => {
      const handle = this.handles.get(record.id);
      return this.toListItem(record, handle?.running?.turnId ?? null, null);
    });
  }

  /**
   * Raw transcript segment for the read-only detail view. Turns are already
   * persisted by handleNotification; this only pages the same files the worker
   * tools read, without model-facing truncation.
   */
  async readHistorySegment(input: {
    workerId: string;
    segmentId?: number;
  }): Promise<AssistantWorkerHistorySegment> {
    await this.store.load();
    const record = this.store.get(input.workerId);
    if (!record) throw new Error(`Worker ${input.workerId} does not exist.`);

    const segments = await this.store.listSegments(record.id);
    if (segments.length === 0) {
      return {
        segmentId: 0,
        sessionId: record.resumeId ?? record.id,
        messages: [],
      };
    }

    const segmentId = input.segmentId ?? segments[segments.length - 1];
    const index = segments.indexOf(segmentId);
    if (index < 0) {
      throw new Error(`Worker ${record.id} segment ${segmentId} does not exist.`);
    }

    const messages = await this.store.readSegment(record.id, segmentId);
    const previous = index > 0 ? segments[index - 1] : undefined;
    const sessionId = record.resumeId ?? messages[0]?.sessionId ?? record.id;

    // Same rule as assistant history: when the latest segment is short, include
    // the previous one so the first view is not almost empty.
    if (input.segmentId === undefined && previous !== undefined) {
      const userMessages = messages.filter(
        (notification) => notification.update.sessionUpdate === "user_message_chunk",
      ).length;
      if (userMessages < HISTORY_PAGE_SIZE) {
        const previousMessages = await this.store.readSegment(record.id, previous);
        const beforePrevious = index > 1 ? segments[index - 2] : undefined;
        return {
          segmentId,
          ...(beforePrevious !== undefined ? { previousSegmentId: beforePrevious } : {}),
          sessionId: record.resumeId ?? previousMessages[0]?.sessionId ?? sessionId,
          messages: [...previousMessages, ...messages],
        };
      }
    }

    return {
      segmentId,
      ...(previous !== undefined ? { previousSegmentId: previous } : {}),
      sessionId,
      messages,
    };
  }

  async read(input: WorkerReadInput): Promise<WorkerReadResult> {
    await this.store.load();
    const record = this.store.get(input.workerId);
    if (!record) throw new Error(`Worker ${input.workerId} does not exist.`);

    const summary = (input.mode ?? "summary") === "summary";
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const segments = await this.store.listSegments(record.id);
    const turnMetas = new Map(
      (await this.store.readTurns(record.id)).map((turn) => [turn.turnId, turn]),
    );

    let segmentIndex = -1;
    let turns: ConversationTurn[] = [];
    let turnIndex = -1;

    // Turns remember their segment, so reading a specific turn does not have to
    // scan every newer segment first.
    const hintedSegment = input.turnId ? turnMetas.get(input.turnId)?.segmentId : undefined;
    const hintedIndex = hintedSegment === undefined ? -1 : segments.indexOf(hintedSegment);
    for (let index = hintedIndex >= 0 ? hintedIndex : segments.length - 1; index >= 0; index -= 1) {
      const candidate = await this.turnsForSegment(
        record.id,
        record.resumeId ?? undefined,
        segments[index],
      );
      if (input.turnId) {
        const found = candidate.findIndex((turn) => turn.id === input.turnId);
        if (found >= 0) {
          segmentIndex = index;
          turns = candidate;
          turnIndex = found;
          break;
        }
      } else if (candidate.length > 0) {
        segmentIndex = index;
        turns = candidate;
        turnIndex = candidate.length - 1;
        break;
      }
    }

    if (turnIndex < 0) {
      return {
        workerId: record.id,
        turn: null,
        entryCount: 0,
        nextAfterEntry: null,
        hasMoreInTurn: false,
        previousTurnId: null,
      };
    }

    const turn = turns[turnIndex];
    const turnMeta = turnMetas.get(turn.id);
    const allEntries = turn.entries.filter(
      (entry) => input.includeThoughts || entry.kind !== "agent_thought",
    );
    const after = input.afterEntry ?? -1;
    const candidates = allEntries.filter((entry) => entry.index > after);
    const selected = candidates.slice(0, limit);

    const previousTurnId =
      turnIndex > 0
        ? turns[turnIndex - 1].id
        : await this.previousTurnAcrossSegments(
            record.id,
            record.resumeId ?? undefined,
            segments,
            segmentIndex,
          );

    // Reuse the same turn/entry shape as the JSON export. Reads only page and trim it.
    const pagedTurn = truncateConversationTurn(
      {
        ...turn,
        startedAt: turnMeta?.startedAt ?? turn.startedAt,
        endedAt: turnMeta?.endedAt ?? turn.endedAt,
        stopReason: turnMeta?.stopReason ?? null,
        error: turnMeta?.error ?? null,
        entries: selected,
      },
      {
        prompt: summary ? SUMMARY_PROMPT_CHARS : FULL_PROMPT_CHARS,
        text: summary ? SUMMARY_ASSISTANT_CHARS : FULL_ASSISTANT_CHARS,
        toolText: summary ? SUMMARY_TOOL_CHARS : FULL_TOOL_CHARS,
        keepToolRaw: !summary,
      },
    );

    return {
      workerId: record.id,
      turn: pagedTurn,
      entryCount: allEntries.length,
      nextAfterEntry: selected.at(-1)?.index ?? input.afterEntry ?? null,
      hasMoreInTurn: candidates.length > selected.length,
      previousTurnId,
    };
  }

  async cancel(input: { workerId: string }): Promise<void> {
    const handle = await this.requireHandle(input.workerId);
    if (handle.terminated) return;
    if (!handle.bridge?.isConnected || !handle.record.resumeId) return;
    await handle.bridge.cancel({ sessionId: handle.record.resumeId }).catch(() => {});
  }

  /**
   * Releases the agent process but keeps the record and transcript. The worker is
   * not destroyed: the next worker_send reconnects and calls loadSession. Use
   * terminate to forget it entirely.
   */
  async close(input: { workerId: string }): Promise<void> {
    const handle = await this.requireHandle(input.workerId);
    if (handle.terminated) return;
    // Set the state first: killing the bridge may make the in-flight prompt reject,
    // and runTurn must not publish a failed wake for a worker we are closing.
    handle.record.status = "closed";
    this.finishPermissionsFor(handle.record.id);
    if (handle.running && handle.record.resumeId) {
      await handle.bridge?.cancel({ sessionId: handle.record.resumeId }).catch(() => {});
    }
    if (handle.bridge) {
      await handle.bridge.kill().catch(() => {});
      handle.bridge = null;
    }
    this.stopSocketServer(handle);
    handle.record.lastActiveAt = Date.now();
    await this.store.upsert(handle.record);
    this.handles.delete(handle.record.id);
    this.notifyChange();
  }

  /**
   * Removes a worker for good: stop its agent and delete its record and transcript.
   * The workspace is never touched: whoever created a directory is responsible for
   * deleting it with fs_delete (workspace paths only), or asking the user to clean up.
   */
  async terminate(input: { workerId: string }): Promise<void> {
    await this.store.load();
    const record = this.store.get(input.workerId);
    if (!record) throw new Error(`Worker ${input.workerId} does not exist.`);

    const handle = this.handles.get(record.id);
    if (handle) {
      // Stop writes before touching the store: notifications may still be in flight.
      handle.terminated = true;
      handle.running = null;
      this.finishPermissionsFor(record.id);
      if (record.resumeId) {
        await handle.bridge?.cancel({ sessionId: record.resumeId }).catch(() => {});
      }
      if (handle.bridge) {
        await handle.bridge.kill().catch(() => {});
        handle.bridge = null;
      }
      this.stopSocketServer(handle);
      this.handles.delete(record.id);
    }

    this.forgetSegmentCache(record.id);
    await this.store.remove(record.id);
    this.notifyChange();
  }

  private forgetSegmentCache(workerId: string): void {
    for (const key of this.segmentCache.keys()) {
      if (key.startsWith(`${workerId}:`)) this.segmentCache.delete(key);
    }
  }

  async permission(input: {
    permissionId: string;
    decision: WorkerPermissionDecision;
  }): Promise<void> {
    const pending = this.pendingPermissions.get(input.permissionId);
    if (!pending) throw new Error(`Permission ${input.permissionId} is not pending.`);
    const option =
      pending.options.find((candidate) => candidate.kind === input.decision) ??
      (input.decision === "deny"
        ? pending.options.find((candidate) => candidate.kind.startsWith("reject"))
        : pending.options.find((candidate) => candidate.kind.startsWith("allow")));
    pending.finish(option?.optionId ?? null);
  }

  /** Aborts every worker and records the interruption. Called when Fello shuts down. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.finishPermissionsFor(null);
    await Promise.all(
      [...this.handles.values()].map(async (handle) => {
        if (handle.running && handle.record.resumeId) {
          await handle.bridge?.cancel({ sessionId: handle.record.resumeId }).catch(() => {});
        }
        if (handle.bridge) {
          await handle.bridge.kill().catch(() => {});
          handle.bridge = null;
        }
        this.stopSocketServer(handle);
        if (handle.record.status !== "closed") {
          // A clean shutdown cancels the turn, so the worker is idle when the app
          // comes back. Crashes leave "running" behind and init() marks it interrupted.
          if (
            handle.record.status === "running" ||
            handle.record.status === "awaiting_permission"
          ) {
            handle.record.status = "idle";
          }
          handle.record.lastActiveAt = Date.now();
          await this.store.upsert(handle.record).catch(() => {});
        }
      }),
    );
    this.handles.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────

  private connectionStatusOf(handle: WorkerHandle | undefined): WorkerConnectionStatus {
    if (!handle) return "disconnected";
    if (handle.bridge?.isConnected) return "connected";
    if (handle.connectPromise) return "connecting";
    return "disconnected";
  }

  private toListItem(
    record: WorkerRecord,
    currentTurnId: string | null,
    lastTurnId: string | null,
  ): WorkerListItem {
    return {
      id: record.id,
      dataDir: join(this.options.workersDir, record.id),
      name: record.name,
      status: record.status as WorkerLifecycleStatus,
      connectionStatus: this.connectionStatusOf(this.handles.get(record.id)),
      cwd: record.cwd,
      agentId: record.agentId,
      modelId: record.modelId ?? null,
      permissionMode: record.permissionMode ?? "ask",
      typeId: record.typeId ?? null,
      typeName: record.typeName ?? null,
      createdAt: record.createdAt,
      lastActiveAt: record.lastActiveAt,
      currentTurnId,
      lastTurnId,
      turnCount: record.turnCount ?? 0,
      lastStopReason: record.lastStopReason,
      lastError: record.lastError,
    };
  }

  private assertIdle(handle: WorkerHandle): void {
    if (!handle.running) return;
    throw new Error(
      `Worker ${handle.record.id} is still running turn ${handle.running.turnId}. Wait for it to finish or cancel it.`,
    );
  }

  private async requireHandle(workerId: string): Promise<WorkerHandle> {
    await this.store.load();
    const existing = this.handles.get(workerId);
    if (existing) return existing;
    const record = this.store.get(workerId);
    if (!record) throw new Error(`Worker ${workerId} does not exist.`);
    // "closed" only means the agent process was released; worker_send reconnects it.
    const handle: WorkerHandle = {
      record,
      bridge: null,
      connectPromise: null,
      running: null,
      socketServer: null,
      suppressNotifications: false,
      terminated: false,
    };
    this.handles.set(workerId, handle);
    return handle;
  }

  private async ensureBridge(handle: WorkerHandle): Promise<ACPBridge> {
    if (handle.bridge?.isConnected && handle.record.resumeId) return handle.bridge;
    if (handle.connectPromise) return handle.connectPromise;

    handle.suppressNotifications = true;
    handle.connectPromise = (async () => {
      const agentInfo = resolveAgentInfo(handle.record.agentId);
      const mcpServers = await this.buildMcpServers(handle);
      const bridge = new ACPBridge(handle.record.agentId, {
        agentInfo,
        cwd: handle.record.cwd,
        extNotificationSpecs,
        agentEnv,
        onSessionConnect: () => {},
        onSessionUpdate: (notification) => {
          this.handleNotification(handle, notification);
        },
        onExtNotification: (method, params) => {
          const resumeId = handle.record.resumeId ?? "";
          for (const adapter of adapters) {
            const notifications = adapter.handleExtNotification(bridge, method, resumeId, params);
            if (notifications.length > 0) {
              for (const notification of notifications)
                this.handleNotification(handle, notification);
              return;
            }
          }
        },
        onPermissionRequest: (request) => this.requestPermission(handle, request),
        onAgentTerminalOutput: () => {},
      });
      handle.bridge = bridge;
      try {
        await bridge.connect();
        if (handle.record.resumeId) {
          await bridge.loadSession({
            sessionId: handle.record.resumeId,
            cwd: handle.record.cwd,
            mcpServers,
          });
        } else {
          const session = await bridge.newSession({
            cwd: handle.record.cwd,
            mcpServers,
          });
          handle.record.resumeId = session.sessionId;
        }
        if (handle.record.modelId && handle.record.resumeId) {
          await bridge
            .setSessionModel({
              sessionId: handle.record.resumeId,
              modelId: handle.record.modelId,
            })
            .catch((error) => {
              console.warn("[worker] Failed to set model:", error);
            });
        }
        await this.store.upsert(handle.record);
        this.notifyChange();
        return bridge;
      } catch (error) {
        handle.bridge = null;
        await bridge.kill().catch(() => {});
        this.stopSocketServer(handle);
        throw error;
      }
    })().finally(() => {
      handle.connectPromise = null;
    });

    return handle.connectPromise;
  }

  private async buildMcpServers(handle: WorkerHandle): Promise<McpServer[]> {
    const record = handle.record;
    const features = (record.features ?? []).filter((feature) => WORKER_FEATURES.includes(feature));
    const socketServer = await this.ensureSocketServer(handle, features);
    const project: ProjectInfo = {
      id: createHash("sha1").update(record.cwd).digest("hex"),
      title: record.name,
      cwd: record.cwd,
      createdAt: record.createdAt,
    };
    return buildMcpServersConfig(
      record.mcpServers ?? [],
      { project, socketPath: socketServer.socketPath, features },
      this.options.ctx,
      this.options.mcpDeps,
    );
  }

  private async ensureSocketServer(
    handle: WorkerHandle,
    features: Feature[],
  ): Promise<SocketServer> {
    if (handle.socketServer) return handle.socketServer;
    const socketPath = generateSocketPath(`worker-${handle.record.id}`);
    const server = await startSocketServer(socketPath);
    try {
      const shareDir = join(handle.record.cwd, "share");
      this.options.mcpDeps.toolbox.registerToolboxRoute(server, handle.record.cwd);
      if (features.includes("skills")) {
        this.options.mcpDeps.skills.registerSkillsRoute(server, handle.record.cwd);
      }
      if (features.includes("search")) {
        this.options.mcpDeps.search.registerSearchRoute(server, handle.record.cwd);
      }
      if (features.includes("ask_user")) {
        this.options.mcpDeps.askUser.registerAskUserRoute(server, this.options.assistantSessionId, {
          titlePrefix: `[${handle.record.name}] `,
        });
      }
      if (features.includes("share_to_user")) {
        this.options.mcpDeps.shareToUser.registerShareToUserRoute(
          server,
          this.options.assistantSessionId,
          {
            cwd: handle.record.cwd,
            shareDir,
          },
        );
      }
      if (features.includes("image_generation")) {
        this.options.mcpDeps.imageGeneration.registerImageGenerationRoute(
          server,
          this.options.assistantSessionId,
          { shareDir },
        );
      }
    } catch (error) {
      server.stop();
      throw error;
    }
    handle.socketServer = server;
    return server;
  }

  private stopSocketServer(handle: WorkerHandle): void {
    handle.socketServer?.stop();
    handle.socketServer = null;
  }

  private handleNotification(handle: WorkerHandle, notification: SessionNotification): void {
    if (handle.terminated || handle.suppressNotifications) return;
    if (handle.running) {
      const text = messageText(notification);
      if (notification.update?.sessionUpdate === "agent_message_chunk" && text) {
        handle.running.text += text;
      }
    }
    const enriched = enrich(notification);
    // Publish after the append resolves so a detail view that loads history
    // concurrently cannot miss a notification, and the renderer can dedupe the
    // copy that history also contains.
    void this.store
      .append(handle.record.id, enriched)
      .then(() => {
        if (!handle.terminated) this.options.onNotification?.(handle.record.id, enriched);
      })
      .catch((error) => console.error("[worker] Failed to persist notification:", error));
  }

  private async runTurn(
    handle: WorkerHandle,
    bridge: ACPBridge,
    turnId: string,
    prompt: string,
    startedAt: number,
    segmentId: number,
  ): Promise<void> {
    let stopReason: string | null = null;
    let error: string | null = null;
    try {
      const response = await bridge.sendPrompt({
        sessionId: handle.record.resumeId!,
        prompt: [{ type: "text", text: prompt }],
      });
      stopReason = response.stopReason ?? null;
      error = response.error ?? null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    const endedAt = Date.now();
    const text = handle.running?.turnId === turnId ? handle.running.text : "";
    handle.running = null;
    // terminate() may have removed the record (and its directory) while this prompt
    // was unwinding; do not recreate anything.
    if (handle.terminated) return;
    await this.store
      .appendTurn(handle.record.id, {
        turnId,
        prompt,
        startedAt,
        endedAt,
        stopReason,
        error,
        segmentId,
      })
      .catch((caught) => console.error("[worker] Failed to persist turn:", caught));

    // worker_close may have run while the prompt was unwinding; do not resurrect it.
    const closed = handle.record.status === "closed";
    if (!closed) {
      // A cancelled turn (worker_cancel or app shutdown) leaves the worker idle.
      handle.record.status = error && !this.shuttingDown ? "failed" : "idle";
      handle.record.lastStopReason = stopReason;
      handle.record.lastError = error;
      handle.record.lastActiveAt = endedAt;
      await this.store.upsert(handle.record).catch(() => {});
      this.notifyChange();
    }

    if (closed || handle.terminated || stopReason === "cancelled" || this.shuttingDown) return;
    const event = error ? "failed" : "finished";
    const typeLabel = handle.record.typeName ?? handle.record.typeId ?? "worker";
    const lines = [
      `[Worker id="${handle.record.id}" type="${typeLabel}" event="${event}" turn="${turnId}"] ${handle.record.name}`,
    ];
    if (error) lines.push(`Error: ${error}`);
    else if (stopReason) lines.push(`Stop reason: ${stopReason}`);
    const tail = text.trim();
    lines.push(tail ? truncate(tail, 1_500) : "(no assistant output)");
    this.options.notify(lines.join("\n"));
  }

  private requestPermission(
    handle: WorkerHandle,
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    if ((handle.record.permissionMode ?? "ask") === "allow-all") {
      const allowOption =
        request.options.find((option) => option.kind === "allow_always") ??
        request.options.find((option) => option.kind === "allow_once");
      return Promise.resolve({
        outcome: { outcome: "selected", optionId: allowOption?.optionId ?? "deny" },
      });
    }

    const permissionId = `p_${randomUUID().slice(0, 8)}`;
    const title = request.toolCall.title ?? request.toolCall.toolCallId;
    const rawInput = request.toolCall.rawInput;
    const input = rawInput === undefined || rawInput === null ? null : JSON.stringify(rawInput);
    const options: PermissionOption[] = request.options.map((option) => ({
      optionId: option.optionId,
      kind: option.kind,
      name: option.name,
    }));

    return new Promise<RequestPermissionResponse>((resolve) => {
      const finish = (optionId: string | null) => {
        clearTimeout(timer);
        this.pendingPermissions.delete(permissionId);
        if (handle.record.status === "awaiting_permission") {
          handle.record.status = "running";
          handle.record.lastActiveAt = Date.now();
          void this.store.upsert(handle.record).catch(() => {});
          this.notifyChange();
        }
        resolve(
          optionId
            ? { outcome: { outcome: "selected", optionId } }
            : { outcome: { outcome: "cancelled" } },
        );
      };
      const timer = setTimeout(() => finish(null), PERMISSION_TIMEOUT_MS);

      this.pendingPermissions.set(permissionId, {
        permissionId,
        workerId: handle.record.id,
        title,
        input,
        options,
        finish,
      });
      handle.record.status = "awaiting_permission";
      handle.record.lastActiveAt = Date.now();
      void this.store.upsert(handle.record).catch(() => {});
      this.notifyChange();

      const kinds = [...new Set(options.map((option) => option.kind))];
      this.options.notify(
        [
          `[Worker id="${handle.record.id}" type="${handle.record.typeName ?? handle.record.typeId ?? "worker"}" event="permission" permission="${permissionId}"] ${handle.record.name} requests permission`,
          `Tool: ${title}`,
          input ? truncate(input, 800) : null,
          `Options: ${kinds.join(", ") || "none"}`,
          "Reply with worker_permission (or ask the user first).",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    });
  }

  private finishPermissionsFor(workerId: string | null): void {
    for (const pending of [...this.pendingPermissions.values()]) {
      if (workerId === null || pending.workerId === workerId) pending.finish(null);
    }
  }

  private async turnsForSegment(
    workerId: string,
    mainSessionId: string | undefined,
    segmentId: number,
  ): Promise<ConversationTurn[]> {
    const key = `${workerId}:${segmentId}`;
    const info = await this.store.segmentInfo(workerId, segmentId);
    if (!info) return [];
    const cached = this.segmentCache.get(key);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      return cached.turns;
    }
    const notifications = await this.store.readSegment(workerId, segmentId);
    const turns = buildConversationTurns(notifications, { sessionId: mainSessionId });
    this.segmentCache.set(key, { size: info.size, mtimeMs: info.mtimeMs, turns });
    return turns;
  }

  private async previousTurnAcrossSegments(
    workerId: string,
    mainSessionId: string | undefined,
    segments: number[],
    segmentIndex: number,
  ): Promise<string | null> {
    for (let index = segmentIndex - 1; index >= 0; index -= 1) {
      const turns = await this.turnsForSegment(workerId, mainSessionId, segments[index]);
      if (turns.length > 0) return turns.at(-1)!.id;
    }
    return null;
  }
}

export type { WorkerTurn };
