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
 * Storage format: JSON object of { version, entries: [{ weight, text, date, tags }], summary? }
 *   sorted by weight desc. Summary is LLM-generated Markdown, grouped by category.
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

function readMemoryFile(projectId: string): MemoryFile {
  const memoryPath = getMemoryPath(projectId);
  if (!existsSync(memoryPath)) return { version: MEMORY_FILE_VERSION, entries: [] };
  try {
    const raw = readFileSync(memoryPath, "utf-8");
    const parsed = JSON.parse(raw);
    return memoryFileSchema.parse(parsed);
  } catch {
    return { version: MEMORY_FILE_VERSION, entries: [] };
  }
}

function writeMemoryFile(projectId: string, file: MemoryFile): void {
  const dir = join(PROJECTS_DIR, projectId);
  mkdirSync(dir, { recursive: true });
  // Sort by weight desc; within the same weight, newest date first —
  // so capping evicts lowest-weight + oldest entries first.
  const sorted = [...file.entries].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.date.localeCompare(a.date);
  });
  // Enforce max entries
  const capped = sorted.slice(0, MAX_ENTRIES);
  const outFile: MemoryFile = {
    version: MEMORY_FILE_VERSION,
    entries: capped,
    // Preserve summary if present (undefined → omitted by JSON.stringify)
    summary: file.summary,
  };
  writeFileSync(getMemoryPath(projectId), JSON.stringify(outFile, null, 2), "utf-8");
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

The memory file is a JSON object in this format (example):

