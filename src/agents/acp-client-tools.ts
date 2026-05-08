import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  AgentSideConnection,
  RequestPermissionResponse,
  TerminalHandle,
  ToolKind,
} from "@agentclientprotocol/sdk";

export type ACPAgentTerminalMap = Map<string, TerminalHandle>;
export type ACPSessionTools = {
  terminals: ACPAgentTerminalMap;
  tools: ToolSet;
  toolMeta: Record<string, { title: string; kind: ToolKind }>;
};

type CreateACPClientToolsParams = {
  sessionId: string;
  getConnection: () => AgentSideConnection | null;
};

function getConnectionOrThrow(getConnection: () => AgentSideConnection | null): AgentSideConnection {
  const connection = getConnection();
  if (!connection) {
    throw new Error("ACP connection is not available.");
  }
  return connection;
}

function toEnvVariables(env: Record<string, string> | undefined): Array<{ name: string; value: string }> | undefined {
  if (!env) return undefined;
  const entries = Object.entries(env);
  if (entries.length === 0) return undefined;
  return entries.map(([name, value]) => ({ name, value }));
}

function isPermissionAllowed(response: RequestPermissionResponse): boolean {
  if (response.outcome.outcome !== "selected") return false;
  const optionId = response.outcome.optionId;
  return optionId === "allow_once" || optionId === "allow_always";
}

async function requestToolPermission(
  connection: AgentSideConnection,
  sessionId: string,
  params: {
    toolCallId: string;
    title: string;
    kind: "read" | "edit" | "execute" | "other";
    rawInput: unknown;
  },
): Promise<RequestPermissionResponse> {
  return connection.requestPermission({
    sessionId,
    toolCall: {
      toolCallId: params.toolCallId,
      title: params.title,
      kind: params.kind,
      status: "pending",
      rawInput: params.rawInput,
    },
    options: [
      { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
      { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
      { optionId: "reject_once", name: "Reject once", kind: "reject_once" },
      { optionId: "reject_always", name: "Reject always", kind: "reject_always" },
    ],
  });
}

async function ensurePermission(
  connection: AgentSideConnection,
  sessionId: string,
  params: {
    toolCallId: string;
    title: string;
    kind: "read" | "edit" | "execute" | "other";
    rawInput: unknown;
  },
): Promise<void> {
  const permission = await requestToolPermission(connection, sessionId, params);
  if (isPermissionAllowed(permission)) return;
  if (permission.outcome.outcome === "cancelled") {
    throw new Error(`Permission cancelled for ${params.title}.`);
  }
  throw new Error(`Permission denied for ${params.title}.`);
}

export function createACPClientTools({ sessionId, getConnection }: CreateACPClientToolsParams): ACPSessionTools {
  const terminals: ACPAgentTerminalMap = new Map();
  const tools: ToolSet = {
    read_text_file: tool({
      description: "Read a text file from the local filesystem.",
      inputSchema: z.object({
        path: z.string().describe("Absolute file path to read."),
        line: z.number().int().positive().optional().describe("1-based start line."),
        limit: z.number().int().positive().optional().describe("Max number of lines to read."),
      }),
      execute: async ({ path, line, limit }) => {
        const connection = getConnectionOrThrow(getConnection);
        return connection.readTextFile({
          sessionId,
          path,
          line,
          limit,
        });
      },
    }),
    write_text_file: tool({
      description: "Write text content to a file on the local filesystem.",
      inputSchema: z.object({
        path: z.string().describe("Absolute file path to write."),
        content: z.string().describe("UTF-8 text content."),
      }),
      execute: async ({ path, content }, { toolCallId }) => {
        const connection = getConnectionOrThrow(getConnection);
        const rawInput = { path, content };
        await ensurePermission(connection, sessionId, {
          toolCallId,
          title: "Write Text File",
          kind: "edit",
          rawInput,
        });
        await connection.writeTextFile({
          sessionId,
          path,
          content,
        });
        return { ok: true };
      },
    }),
    shell: tool({
      description: "Run a terminal command and return output/exit status. Terminal is embedded in tool content.",
      inputSchema: z.object({
        command: z.string().describe("Executable command."),
        args: z.array(z.string()).optional().describe("Command arguments."),
        cwd: z.string().optional().describe("Absolute working directory."),
        env: z.record(z.string(), z.string()).optional().describe("Environment variables map."),
        outputByteLimit: z.number().int().positive().optional().describe("Output retention byte limit."),
        timeoutSeconds: z.number().positive().optional().describe("Timeout before killing command."),
      }),
      execute: async ({ command, args, cwd, env, outputByteLimit, timeoutSeconds }, { toolCallId }) => {
        const connection = getConnectionOrThrow(getConnection);
        const rawInput = { command, args, cwd, env, outputByteLimit, timeoutSeconds };
        await ensurePermission(connection, sessionId, {
          toolCallId,
          title: "Run Shell Command",
          kind: "execute",
          rawInput,
        });

        const timeoutMs = Math.max(1, Math.floor((timeoutSeconds ?? 120) * 1000));
        const terminal = await connection.createTerminal({
          sessionId,
          command,
          args,
          cwd: cwd ?? null,
          env: toEnvVariables(env),
          outputByteLimit: outputByteLimit ?? null,
        });
        terminals.set(terminal.id, terminal);

        await connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "in_progress",
            content: [{ type: "terminal", terminalId: terminal.id }],
          },
        });

        let timedOut = false;
        let output:
          | {
              output: string;
              truncated: boolean;
              exitStatus?: { exitCode?: number | null; signal?: string | null } | null;
            }
          | null = null;
        try {
          const waitPromise = terminal.waitForExit();
          const timeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), timeoutMs);
          });
          const waitResult = await Promise.race([waitPromise, timeoutPromise]);
          if (waitResult === null) {
            timedOut = true;
            await terminal.kill();
          }
        } finally {
          output = await terminal.currentOutput();
          await terminal.release();
          terminals.delete(terminal.id);
        }

        const finalOutput = output ?? { output: "", truncated: false, exitStatus: null };
        return {
          terminalId: terminal.id,
          output: finalOutput.output,
          truncated: finalOutput.truncated,
          exitStatus: finalOutput.exitStatus ?? null,
          timedOut,
        };
      },
    }),
  };
  return {
    terminals,
    tools,
    toolMeta: {
      read_text_file: { title: "Read Text File", kind: "read" },
      write_text_file: { title: "Write Text File", kind: "edit" },
      shell: { title: "Run Shell Command", kind: "execute" },
    },
  };
}

export async function closeACPClientTools(session: ACPSessionTools): Promise<void> {
  const releases: Promise<void>[] = [];
  for (const [terminalId, terminal] of session.terminals.entries()) {
    releases.push(
      terminal
        .release()
        .then(() => {})
        .catch(() => {}),
    );
    session.terminals.delete(terminalId);
  }
  await Promise.all(releases);
}
