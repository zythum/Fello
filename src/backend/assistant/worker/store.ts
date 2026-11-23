import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import type { Feature, SessionNotificationFelloExt } from "../../../shared/schema";
import { HISTORY_PAGE_SIZE } from "../../../shared/constants";
import type { WorkerLifecycleStatus } from "../../../assistant/worker/types";

/** One directory per worker; `session.json` holds its record. */
const WORKER_SESSION_FILE = "session.json";
/** Per-turn facts that ACP notifications do not carry (stopReason/error/segment). */
const TURNS_FILE = "turns.jsonl";

/** Mirrors the session segment threshold; bounds the cost of one worker_read scan. */
const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;
const SEGMENT_PATTERN = /^messages(?:-(\d{6}))?\.jsonl$/;

export type WorkerRecord = {
  id: string;
  name: string;
  agentId: string;
  modelId: string | null;
  /** Permission mode snapshot; missing old records behave as "ask". */
  permissionMode?: "ask" | "allow-all";
  /** Worker type snapshot; optional so records created before worker types still load. */
  typeId?: string | null;
  typeName?: string | null;
  features?: Feature[];
  mcpServers?: string[];
  instructions?: string;
  cwd: string;
  /** ACP session id, needed to resume after a restart. */
  resumeId: string | null;
  status: WorkerLifecycleStatus;
  createdAt: number;
  lastActiveAt: number;
  lastStopReason: string | null;
  lastError: string | null;
  /** Number of turns started for this worker; old records may lack it. */
  turnCount?: number;
};

export type WorkerTurn = {
  turnId: string;
  prompt: string;
  startedAt: number;
  endedAt: number | null;
  stopReason: string | null;
  error: string | null;
  /** Segment that holds this turn, so worker_read can find it without scanning. */
  segmentId?: number;
};

function segmentFileName(id: number): string {
  return id === 0 ? "messages.jsonl" : `messages-${String(id).padStart(6, "0")}.jsonl`;
}

function parseLines<T>(content: string): T[] {
  return content
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isWorkerRecord(value: unknown): value is WorkerRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<WorkerRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.agentId === "string" &&
    typeof record.cwd === "string" &&
    typeof record.status === "string"
  );
}

/**
 * Raw notification storage for workers. One directory per worker, append-only
 * `messages*.jsonl` segments, plus `turns.jsonl` for facts that are not in ACP
 * (stopReason/errors come from the prompt response, not from notifications).
 */
export class WorkerStore {
  private readonly records = new Map<string, WorkerRecord>();
  private loadPromise: Promise<void> | null = null;
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly activeSegments = new Map<string, number>();

  constructor(private readonly workersDir: string) {}

  load(): Promise<void> {
    this.loadPromise ??= this.readAllRecords();
    return this.loadPromise;
  }