\`\`\`json
{
  "version": 1,
  "entries": [
    { "weight": 3, "text": "Always use npm run (not pnpm) to execute project scripts", "date": "2025-01-15", "tags": ["commands", "preferences"] },
    { "weight": 2, "text": "Run typecheck + lint after changes, do not run format", "date": "2025-01-15", "tags": ["commands"] }
  ],
  "summary": "## Preferences\\n- **Always use npm run** (not pnpm)\\n\\n## Commands\\n- Run typecheck + lint after changes"
}
\`\`\`

## Fields
- **version**: Always 1
- **entries**: Array sorted by weight descending. Each entry:
  - **weight**: Priority (3=must-follow, 2=shapes how you work, 1=good to know). Never use negative values in output; just remove outdated entries.
  - **text**: Concise fact, under 100 characters when possible. Self-contained.
  - **date**: Today's date for new/updated entries: ${today}
  - **tags**: One or more from: preferences, architecture, commands, corrections, context
- **summary**: A concise Markdown overview of important entries, grouped by category. Injected into tool description as a quick briefing for agents — keep it to highlights, not exhaustive detail. For specifics, agents should use memory_query.

## Weight Assignment
Ask yourself: "Would knowing this change how I work on this project?"
- 3: Must-follow rules. Violating these causes friction. Signals: user corrected you, or used "always"/"never"/"一定"/"必须". When in doubt, don't use 3.
- 2: Yes — knowing this changes what I would do. Examples: which command to run, which style to follow, how to structure code.
- 1: No — informative but doesn't change my actions. Includes deferred decisions ("先观察", "后续再定"). When in doubt between 1 and 2, choose 1.

## Summary Generation
Generate or update the "summary" field as a brief briefing of what matters most in this project:
- Pick the entries you deem important — there is no strict weight threshold
- Group related entries under headings. Common groups: **Preferences**, **Architecture**, **Commands**, **Corrections**, **Context** — but feel free to use any heading that fits
- Every important entry must appear in the summary — if one doesn't fit a named group, put it under a **General** or appropriate heading
- Use bullet points (- ...) within each group
- Bold (**...**) must-follow rules to make them stand out
- Aim for 300-800 characters — concise, not exhaustive
- Preserve the original language of each fact (don't translate)
- If nothing is worth summarizing, omit the field

## Your Task
1. Call memo_get_current() to read current memory
2. Parse the JSON
3. Integrate the following new facts (use the "reason" to help determine weight and tags):
${factsFormatted}
4. Integration rules:
   Make quick judgment calls — do not deliberate over borderline cases.
   When a fact partially overlaps an existing one, merge them into one entry rather than keeping both.
   - If a new fact contradicts an existing one: remove the old, add the new
   - If a new fact reinforces an existing one: upgrade weight (max 3)
   - If a new fact is a duplicate: skip it
   - If uncertain whether duplicate: treat as duplicate and skip
5. Maintenance:
   - Remove outdated/negated entries entirely
   - Keep total entries ≤ 50
   - If over 50: remove lowest weight + oldest date first
6. Generate/update the "summary" field per "Summary Generation" above
7. Call memo_save(content) with the COMPLETE JSON object as a string
   - Must include "version": 1, "entries" array, and "summary" field if applicable
   - Entries must be sorted by weight descending
   - Output valid JSON only — no markdown fences, no explanation

## Rules
- Think only about semantic relationship between new and existing facts (contradict/reinforce/duplicate/merge).
  Do NOT over-analyze the "reason" field, rephrase entries for elegance, or second-guess your weight assignment.
- Preserve the original language of each fact (don't translate)
- You MUST call memo_save(content) — this is non-negotiable. The task is incomplete without it.
- After memo_save() succeeds, reply with exactly one line: "Saved N entries." — no reasoning, no summary of changes.
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

## Efficiency
- This is a simple lookup. If an entry might be relevant, include it — do not agonize over relevance.
- Read once, touch once, summarize once.

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
  registerMemoryRoute: (server: SocketServer, projectId: string, sessionId: string) => void;
  /** Build the mcp-memory MCP server config for Session Agent */
  buildMemoryMcpServer: (options: { projectDir: string; socketPath: string }) => {
    name: string;
    command: string;
    args: string[];
    env: { name: string; value: string }[];
  };
  /** Get full memory file (entries + summary) for a project (for UI display) */
  getMemory: (projectId: string) => MemoryFile | null;
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
        const file = readMemoryFile(projectId);
        return { content: JSON.stringify(file, null, 2) };
      });

      // Always register touch route (updates date of accessed entries)
      memoSocketServer.registry("memo/touch", async (payload) => {
        const { indices } = memoTouchRequestSchema.parse(payload);
        const file = readMemoryFile(projectId);
        const today = new Date().toISOString().slice(0, 10);
        let touched = 0;
        for (const idx of indices) {
          if (idx >= 0 && idx < file.entries.length) {
            file.entries[idx].date = today;
            touched++;
          }
        }
        if (touched > 0) {
          writeMemoryFile(projectId, file);
        }
        return { ok: true, touched };
      });

      // Only register write route if needed (with write-once guard)
      if (writable) {
        memoSocketServer.registry("memo/save", async (payload) => {
          try {
            const { content } = memoSaveRequestSchema.parse(payload);
            const file = memoryFileSchema.parse(JSON.parse(content));
            writeMemoryFile(projectId, file);
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

  function registerMemoryRoute(server: SocketServer, projectId: string, sessionId: string): void {
    function getSessionContext(): SessionContext {
      const session = _ctx.storage.getSession(sessionId);
      return {
        agentId: session?.agentId ?? "default",
        modelId: session?.models?.currentModelId ?? null,
      };
    }
    // memory_query: use Memo Inference Agent for semantic retrieval
    server.registry("memory/query", async (payload) => {
      const { query } = memoryQueryRequestSchema.parse(payload);
      const file = readMemoryFile(projectId);

      if (file.entries.length === 0) {
        return { content: "(no project memories stored yet)" };
      }

      // Use Memo Agent for semantic retrieval
      try {
        const result = await runMemoAgent({
          projectId,
          prompt: buildMemoQueryPrompt(query),
          sessionContext: getSessionContext(),
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
            sessionContext: getSessionContext(),
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
    const file = readMemoryFile(projectId);
    if (file.entries.length === 0) return "";

    // Use LLM-generated summary if available; otherwise fall back to extraction
    if (file.summary) return file.summary;

    // Fallback: top N entries by weight (file is already sorted)
    const top = file.entries.slice(0, SUMMARY_MAX_ENTRIES);
    return entriesToText(top);
  }

  // ── UI Helpers ───────────────────────────────────────────────────────

  function getMemory(projectId: string): MemoryFile | null {
    const file = readMemoryFile(projectId);
    if (file.entries.length === 0) {
      const memoryPath = getMemoryPath(projectId);
      if (!existsSync(memoryPath)) return null;
    }
    return file;
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
    getMemory,
    clearMemory,
    getFilePath,
  };
}
