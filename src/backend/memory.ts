/**
 * Project-level persistent memory module.
 *
 * Architecture:
 * - Session Agent uses mcp-memory (memory_query / memory_store)
 * - memory_store triggers a Memo Inference Agent (via inference module)
 *   that reads/writes memory.json using mcp-memo (memo_get_current / memo_save)
 * - Per-project write queue ensures atomic operations
 * - memory.json lives at ~/.fello/projects/<project_id>/memory.json
 *
 * Storage format: JSON array of { weight, text, date, tags } sorted by weight desc.
 */

import { join } from "path";
import { randomUUID, createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import {
  memoryQueryRequestSchema,
  memoryStoreRequestSchema,
} from "../shared/zod/mcp-memory-schema";
import {
  memoSaveRequestSchema,
  memoTouchRequestSchema,
  memoryFileSchema,
  MEMORY_FILE_VERSION,
  type MemoryEntry,
  type MemoryFile,
} from "../shared/zod/mcp-memo-schema";
import { PROJECTS_DIR, TEMP_DIR } from "./storage/constant";
import { startSocketServer, generateSocketPath, type SocketServer } from "./socket-server";
import type { InferenceModule } from "./inference";
import type { BackendContext } from "./types";

// ── Constants ────────────────────────────────────────────────────────

const MEMORY_FILENAME = "memory.json";
const MAX_ENTRIES = 50;

/** Max entries to inject into tool description */
const SUMMARY_MAX_ENTRIES = 15;

// ── Helpers ──────────────────────────────────────────────────────────

/** Derive projectId from cwd (same logic as storage/project-session.ts) */
function getProjectIdFromCwd(cwd: string): string {
  return createHash("sha1").update(cwd).digest("hex");
}

// ── Memory file operations ───────────────────────────────────────────

function getMemoryPath(projectId: string): string {
  return join(PROJECTS_DIR, projectId, MEMORY_FILENAME);
}

function readMemoryEntries(projectId: string): MemoryEntry[] {
  const memoryPath = getMemoryPath(projectId);
  if (!existsSync(memoryPath)) return [];
  try {
    const raw = readFileSync(memoryPath, "utf-8");
    const parsed = JSON.parse(raw);
    const file = memoryFileSchema.parse(parsed);
    return file.entries;
  } catch {
    return [];
  }
}

function writeMemoryEntries(projectId: string, entries: MemoryEntry[]): void {
  const dir = join(PROJECTS_DIR, projectId);
  mkdirSync(dir, { recursive: true });
  // Sort by weight desc before writing
  const sorted = [...entries].sort((a, b) => b.weight - a.weight);
  // Enforce max entries
  const capped = sorted.slice(0, MAX_ENTRIES);
  const file: MemoryFile = { version: MEMORY_FILE_VERSION, entries: capped };
  writeFileSync(getMemoryPath(projectId), JSON.stringify(file, null, 2), "utf-8");
}

/** Serialize entries to a human-readable text format for prompt injection */
function entriesToText(entries: MemoryEntry[]): string {
  return entries.map((e) => e.text).join("\n");
}

// ── Write Queue (per project, serial) ────────────────────────────────

type QueueTask = () => Promise<void>;

class WriteQueue {
  private queues = new Map<string, Promise<void>>();

  async enqueue(projectId: string, task: QueueTask): Promise<void> {
    const prev = this.queues.get(projectId) ?? Promise.resolve();
    const next = prev.then(task, task); // run task regardless of prev success/failure
    this.queues.set(projectId, next);
    // Clean up reference after task completes
    next.finally(() => {
      if (this.queues.get(projectId) === next) {
        this.queues.delete(projectId);
      }
    });
    return next;
  }
}

// ── Memo Prompts ─────────────────────────────────────────────────────

function buildMemoWritePrompt(newFacts: { text: string; reason?: string }[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const factsFormatted = newFacts
    .map((f) => {
      if (f.reason) return `   - "${f.text}" (reason: ${f.reason})`;
      return `   - "${f.text}"`;
    })
    .join("\n");
  return `You are a Memory Organizer Agent. Your job is to maintain a project memory file in JSON format.

## Storage Format

The memory file is a JSON object with this structure:

\`\`\`json
{
  "version": 1,
  "entries": [
    { "weight": 3, "text": "The fact to remember", "date": "YYYY-MM-DD", "tags": ["category"] }
  ]
}
\`\`\`

## Fields
- **version**: Always 1
- **entries**: Array sorted by weight descending. Each entry:
  - **weight**: Priority (3=critical, 2=important, 1=general). Never use negative values in output; just remove outdated entries.
  - **text**: Concise fact, under 100 characters when possible. Self-contained.
  - **date**: Today's date for new/updated entries: ${today}
  - **tags**: One or more from: preferences, architecture, commands, corrections, context

## Weight Assignment
- 3: Critical rule. User strongly emphasized (keywords: "always", "never", "remember", "一定", "永远不要", "必须")
- 2: Important preference or decision
- 1: General info (default for new facts)

## Your Task
1. Call memo_get_current() to read current memory
2. Parse the JSON
3. Integrate the following new facts (use the "reason" to help determine weight and tags):
${factsFormatted}
4. Integration rules:
   - If a new fact contradicts an existing one: remove the old, add the new
   - If a new fact reinforces an existing one: upgrade weight (max 3)
   - If a new fact is a duplicate: skip it
5. Maintenance:
   - Remove outdated/negated entries entirely
   - Keep total entries ≤ 50
   - If over 50: remove lowest weight + oldest date first
6. Call memo_save(content) with the COMPLETE JSON object as a string
   - Must include "version": 1 and "entries" array
   - Entries must be sorted by weight descending
   - Output valid JSON only — no markdown fences, no explanation

## Rules
- Preserve the original language of each fact (don't translate)
- You MUST call memo_save(content) — this is non-negotiable. The task is incomplete without it.
- After memo_save() succeeds, reply briefly with the result (e.g. "Saved N entries."). No lengthy explanation needed.
- The content passed to memo_save must be a valid JSON object string`;
}

// ── Memo Query Prompt ─────────────────────────────────────────────

function buildMemoQueryPrompt(query: string): string {
  return `You are a Memory Retrieval Agent. Your job is to find and summarize relevant memories for a given query.

## Your Task
1. Call memo_get_current() to read the current memory
2. Find entries relevant to this query: "${query}"
3. Call memo_touch({ indices: [...] }) with the indices of all relevant entries (to mark them as active)
4. Summarize the relevant memories in natural language, organized and easy to understand
5. If no entries are relevant, respond with: (no relevant memories found)

## Response Style
- Use natural language, not raw data format
- Group related facts together
- Highlight the most important/high-weight items first
- Be concise but complete — don't lose information
- Respond in the same language as the query

## Rules
- You MUST call memo_get_current() first — this is required
- You MUST call memo_touch() with the indices of relevant entries — this keeps them from being evicted
- Base your response ONLY on what's in the memory — do not fabricate
- Preserve specific details (names, paths, versions) exactly as stored`;
}

// ── Module Interface ─────────────────────────────────────────────────

export interface MemoryModule {
  /** Register Socket routes for Session Agent's mcp-memory */
  registerMemoryRoute: (
    server: SocketServer,
    projectId: string,
    sessionContext: SessionContext,
  ) => void;
  /** Build the mcp-memory MCP server config for Session Agent */
  buildMemoryMcpServer: (options: { projectDir: string; socketPath: string }) => {
    name: string;
    command: string;
    args: string[];
    env: { name: string; value: string }[];
  };
  /** Get memory summary for system prompt injection */
  getMemorySummary: (projectId: string) => string;
  /** Get all memory entries for a project (for UI display) */
  getEntries: (projectId: string) => { version: number; entries: MemoryEntry[] } | null;
  /** Clear all memory for a project (delete the file) */
  clearMemory: (projectId: string) => void;
  /** Get the file system path of memory.json for a project */
  getFilePath: (projectId: string) => string | null;
}

/** Context about the current session, needed to run memo inference with same agent/model */
export interface SessionContext {
  agentId: string;
  modelId?: string | null;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createMemoryModule(
  _ctx: BackendContext,
  deps: { inference: InferenceModule },
): MemoryModule {
  const writeQueue = new WriteQueue();

  // ── Unified Memo Agent Runner ───────────────────────────────────────

  async function runMemoAgent(params: {
    projectId: string;
    prompt: string;
    sessionContext: SessionContext;
    writable?: boolean;
  }): Promise<string> {
    const { projectId, prompt, sessionContext, writable = false } = params;

    const tempId = `memo-${randomUUID()}`;
    const tempDir = join(TEMP_DIR, tempId);
    mkdirSync(tempDir, { recursive: true });

    const memoSocketPath = generateSocketPath(`memo-${randomUUID()}`);
    let memoSocketServer: SocketServer | null = null;

    try {
      memoSocketServer = await startSocketServer(memoSocketPath);

      // Always register read route
      memoSocketServer.registry("memo/read", async () => {
        const entries = readMemoryEntries(projectId);
        const file: MemoryFile = { version: MEMORY_FILE_VERSION, entries };
        return { content: JSON.stringify(file, null, 2) };
      });

      // Always register touch route (updates date of accessed entries)
      memoSocketServer.registry("memo/touch", async (payload) => {
        const { indices } = memoTouchRequestSchema.parse(payload);
        const entries = readMemoryEntries(projectId);
        const today = new Date().toISOString().slice(0, 10);
        let touched = 0;
        for (const idx of indices) {
          if (idx >= 0 && idx < entries.length) {
            entries[idx].date = today;
            touched++;
          }
        }
        if (touched > 0) {
          writeMemoryEntries(projectId, entries);
        }
        return { ok: true, touched };
      });

      // Only register write route if needed (with write-once guard)
      if (writable) {
        memoSocketServer.registry("memo/save", async (payload) => {
          try {
            const { content } = memoSaveRequestSchema.parse(payload);
            const file = memoryFileSchema.parse(JSON.parse(content));
            writeMemoryEntries(projectId, file.entries);
            return { ok: true, entries: file.entries.length };
          } catch (err: any) {
            console.warn("[memory] memo_save received invalid JSON:", err.message);
            throw new Error(`Invalid memory JSON: ${err.message}`);
          }
        });
      }

      // Build mcp-memo MCP server config
      const memoMcpServer = {
        name: "memo",
        command: process.execPath,
        args: [join(process.scriptsPath, "mcp-memo/server.mjs"), "--socket-path", memoSocketPath],
        env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
      };

      // Run inference
      const result = await deps.inference.runInference({
        agentId: sessionContext.agentId,
        prompt,
        model: sessionContext.modelId ?? undefined,
        cwd: tempDir,
        mcpServers: [memoMcpServer],
        features: [],
      });
      if (memoSocketServer) {
        memoSocketServer.stop();
        memoSocketServer = null;
      }
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      return result.text || "";
    } catch (err) {
      console.warn("[memory] Memo agent failed", err);

      if (memoSocketServer) {
        memoSocketServer.stop();
        memoSocketServer = null;
      }
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      throw err;
    }
  }

  // ── Socket Route Handlers ───────────────────────────────────────────

  function registerMemoryRoute(
    server: SocketServer,
    projectId: string,
    sessionContext: SessionContext,
  ): void {
    // memory_query: use Memo Inference Agent for semantic retrieval
    server.registry("memory/query", async (payload) => {
      const { query } = memoryQueryRequestSchema.parse(payload);
      const entries = readMemoryEntries(projectId);

      if (entries.length === 0) {
        return { content: "(no project memories stored yet)" };
      }

      // Use Memo Agent for semantic retrieval
      try {
        const result = await runMemoAgent({
          projectId,
          prompt: buildMemoQueryPrompt(query),
          sessionContext,
          writable: false,
        });
        return { content: result || "(no relevant memories found)" };
      } catch (err) {
        console.warn("[memory] Memo query inference failed", err);
        throw err;
      }
    });

    // memory_store: queue facts for memo inference processing
    server.registry("memory/store", async (payload) => {
      const { facts } = memoryStoreRequestSchema.parse(payload);

      await writeQueue.enqueue(projectId, async () => {
        try {
          await runMemoAgent({
            projectId,
            prompt: buildMemoWritePrompt(facts),
            sessionContext,
            writable: true,
          });
        } catch (err) {
          console.warn("[memory] Memo store inference failed", err);
          throw err;
        }
      });

      return { stored: facts.length, summary: `Stored ${facts.length} fact(s) to project memory.` };
    });
  }

  // ── MCP Server Builder ──────────────────────────────────────────────

  function buildMemoryMcpServer(options: { projectDir: string; socketPath: string }) {
    // Generate memory summary for initial injection into tool description
    const projectId = getProjectIdFromCwd(options.projectDir);
    const summary = projectId ? getMemorySummary(projectId) : "";

    const args = [
      join(process.scriptsPath, "mcp-memory/server.mjs"),
      "--project-dir",
      options.projectDir,
      "--socket-path",
      options.socketPath,
    ];

    // Write summary to temp file if available (like skills does with catalog)
    if (summary) {
      const summaryFilename = join(TEMP_DIR, `memory-summary-${randomUUID()}.txt`);
      writeFileSync(summaryFilename, summary, "utf-8");
      args.push("--memory-summary", summaryFilename);
    }

    return {
      name: "memory",
      command: process.execPath,
      args,
      env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
    };
  }

  // ── System Prompt Summary ───────────────────────────────────────────

  function getMemorySummary(projectId: string): string {
    const entries = readMemoryEntries(projectId);
    if (entries.length === 0) return "";

    // File is already sorted by weight desc, just take top N
    const top = entries.slice(0, SUMMARY_MAX_ENTRIES);
    return entriesToText(top);
  }

  // ── UI Helpers ───────────────────────────────────────────────────────

  function getEntries(projectId: string): { version: number; entries: MemoryEntry[] } | null {
    const entries = readMemoryEntries(projectId);
    if (entries.length === 0) {
      const memoryPath = getMemoryPath(projectId);
      if (!existsSync(memoryPath)) return null;
    }
    return { version: MEMORY_FILE_VERSION, entries };
  }

  function clearMemory(projectId: string): void {
    const memoryPath = getMemoryPath(projectId);
    if (existsSync(memoryPath)) {
      rmSync(memoryPath);
    }
  }

  function getFilePath(projectId: string): string | null {
    const memoryPath = getMemoryPath(projectId);
    return existsSync(memoryPath) ? memoryPath : null;
  }

  return {
    registerMemoryRoute,
    buildMemoryMcpServer,
    getMemorySummary,
    getEntries,
    clearMemory,
    getFilePath,
  };
}