  /**
   * Reads every `workers/<id>/session.json`. Fail-closed: a malformed record stops the
   * load instead of being silently ignored (same rule as reminders.json). A directory
   * without session.json is skipped: it is a half-created worker with no record.
   */
  private async readAllRecords(): Promise<void> {
    await mkdir(this.workersDir, { recursive: true });
    const entries = await readdir(this.workersDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const path = this.sessionPath(id);
      const raw = await readFileIfExists(path);
      if (raw === null) {
        console.warn(`[worker] Ignoring ${path}: session.json is missing`);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`${path} is not valid JSON. Fix or remove it, then restart Fello.`);
      }
      if (!isWorkerRecord(parsed)) {
        throw new Error(`${path} is invalid: missing id, agentId, cwd or status.`);
      }
      if (parsed.id !== id) {
        throw new Error(`${path} has id "${parsed.id}", which does not match its directory.`);
      }
      this.records.set(parsed.id, parsed);
    }
  }

  list(): WorkerRecord[] {
    return [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): WorkerRecord | undefined {
    return this.records.get(id);
  }

  /**
   * Serializes writes per worker. Metadata and transcript appends share the queue, so
   * remove() can wait for everything before deleting the directory.
   */
  private enqueue(id: string, run: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(id) ?? Promise.resolve();
    const next = previous.then(run);
    this.writeQueues.set(
      id,
      next.catch(() => {}),
    );
    return next;
  }

  private async writeSession(id: string, record: WorkerRecord): Promise<void> {
    const target = this.sessionPath(id);
    const temporaryPath = `${target}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(temporaryPath, target);
  }

  async upsert(record: WorkerRecord): Promise<void> {
    await this.load();
    this.records.set(record.id, record);
    // Snapshot: the manager mutates the record object in place.
    const snapshot = { ...record };
    await this.enqueue(record.id, async () => {
      await mkdir(this.workerDir(record.id), { recursive: true });
      await this.writeSession(record.id, snapshot);
    });
  }

  /**
   * Removes the worker directory (record, transcript and turns). The workspace is
   * deliberately untouched: it may be a user directory. Termination is final.
   */
  async remove(id: string): Promise<void> {
    await this.load();
    // Let queued writes finish before deleting the directory, otherwise a late
    // write could recreate files after the removal.
    const pending = this.writeQueues.get(id);
    if (pending) await pending.catch(() => {});
    this.writeQueues.delete(id);
    this.activeSegments.delete(id);
    this.records.delete(id);
    await rm(this.workerDir(id), { recursive: true, force: true });
  }

  private workerDir(id: string): string {
    return join(this.workersDir, id);
  }

  private sessionPath(id: string): string {
    return join(this.workerDir(id), WORKER_SESSION_FILE);
  }

  private segmentPath(id: string, segmentId: number): string {
    return join(this.workerDir(id), segmentFileName(segmentId));
  }

  async listSegments(id: string): Promise<number[]> {
    let names: string[];
    try {
      names = await readdir(this.workerDir(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return names
      .flatMap((name) => {
        const match = SEGMENT_PATTERN.exec(name);
        if (!match) return [];
        return [match[1] ? Number(match[1]) : 0];
      })
      .sort((a, b) => a - b);
  }

  async latestSegmentId(id: string): Promise<number> {
    const segments = await this.listSegments(id);
    return segments.at(-1) ?? 0;
  }

  /**
   * Picks the segment for a new turn and rolls over when the current one is full.
   * Called before the prompt's user_message_chunk is appended, so a turn never
   * spans two segments.
   */
  async beginTurn(id: string): Promise<number> {
    await mkdir(this.workerDir(id), { recursive: true });
    let segmentId = await this.latestSegmentId(id);
    const path = this.segmentPath(id, segmentId);
    const content = await readFileIfExists(path);
    if (content !== null) {
      const turns = parseLines<SessionNotificationFelloExt>(content).filter(
        (notification) => notification.update?.sessionUpdate === "user_message_chunk",
      ).length;
      const size = (await stat(path)).size;
      if (turns >= HISTORY_PAGE_SIZE || size >= MAX_SEGMENT_BYTES) {
        segmentId += 1;
      }
    }
    this.activeSegments.set(id, segmentId);
    return segmentId;
  }

  /** Appends one raw notification. Writes per worker are serialized to keep order. */
  append(id: string, notification: SessionNotificationFelloExt): Promise<void> {
    return this.enqueue(id, async () => {
      await mkdir(this.workerDir(id), { recursive: true });
      const segmentId = this.activeSegments.get(id) ?? (await this.latestSegmentId(id));
      await appendFile(
        this.segmentPath(id, segmentId),
        `${JSON.stringify(notification)}\n`,
        "utf8",
      );
    });
  }

  appendTurn(id: string, turn: WorkerTurn): Promise<void> {
    return this.enqueue(id, async () => {
      await mkdir(this.workerDir(id), { recursive: true });
      await appendFile(join(this.workerDir(id), TURNS_FILE), `${JSON.stringify(turn)}\n`, "utf8");
    });
  }

  /**
   * Turns are small (`turns.jsonl`), so they are read whole. The same turnId may be
   * appended twice (start, then end); later records win field by field.
   */
  async readTurns(id: string): Promise<WorkerTurn[]> {
    const content = await readFileIfExists(join(this.workerDir(id), TURNS_FILE));
    if (!content) return [];
    const merged = new Map<string, WorkerTurn>();
    for (const turn of parseLines<WorkerTurn>(content)) {
      if (typeof turn?.turnId !== "string" || typeof turn.startedAt !== "number") continue;
      const previous = merged.get(turn.turnId);
      merged.set(turn.turnId, previous ? { ...previous, ...turn } : turn);
    }
    return [...merged.values()];
  }

  async readSegment(id: string, segmentId: number): Promise<SessionNotificationFelloExt[]> {
    const content = await readFileIfExists(this.segmentPath(id, segmentId));
    if (!content) return [];
    return parseLines<SessionNotificationFelloExt>(content).filter(
      (notification) => !!notification?.update,
    );
  }

  async segmentInfo(
    id: string,
    segmentId: number,
  ): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const info = await stat(this.segmentPath(id, segmentId));
      return { size: info.size, mtimeMs: info.mtimeMs };
    } catch {
      return null;
    }
  }
}
