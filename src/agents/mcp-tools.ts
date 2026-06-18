import type { ToolSet } from "ai";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ContentBlockSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  AgentSideConnection,
  ContentBlock,
  McpServer,
  ToolCall,
  ToolCallUpdate,
  ToolKind,
} from "@agentclientprotocol/sdk";
import { ensureToolPermission, type ToolPermissionMemory } from "./permission";
import {} from "./utils";

export type MCPSessionTools = {
  clients: MCPClient[];
  tools: ToolSet;
};

export type CreateMCPSessionToolsParams = {
  sessionId: string;
  mcpServers: McpServer[];
  cwd: string;
  getConnection: () => AgentSideConnection | null;
  permissionMemory?: ToolPermissionMemory;
};

function sanitizeName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toHeaderRecord(headers: Array<{ name: string; value: string }>): Record<string, string> {
  return headers.reduce<Record<string, string>>((acc, header) => {
    if (!header.name) return acc;
    acc[header.name] = header.value;
    return acc;
  }, {});
}

function toEnvRecord(env: Array<{ name: string; value: string }>): Record<string, string> {
  return env.reduce<Record<string, string>>((acc, item) => {
    if (!item.name) return acc;
    acc[item.name] = item.value;
    return acc;
  }, {});
}

function inferToolKind(name: string): ToolKind {
  const normalized = name.toLowerCase();
  if (normalized.includes("read") || normalized.includes("list") || normalized.includes("search")) {
    return "read";
  }
  if (
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("update")
  ) {
    return "edit";
  }
  if (normalized.includes("run") || normalized.includes("exec") || normalized.includes("command")) {
    return "execute";
  }
  return "other";
}

async function createClient(server: McpServer, cwd: string): Promise<MCPClient> {
  if ("type" in server) {
    if (server.type === "http" || server.type === "sse") {
      return createMCPClient({
        transport: {
          type: server.type,
          url: server.url,
          headers: toHeaderRecord(server.headers),
        },
        clientName: "fello-openai-compatible-agent",
        version: "0.1.0",
      });
    }
    throw new Error(`McpServer Type: ${server.type} not supported.`);
  }
  return createMCPClient({
    transport: new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: toEnvRecord(server.env),
      cwd,
    }),
    clientName: "fello-openai-compatible-agent",
    version: "0.1.0",
  });
}

async function closeClients(clients: MCPClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.close().catch(() => {})));
}

export async function createMCPSessionTools(
  params: CreateMCPSessionToolsParams,
): Promise<MCPSessionTools> {
  if (params.mcpServers.length === 0) {
    return { clients: [], tools: {} };
  }

  const clients: MCPClient[] = [];
  try {
    for (const server of params.mcpServers) {
      try {
        clients.push(await createClient(server, params.cwd));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to connect MCP server "${server.name}": ${reason}`);
      }
    }

    const allTools: ToolSet = {};

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      const server = params.mcpServers[i];
      const prefix = sanitizeName(server.name || `server_${i + 1}`) || `server_${i + 1}`;
      const [serverTools, definitions] = await Promise.all([client.tools(), client.listTools()]);
      const definitionsByName = new Map(definitions.tools.map((item) => [item.name, item]));

      for (const [toolName, toolDef] of Object.entries(serverTools)) {
        const qualifiedName = `mcp_${prefix}__${toolName}`;
        const details = definitionsByName.get(toolName);
        const title = details?.title || `${server.name}: ${toolName}`;
        const kind = inferToolKind(toolName);

        if (typeof toolDef.execute !== "function") {
          allTools[qualifiedName] = toolDef;
          continue;
        }
        allTools[qualifiedName] = {
          ...toolDef,
          execute: async (input, options) => {
            const connection = params.getConnection();
            if (!connection) {
              throw new Error("ACP connection is not available.");
            }

            const toolCallId = options.toolCallId;

            let subTitle = "";
            if (typeof input === "string") {
              subTitle = input;
            } else if (input && typeof input === "object") {
              for (const key in input) {
                const value = input[key];
                if (typeof value !== "string") {
                  continue;
                }
                if (value.length > 5 && value.length > subTitle.length) {
                  subTitle = value;
                }
              }
            }
            if (subTitle) {
              subTitle = " " + subTitle;
            }
            const toolCall: ToolCall = {
              toolCallId,
              title: `${title}${subTitle}`,
              kind,
              status: "in_progress",
              rawInput: input,
            };

            await connection.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "tool_call",
                ...toolCall,
              },
            });
            await ensureToolPermission(
              connection,
              params.sessionId,
              toolCall,
              params.permissionMemory,
            );

            try {
              const output: any = await toolDef.execute(input, options);

              const contents: any[] = [];
              if (
                typeof output === "string" ||
                typeof output === "boolean" ||
                typeof output === "number"
              ) {
                contents.push(output);
              } else if (typeof output === "object" && output && output.content) {
                if (Array.isArray(output.content) && output.content.length > 0) {
                  contents.push(...output.content);
                } else if (output.content) {
                  contents.push(output.content);
                }
              }

              if (connection && toolCallId) {
                const toolCallComplateUpdate: ToolCallUpdate = {
                  toolCallId,
                  status: output?.isError ? "failed" : "completed",
                  content: contents.map((content) => {
                    let contentBlock: ContentBlock;
                    if (ContentBlockSchema.safeParse(content).success) {
                      contentBlock = content;
                    } else {
                      if (typeof content === "object" && content) {
                        try {
                          contentBlock = {
                            type: "text",
                            text: JSON.stringify(content),
                          };
                        } catch (err) {
                          contentBlock = {
                            type: "text",
                            text: "",
                          };
                          console.warn("[MCP] Parse ContentBlock Error", err);
                        }
                      } else {
                        contentBlock = {
                          type: "text",
                          text: String(content),
                        };
                      }
                    }
                    return {
                      type: "content" as const,
                      content: contentBlock,
                    };
                  }),
                };
                await connection.sessionUpdate({
                  sessionId: params.sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    ...toolCallComplateUpdate,
                  },
                });
              }
              return output;
            } catch (error) {
              if (connection && toolCallId) {
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
              }
              throw error;
            }
          },
        };
      }
    }

    return {
      clients,
      tools: allTools,
    };
  } catch (error) {
    await closeClients(clients);
    throw error;
  }
}

export async function closeMCPSessionTools(session: MCPSessionTools): Promise<void> {
  await closeClients(session.clients);
}
