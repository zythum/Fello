import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { runWithToolUpdates, type ToolUpdateSender } from "../tool-updates";
import type { WorkerService } from "./types";

/**
 * ACP-shaped worker tools. `worker_run` is create+send sugar for a new one-shot job;
 * `worker_create`/`worker_send` map to session/new and session/prompt;
 * `worker_read`/`worker_status` inspect the stored transcript;
 * `worker_close` releases the agent process (a later send reconnects); `worker_terminate`
 * deletes the record. The assistant owns every lifecycle decision (there is no task object).
 */
export function createWorkerTools({
  worker,
  sendUpdate,
}: {
  worker: WorkerService;
  sendUpdate: ToolUpdateSender;
}): ToolSet {
  const types = worker.listTypes();
  // Without a configured type no worker can be created, so expose no worker tools at all.
  if (types.length === 0) return {};

  const typeList = types
    .map((type) => `- ${type.id} ("${type.name}"): ${type.description || "No description"}`)
    .join("\n");
  const typeIdSchema = z
    .enum(types.map((type) => type.id) as [string, ...string[]])
    .describe("Worker type id from the available list. Use the id, not the display name.");

  const workerRun = tool({
    description: `Create and immediately start a worker in one call: it runs worker_create followed by worker_send. Prefer this for any new one-shot job; use worker_create + worker_send only when you need to prepare a worker before starting it or send several turns to the same worker.\n\nChoose the worker type whose name/description best matches the task; its agent, model, features and MCP servers come from Settings → Personal Assistant → Worker types. Choose one of the available types explicitly:\n${typeList}\n\n\`workspace\` is the worker's cwd (absolute, or relative to your workspace) and is created if missing. \`message\` must be a self-contained brief: the worker cannot see this conversation, so state the goal, inputs, files to read or write, where to write, and how to report. Returns a workerId and turnId immediately; the worker continues in the background and you receive a [Worker ... event="finished|failed"] message when it ends. Answer quick questions yourself; use workers for substantial, file-heavy or long jobs.`,
    inputSchema: z.object({
      typeId: typeIdSchema,
      workspace: z
        .string()
        .min(1)
        .describe(
          "Working directory (cwd) for the worker. Absolute, or relative to your workspace. Created if missing.",
        ),
      name: z
        .string()
        .max(100)
        .optional()
        .describe("Short label used in status and events, for example 'meeting notes'."),
      message: z
        .string()
        .min(1)
        .describe(
          "Self-contained instruction: goal, inputs to read, where to write, and how to report back. The worker has no access to this conversation.",
        ),
    }),
    execute: async (input, { toolCallId }) =>
      runWithToolUpdates(
        sendUpdate,
        {
          toolCallId,
          title: `Run worker${input.name ? `: ${input.name}` : ""}`,
          kind: "other",
          rawInput: {
            typeId: input.typeId,
            workspace: input.workspace,
            name: input.name,
            message: input.message.slice(0, 500),
          },
        },
        async () => {
          const created = await worker.create({
            typeId: input.typeId,
            workspace: input.workspace,
            name: input.name,
          });
          try {
            const sent = await worker.send({
              workerId: created.workerId,
              message: input.message,
            });
            return { ...created, turnId: sent.turnId, startedAt: sent.startedAt };
          } catch (error) {
            // Do not leave a half-started worker behind: nobody knows its id.
            await worker.terminate({ workerId: created.workerId }).catch(() => {});
            throw error;
          }
        },
        (result) =>
          `Worker ${result.workerId} (${result.typeName}) running turn ${result.turnId} in ${result.cwd}`,
      ),
  });

  const workerCreate = tool({
    description: `Create a worker without starting it: a persistent ACP agent session you drive in the background. Prefer worker_run for a new one-shot job; use worker_create only when you need to prepare a worker before starting it or reuse it across several turns. Choose the worker type whose name/description best matches the task; its agent, model, features and MCP servers come from Settings → Personal Assistant → Worker types. Choose one of the available types explicitly:\n${typeList}\n\`workspace\` is the worker's cwd (absolute, or relative to your workspace) and is created if missing. Returns a workerId; no work starts until you call worker_send.`,
    inputSchema: z.object({
      typeId: typeIdSchema,
      workspace: z
        .string()
        .min(1)
        .describe(
          "Working directory (cwd) for the worker. Absolute, or relative to your workspace. Created if missing.",
        ),
      name: z
        .string()
        .max(100)
        .optional()
        .describe("Short label used in status and events, for example 'meeting notes'."),
    }),
    execute: async (input, { toolCallId }) =>
      runWithToolUpdates(
        sendUpdate,
        {
          toolCallId,
          title: `Create worker${input.name ? `: ${input.name}` : ""}`,
          kind: "other",
          rawInput: input,
        },
        () => worker.create(input),
        (result) => `Worker ${result.workerId} (${result.typeName}) ready in ${result.cwd}`,
      ),
  });

  return {
    worker_run: workerRun,
    worker_create: workerCreate,
    worker_send: tool({
      description:
        'Send one message to a worker and return immediately with a turnId; the worker continues in the background. Only one turn may run per worker at a time. When the turn finishes or fails you receive a [Worker ... event="finished|failed" turn="..."] message; use worker_read for details. The message must be self-contained: state the goal, inputs, where to write and how to report. A disconnected worker (after worker_close or a restart) reconnects the same ACP session first.',
      inputSchema: z.object({
        workerId: z.string().min(1).describe("Id returned by worker_run or worker_create."),
        message: z
          .string()
          .min(1)
          .describe(
            "Self-contained instruction: goal, inputs to read, where to write, and how to report back.",
          ),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          {
            toolCallId,
            title: `Send to worker ${input.workerId}`,
            kind: "other",
            rawInput: { workerId: input.workerId, message: input.message.slice(0, 500) },
          },
          () => worker.send(input),
          (result) => `Running. turnId=${result.turnId}`,
        ),
    }),

    worker_status: tool({
      description:
        "One worker's current state: lifecycle status, connectionStatus (connected / connecting / disconnected), workspace, current and recent turns, last stop reason/error and any pending permission. Disconnected workers (after worker_close or a restart) reconnect on the next worker_send. Call this before worker_send/worker_close/worker_terminate and whenever the user asks how a job is going.",
      inputSchema: z.object({
        workerId: z.string().min(1).describe("Worker id."),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          {
            toolCallId,
            title: `Worker status ${input.workerId}`,
            kind: "read",
            rawInput: input,
          },
          () => worker.status(input),
          (result) =>
            `${result.name || result.id}: ${result.status}${result.currentTurnId ? ` (turn ${result.currentTurnId})` : ""}`,
        ),
    }),

    worker_list: tool({
      description:
        "List this profile's workers with their lifecycle status, connectionStatus and current turn. Includes closed workers whose agent process was released. Use worker_status for details and worker_terminate to remove workers you are done with.",
      inputSchema: z.object({}),
      execute: async (_input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: "List workers", kind: "read", rawInput: {} },
          async () => ({ workers: await worker.list() }),
          (result) => `${result.workers.length} worker(s)`,
        ),
    }),

    worker_read: tool({
      description:
        "Read one turn of a worker's conversation in the same shape as the JSON export: agent messages and thoughts, tool calls, plans, compactions and nested subagents. Defaults to the latest turn, including one still running. summary (default) truncates long text and strips raw tool payloads; full keeps raw payloads and uses much larger text limits. Use afterEntry to continue a large turn. Turn ids come from worker_run, worker_send, worker_status or the [Worker ...] event. Read the turn before summarising it to the user.",
      inputSchema: z.object({
        workerId: z.string().min(1).describe("Worker id."),
        turnId: z
          .string()
          .optional()
          .describe("Turn to read. Omit for the latest turn, including one still running."),
        afterEntry: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Only return entries with an index greater than this value. Use the last returned index to continue a large turn.",
          ),
        limit: z.number().int().min(1).max(100).optional().describe("Max entries. Default 20."),
        mode: z
          .enum(["summary", "full"])
          .optional()
          .describe(
            "summary truncates long text (default); full returns up to 8k chars per entry.",
          ),
        includeThoughts: z
          .boolean()
          .optional()
          .describe("Include the worker agent's reasoning. Default false."),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          {
            toolCallId,
            title: `Read worker ${input.workerId}${input.turnId ? ` turn ${input.turnId}` : ""}`,
            kind: "read",
            rawInput: input,
          },
          () => worker.read(input),
          (result) =>
            result.turn
              ? `${result.turn.entries.length} entr${result.turn.entries.length === 1 ? "y" : "ies"} from turn ${result.turn.id}`
              : "No turns yet",
        ),
    }),

    worker_cancel: tool({
      description:
        "Ask the worker to stop its current turn. The worker and its agent process stay alive and can be used again. Use worker_close if you also want to release the process.",
      inputSchema: z.object({
        workerId: z.string().min(1).describe("Worker id."),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `Cancel worker ${input.workerId}`, kind: "edit", rawInput: input },
          async () => {
            await worker.cancel(input);
            return { workerId: input.workerId, cancelled: true };
          },
          () => `Cancellation requested for ${input.workerId}`,
        ),
    }),

    worker_close: tool({
      description:
        "Release the worker's agent process while keeping its record, transcript and resume id. The worker is not destroyed: the next worker_send reconnects and continues the same ACP session. Use it to free resources for a worker you are not using right now; use worker_terminate to delete the record.",
      inputSchema: z.object({
        workerId: z.string().min(1).describe("Worker id."),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `Close worker ${input.workerId}`, kind: "edit", rawInput: input },
          async () => {
            await worker.close(input);
            return { workerId: input.workerId, closed: true };
          },
          () => `Worker ${input.workerId} closed`,
        ),
    }),

    worker_terminate: tool({
      description:
        "Delete a worker for good: stop its agent and remove its record and transcript. The workspace is never deleted; delete the files you created with fs_delete when they are inside your own workspace, and ask the user to clean up anything outside it. Use worker_close if you may want to read the transcript later. Terminate workers once their result is reported so they do not accumulate.",
      inputSchema: z.object({
        workerId: z.string().min(1).describe("Worker id."),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          {
            toolCallId,
            title: `Terminate worker ${input.workerId}`,
            kind: "edit",
            rawInput: input,
          },
          async () => {
            await worker.terminate(input);
            return { workerId: input.workerId, terminated: true };
          },
          () => `Worker ${input.workerId} terminated`,
        ),
    }),

    worker_permission: tool({
      description:
        'Answer a worker\'s pending permission request so its turn can continue. The permissionId comes from a [Worker ... event="permission"] message or worker_status.pendingPermission. Decide yourself for harmless operations; if the action could touch files or commands outside the worker workspace, call ask_user first and pass its answer. Unanswered requests are denied after 10 minutes. Never invent a permissionId.',
      inputSchema: z.object({
        permissionId: z.string().min(1).describe("Permission id from the event."),
        decision: z
          .enum(["allow_once", "allow_always", "deny"])
          .describe("allow_once runs the tool once; allow_always remembers it; deny rejects it."),
      }),
      execute: async (input, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          {
            toolCallId,
            title: `Permission ${input.decision}`,
            kind: "other",
            rawInput: input,
          },
          async () => {
            await worker.permission(input);
            return { permissionId: input.permissionId, decision: input.decision };
          },
          (result) => `Permission ${result.decision}`,
        ),
    }),
  };
}
