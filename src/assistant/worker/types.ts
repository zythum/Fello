import type { ConversationTurn } from "../../shared/conversation";

/** Lifecycle of one worker record. `closed` keeps the record (and its files) for later reads. */
export type WorkerLifecycleStatus =
  | "running"
  | "awaiting_permission"
  | "idle"
  | "failed"
  | "closed"
  | "interrupted";

/** Whether the worker's ACP bridge/agent process is currently loaded. Runtime only. */
export type WorkerConnectionStatus = "connected" | "connecting" | "disconnected";

export type WorkerPermissionDecision = "allow_once" | "allow_always" | "deny";

export type WorkerCreateInput = {
  workspace: string;
  name?: string;
};

export type WorkerCreateResult = {
  workerId: string;
  cwd: string;
};

export type WorkerSendInput = {
  workerId: string;
  message: string;
};

export type WorkerSendResult = {
  turnId: string;
  startedAt: number;
};

export type WorkerListItem = {
  id: string;
  name: string;
  status: WorkerLifecycleStatus;
  /**
   * Whether the agent process is loaded right now. Closed or restarted workers are
   * "disconnected"; the next worker_send reconnects them.
   */
  connectionStatus: WorkerConnectionStatus;
  cwd: string;
  agentId: string;
  createdAt: number;
  lastActiveAt: number;
  currentTurnId: string | null;
  lastTurnId: string | null;
  lastStopReason: string | null;
  lastError: string | null;
};

export type WorkerTurnSummary = {
  id: string;
  startedAt: number | null;
  endedAt: number | null;
  stopReason: string | null;
  error: string | null;
  prompt: string;
};

export type PendingWorkerPermission = {
  permissionId: string;
  title: string;
  /** Option kinds available on this request, for example ["allow_once", "deny"]. */
  options: string[];
};

export type WorkerStatusResult = WorkerListItem & {
  runningForMs: number | null;
  pendingPermission: PendingWorkerPermission | null;
  /** Most recent turns, newest last. */
  turns: WorkerTurnSummary[];
};

export type WorkerReadInput = {
  workerId: string;
  /** Turn id returned by worker_send or found in worker_status.turns. Defaults to the latest turn. */
  turnId?: string;
  /** Return entries with an index greater than this value. */
  afterEntry?: number;
  limit?: number;
  mode?: "summary" | "full";
  includeThoughts?: boolean;
};

export type WorkerReadResult = {
  workerId: string;
  /** Same shape as one turn in an exported conversation; entries are paged/truncated. */
  turn: ConversationTurn | null;
  /** Entries in the turn after the includeThoughts filter. */
  entryCount: number;
  nextAfterEntry: number | null;
  hasMoreInTurn: boolean;
  previousTurnId: string | null;
};

/**
 * A worker is just an ACP session driven by the assistant. This service only exposes the
 * ACP verbs plus transcript reads; it deliberately has no task/ticket semantics.
 */
export interface WorkerService {
  create(input: WorkerCreateInput): Promise<WorkerCreateResult>;
  send(input: WorkerSendInput): Promise<WorkerSendResult>;
  status(input: { workerId: string }): Promise<WorkerStatusResult>;
  list(): Promise<WorkerListItem[]>;
  read(input: WorkerReadInput): Promise<WorkerReadResult>;
  cancel(input: { workerId: string }): Promise<void>;
  /** Stops the worker and keeps its record and transcript for later reads. */
  close(input: { workerId: string }): Promise<void>;
  /** Stops the worker and deletes its record and transcript. Workspace files stay. */
  terminate(input: { workerId: string }): Promise<void>;
  permission(input: { permissionId: string; decision: WorkerPermissionDecision }): Promise<void>;
}
