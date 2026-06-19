import { resolve } from "path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  AgentSideConnection,
  TerminalHandle,
  ToolCall,
  ToolCallUpdate,
  Plan,
  PlanEntry,
} from "@agentclientprotocol/sdk";
import { ensureToolPermission, type ToolPermissionMemory } from "./permission";
import { toEnvVariables } from "./utils";
import { extractOutline, outlineToSummary } from "./file-outline";

export type ACPAgentTerminalMap = Map<string, TerminalHandle>;
export type ACPSessionTools = {
  terminals: ACPAgentTerminalMap;
  tools: ToolSet;
};

export type CreateACPClientToolsParams = {
  cwd: string;
  sessionId: string;
  getConnection: () => AgentSideConnection | null;
  permissionMemory?: ToolPermissionMemory;
};

export function createACPClientTools(params: CreateACPClientToolsParams): ACPSessionTools {
  const terminals: ACPAgentTerminalMap = new Map();
  const tools: ToolSet = {
    ReadFile: tool({
      description: `Read a text file from the local filesystem.
NOTE: Files larger than 100KB cannot be read fully without setting force=true.
Always prefer using line/limit to read specific sections, or use GetFileOutline first.`,
      inputSchema: z.object({
        path: z.string().describe("File path to read."),
        line: z.number().int().positive().optional().describe("1-based start line."),
        limit: z.number().int().positive().optional().describe("Max number of lines to read."),
        cwd: z.string().optional().describe("Absolute working directory."),
        force: z
          .boolean()
          .optional()
          .describe(
            "Bypass the 100KB size limit. Only use when you absolutely need the full file content.",
          ),
      }),
      execute: async ({ path, line, limit, cwd, force }, { toolCallId }) => {
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
          rawInput: { filename, line, limit, force },
        };
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            ...toolCall,
          },
        });

        try {
          const MAX_SIZE_BYTES = 100 * 1024; // 100KB
          const LIMIT_SIZE_BYTES = 1024 * 1024; // 1024KB

          // For targeted reads (line/limit specified), always allow
          const isFullFileRead = !line && !limit;

          let output = await connection.readTextFile({
            sessionId: params.sessionId,
            path: filename,
            line,
            limit,
          });

          if (output.content) {
            const byteSize = new TextEncoder().encode(output.content).length;
            if (byteSize > LIMIT_SIZE_BYTES) {
              const sizeMB = (byteSize / 1024 / 1024).toFixed(2);
              throw new Error(
                `This file is ${sizeMB}MB, over 1 MB limit. Please do not read it directly.`,
              );
            }

            // Check size limit on full-file reads
            if (isFullFileRead && !force) {
              // Use TextEncoder for accurate byte count (handles UTF-8 multi-byte chars)
              if (byteSize > MAX_SIZE_BYTES) {
                const sizeKB = (byteSize / 1024).toFixed(2);
                throw new Error(
                  `File is ${sizeKB}KB (limit: 100KB). Use GetFileOutline first to see file structure, then ReadFile with line/limit to read specific sections. ` +
                    `If you genuinely need the full content, set force=true.`,
                );
              }
            }
          }

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
          return output.content;
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
      description: `Write text content to a file on the local filesystem.`,
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
          rawInput: { ok: true },
        };
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            ...toolCall,
          },
        });

        try {
          await ensureToolPermission(
            connection,
            params.sessionId,
            toolCall,
            params.permissionMemory,
          );
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
      description: `Edit a text file by replacing existing text with new text (StrReplace style).
Use exact string matching for oldText and set replaceAll=true when needed.`,
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
          await ensureToolPermission(
            connection,
            params.sessionId,
            toolCall,
            params.permissionMemory,
          );

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
      description: `Run a terminal command and return output/exit status (similar to bash/sh execution).
Prefer dedicated tools first:
- LS: list files (equivalent: ls -la)
- Grep: search content (equivalent: rg "pattern" src or grep -R "pattern" src)
- Glob/find-style discovery: find files (equivalent: find . -name "*.ts")
Use Shell as fallback when those tools cannot complete the task.
Avoid destructive commands and prefer deterministic, non-interactive commands.`,
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
        if (args && args.length) {
          title += " " + args.join(" ");
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
          await ensureToolPermission(
            connection,
            params.sessionId,
            toolCall,
            params.permissionMemory,
          );

          const timeoutMs = timeoutSeconds
            ? Math.max(1000, Math.floor(timeoutSeconds * 1000))
            : null;
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
            if (timeoutMs) {
              const timeoutPromise = new Promise<null>((resolve) => {
                setTimeout(() => resolve(null), timeoutMs);
              });
              const waitResult = await Promise.race([waitPromise, timeoutPromise]);
              if (waitResult === null) {
                timedOut = true;
                await terminal.kill();
              }
            } else {
              await waitPromise;
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
    Plan: tool({
      description: `Create or update an execution plan for the current session.
Plans consist of multiple entries representing tasks or goals.
Each entry has a content description, priority (high/medium/low), and status (pending/in_progress/completed).
This tool directly sends a plan update to the client, which replaces the entire plan with the provided entries.`,
      inputSchema: z.object({
        entries: z
          .array(
            z.object({
              content: z.string().describe("Human-readable description of the task."),
              priority: z
                .enum(["high", "medium", "low"])
                .describe("Relative importance of the task."),
              status: z
                .enum(["pending", "in_progress", "completed"])
                .describe("Current execution status of the task."),
            }),
          )
          .describe(
            "The list of plan entries. The client replaces the entire plan with this list.",
          ),
      }),
      execute: async ({ entries }) => {
        const connection = params.getConnection();
        if (!connection) {
          throw new Error("ACP connection is not available.");
        }

        // Send the plan update directly
        const plan: Plan = {
          entries: entries.map(
            (entry): PlanEntry => ({
              content: entry.content,
              priority: entry.priority,
              status: entry.status,
            }),
          ),
        };
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "plan",
            ...plan,
          },
        });

        return { success: true, entriesCount: entries.length };
      },
    }),
    GetFileOutline: tool({
      description: `Get a structural outline of a file WITHOUT reading its full content.
Uses AST parsing (ast-grep) to extract function/class/interface/type/property signatures with line ranges and JSDoc comments.
Returns tree-structured metadata only - no code body is included.
Not subject to ReadFile's 100KB limit (only metadata is returned).
Use this FIRST before ReadFile to understand a file's structure.
Supports: TypeScript (.ts), JavaScript/JSX (.js/.jsx/.mjs/.cjs), TSX (.tsx).`,
      inputSchema: z.object({
        path: z.string().describe("File path to analyze."),
        cwd: z.string().optional().describe("Absolute working directory."),
      }),
      execute: async ({ path, cwd }, { toolCallId }) => {
        const connection = params.getConnection();
        if (!connection) {
          throw new Error("ACP connection is not available.");
        }

        const filename = resolve(cwd ?? params.cwd, path);
        const title = `GetFileOutline ${filename}`;
        const toolCall: ToolCall = {
          toolCallId,
          title,
          kind: "read",
          status: "in_progress",
          locations: [{ path: filename }],
          rawInput: { filename },
        };
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: { sessionUpdate: "tool_call", ...toolCall },
        });

        try {
          const fileContent = await connection.readTextFile({
            sessionId: params.sessionId,
            path: filename,
          });

          const outline = await extractOutline(filename, fileContent.content);
          const summary = outlineToSummary(outline);

          const toolCallCompleteUpdate: ToolCallUpdate = {
            toolCallId,
            status: "completed",
            rawOutput: summary,
          };
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: { sessionUpdate: "tool_call_update", ...toolCallCompleteUpdate },
          });
          return summary;
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          const toolCallErrorUpdate: ToolCallUpdate = {
            toolCallId,
            status: "failed",
            rawOutput: { error: errorText },
            content: [
              {
                type: "content",
                content: { type: "text", text: errorText },
              },
            ],
          };
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: { sessionUpdate: "tool_call_update", ...toolCallErrorUpdate },
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
