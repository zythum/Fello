import { resolve } from "path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  AgentSideConnection,
  TerminalHandle,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { ensureToolPermission } from "./permission";
import { toEnvVariables } from "./utils";

export type ACPAgentTerminalMap = Map<string, TerminalHandle>;
export type ACPSessionTools = {
  terminals: ACPAgentTerminalMap;
  tools: ToolSet;
};

export type CreateACPClientToolsParams = {
  cwd: string;
  sessionId: string;
  getConnection: () => AgentSideConnection | null;
};

export function createACPClientTools(params: CreateACPClientToolsParams): ACPSessionTools {
  const terminals: ACPAgentTerminalMap = new Map();
  const tools: ToolSet = {
    ReadFile: tool({
      description: "Read a text file from the local filesystem.",
      inputSchema: z.object({
        path: z.string().describe("File path to read."),
        line: z.number().int().positive().optional().describe("1-based start line."),
        limit: z.number().int().positive().optional().describe("Max number of lines to read."),
        cwd: z.string().optional().describe("Absolute working directory."),
      }),
      execute: async ({ path, line, limit, cwd }, { toolCallId }) => {
        const connection = params.getConnection();
        if (!connection) {
          throw new Error("ACP connection is not available.");
        }

        const filename = resolve(cwd ?? params.cwd, path);
        let title = `ReadFile ${filename}`;
        if (line || limit) {
          title += `:${line ?? 0}`;
          if (limit) {
            title += `:${(line ?? 0) + limit}`;
          }
        }
        const toolCall: ToolCall = {
          toolCallId,
          title,
          kind: "read",
          status: "in_progress",
          locations: [
            {
              path: filename,
              line: line,
            },
          ],
          rawInput: { filename, line, limit },
        };
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            ...toolCall,
          },
        });

        try {
          const output = await connection.readTextFile({
            sessionId: params.sessionId,
            path: filename,
            line,
            limit,
          });
          const toolCallCompleteUpdate: ToolCallUpdate = {
            toolCallId,
            status: "completed",
            rawOutput: output,
          };
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...toolCallCompleteUpdate,
            },
          });
          return output;
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          const toolCallErrorUpdate: ToolCallUpdate = {
            toolCallId,
            status: "failed",
            rawOutput: { error: errorText },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: errorText,
                },
              },
            ],
          };
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...toolCallErrorUpdate,
            },
          });
          throw error;
        }
      },
    }),
    WriteFile: tool({
      description: "Write text content to a file on the local filesystem.",
      inputSchema: z.object({
        path: z.string().describe("File path to write."),
        content: z.string().describe("UTF-8 text content."),
        cwd: z.string().optional().describe("Absolute working directory."),
      }),
      execute: async ({ cwd, path, content }, { toolCallId }) => {
        const connection = params.getConnection();
        if (!connection) {
          throw new Error("ACP connection is not available.");
        }

        const filename = resolve(cwd ?? params.cwd, path);
        let title = `WriteFile ${filename}`;
        const toolCall: ToolCall = {
          toolCallId,
          title,
          kind: "edit",
          status: "in_progress",
          locations: [{ path: filename }],
          rawInput: { filename, content },
        };
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            ...toolCall,
          },
        });

        try {
          await ensureToolPermission(connection, params.sessionId, toolCall);
          await connection.writeTextFile({
            sessionId: params.sessionId,
            path: filename,
            content,
          });
          const output = { ok: true };
          const toolCallCompleteUpdate: ToolCallUpdate = {
            toolCallId,
            status: "completed",
            rawOutput: output,
          };
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...toolCallCompleteUpdate,
            },
          });
          return output;
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          const toolCallUpdate: ToolCallUpdate = {
            toolCallId,
            status: "failed",
            rawOutput: { error: errorText },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: errorText,
                },
              },
            ],
          };
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...toolCallUpdate,
            },
          });
          throw error;
        }
      },
    }),
    EditFile: tool({
      description:
        "Edit a text file by replacing existing text with new text (StrReplace style).",
      inputSchema: z.object({
        path: z.string().describe("File path to edit."),
        oldText: z.string().describe("Exact text to find in file."),
        newText: z.string().describe("Replacement text."),
        replaceAll: z.boolean().optional().describe("Replace all matches. Defaults to false."),
        cwd: z.string().optional().describe("Absolute working directory."),
      }),
      execute: async ({ cwd, path, oldText, newText, replaceAll }, { toolCallId }) => {
        const connection = params.getConnection();
        if (!connection) {
          throw new Error("ACP connection is not available.");
        }

        const filename = resolve(cwd ?? params.cwd, path);
        const title = `EditFile ${filename}`;
        const toolCall: ToolCall = {
          toolCallId,
          title,
          kind: "edit",
          status: "in_progress",
          locations: [{ path: filename }],
          rawInput: { filename, oldText, newText, replaceAll: replaceAll ?? false },
        };
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            ...toolCall,
          },
        });

        try {
          await ensureToolPermission(connection, params.sessionId, toolCall);

          if (oldText.length === 0) {
            throw new Error("oldText must not be empty.");
          }

          const currentFile = await connection.readTextFile({
            sessionId: params.sessionId,
            path: filename,
          });
          const currentContent = currentFile.content;
          const shouldReplaceAll = replaceAll ?? false;

          let matchCount = 0;
          let searchIndex = 0;
          while (searchIndex <= currentContent.length) {
            const foundAt = currentContent.indexOf(oldText, searchIndex);
            if (foundAt < 0) {
              break;
            }
            matchCount += 1;
            searchIndex = foundAt + oldText.length;
          }

          if (matchCount === 0) {
            throw new Error("oldText was not found in the file.");
          }
          if (!shouldReplaceAll && matchCount > 1) {
            throw new Error(
              "oldText matched multiple locations. Provide a more specific oldText or set replaceAll=true.",
            );
          }

          const updatedContent = shouldReplaceAll
            ? currentContent.split(oldText).join(newText)
            : currentContent.replace(oldText, newText);

          await connection.writeTextFile({
            sessionId: params.sessionId,
            path: filename,
            content: updatedContent,
          });

          const output = { ok: true, matches: matchCount, replacedAll: shouldReplaceAll };
          const toolCallCompleteUpdate: ToolCallUpdate = {
            toolCallId,
            status: "completed",
            rawOutput: output,
            content: [
              {
                type: "diff",
                path: filename,
                oldText: currentContent,
                newText: updatedContent,
              },
            ],
          };
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...toolCallCompleteUpdate,
            },
          });
          return output;
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          const toolCallUpdate: ToolCallUpdate = {
            toolCallId,
            status: "failed",
            rawOutput: { error: errorText },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: errorText,
                },
              },
            ],
          };
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...toolCallUpdate,
            },
          });
          throw error;
        }
      },
    }),
    Shell: tool({
      description:
        "Run a terminal command and return output/exit status. Terminal is embedded in tool content.",
      inputSchema: z.object({
        command: z.string().describe("Executable command."),
        args: z.array(z.string()).optional().describe("Command arguments."),
        cwd: z.string().optional().describe("Absolute working directory."),
        env: z.record(z.string(), z.string()).optional().describe("Environment variables map."),
        outputByteLimit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Output retention byte limit."),
        timeoutSeconds: z
          .number()
          .positive()
          .optional()
          .describe("Timeout before killing command."),
      }),
      execute: async (
        { command, args, cwd, env, outputByteLimit, timeoutSeconds },
        { toolCallId },
      ) => {
        const connection = params.getConnection();
        if (!connection) {
          throw new Error("ACP connection is not available.");
        }

        const rawInput = { command, args, cwd, env, outputByteLimit, timeoutSeconds };
        let title = `Shell ${command}`;
        if (args) {
          title += " " + args;
        }
        const toolCall: ToolCall = {
          toolCallId,
          title,
          kind: "execute",
          status: "in_progress",
          rawInput,
        };
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            ...toolCall,
          },
        });

        try {
          await ensureToolPermission(connection, params.sessionId, toolCall);

          const timeoutMs = Math.max(1, Math.floor((timeoutSeconds ?? 120) * 1000));
          const terminal = await connection.createTerminal({
            sessionId: params.sessionId,
            command,
            args,
            cwd: cwd ?? null,
            env: toEnvVariables(env),
            outputByteLimit: outputByteLimit ?? null,
          });
          terminals.set(terminal.id, terminal);

          const toolCallStartUpdate: ToolCallUpdate = {
            toolCallId,
            status: "in_progress",
            content: [...(toolCall.content ?? []), { type: "terminal", terminalId: terminal.id }],
          };
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              ...toolCallStartUpdate,
            },
          });

          let timedOut = false;
          let output: {
            output: string;
            truncated: boolean;
            exitStatus?: { exitCode?: number | null; signal?: string | null } | null;
          } | null = null;
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
          const sessionOutput = {
            terminalId: terminal.id,
            output: finalOutput.output,
            truncated: finalOutput.truncated,
            exitStatus: finalOutput.exitStatus ?? null,
            timedOut,
          };
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status: "completed",
              rawOutput: sessionOutput,
              content: toolCallStartUpdate.content,
            },
          });
          return sessionOutput;
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status: "failed",
              rawOutput: { error: errorText },
              content: [
                {
                  type: "content",
                  content: {
                    type: "text",
                    text: errorText,
                  },
                },
              ],
            },
          });
          throw error;
        }
      },
    }),
  };
  return {
    terminals,
    tools,
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
