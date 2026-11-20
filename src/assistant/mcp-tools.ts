import type { ToolSet } from "ai";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolKind } from "@agentclientprotocol/sdk";
import type { McpServer } from "@agentclientprotocol/sdk/unstable";
import { buildProxyEnv } from "../backend/proxy";
import type { ToolUpdateSender } from "./tool-updates";

export type AssistantMcpTools = {
  clients: MCPClient[];
  tools: ToolSet;
};

export type CreateAssistantMcpToolsParams = {
  servers: McpServer[];
  cwd: string;
  sendUpdate: ToolUpdateSender;
};

const MAX_TOOL_SUMMARY_CHARS = 2_000;

function sanitizeName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toHeaderRecord(headers: Array<{ name: string; value: string }>): Record<string, string> {
  return headers.reduce<Record<string, string>>((acc, header) => {
    if (header.name) acc[header.name] = header.value;
    return acc;
  }, {});
}

function toEnvRecord(env: Array<{ name: string; value: string }>): Record<string, string> {
  return env.reduce<Record<string, string>>((acc, item) => {
    if (item.name) acc[item.name] = item.value;
    return acc;
  }, {});
}

function inferToolKind(name: string): ToolKind {
  const normalized = name.toLowerCase();
  if (
    normalized.includes("read") ||
    normalized.includes("list") ||
    normalized.includes("search") ||
    normalized.includes("fetch") ||
    normalized.includes("grep") ||
    normalized.includes("glob")
  ) {
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
        clientName: "fello-personal-assistant",
        version: "0.1.0",
      });
    }
    throw new Error(`McpServer Type: ${server.type} not supported.`);
  }
  // Keep proxy-related env explicit for stdio servers, matching the ACP MCP client.
  return createMCPClient({
    transport: new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: {
        ...buildProxyEnv(),
        ...toEnvRecord(server.env),
      },
      cwd,
    }),
    clientName: "fello-personal-assistant",
    version: "0.1.0",
  });
}

async function closeClients(clients: MCPClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.close().catch(() => {})));
}

function truncate(text: string): string {
  return text.length > MAX_TOOL_SUMMARY_CHARS
    ? `${text.slice(0, MAX_TOOL_SUMMARY_CHARS)}…`
    : text;
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const item = value as { type?: unknown; text?: unknown; content?: unknown };
  if (item.type === "text" && typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  return null;
}

function summarizeOutput(output: unknown): string {
  if (typeof output === "string") return truncate(output);
  if (output && typeof output === "object") {
    const content = (output as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .map(extractText)
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join("\n");
      if (text) return truncate(text);
    }
    const text = extractText(content);
    if (text) return truncate(text);
    try {
      return truncate(JSON.stringify(output));
    } catch {
      return "";
    }
  }
  return output == null ? "" : truncate(String(output));
}

/**
 * Connects the assistant's selected MCP servers and returns their tools under
 * `mcp_<server>__<tool>` names. Tool calls are reported through the same ACP
 * notifications used by the assistant's built-in tools.
 */
export async function createAssistantMcpTools(
  params: CreateAssistantMcpToolsParams,
): Promise<AssistantMcpTools> {
  if (params.servers.length === 0) return { clients: [], tools: {} };

  const clients: MCPClient[] = [];
  try {
    for (const server of params.servers) {
      try {
        clients.push(await createClient(server, params.cwd));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to connect MCP server "${server.name}": ${reason}`);
      }
    }

    const tools: ToolSet = {};
    for (let index = 0; index < clients.length; index += 1) {
      const client = clients[index];
      const server = params.servers[index];
      const prefix = sanitizeName(server.name || `server_${index + 1}`) || `server_${index + 1}`;
      const [serverTools, definitions] = await Promise.all([client.tools(), client.listTools()]);
      const definitionsByName = new Map(definitions.tools.map((item) => [item.name, item]));

      for (const [toolName, toolDef] of Object.entries(serverTools)) {
        const qualifiedName = `mcp_${prefix}__${toolName}`;
        const execute = toolDef.execute;
        if (typeof execute !== "function") {
          tools[qualifiedName] = toolDef;
          continue;
        }
        const title = definitionsByName.get(toolName)?.title || `${server.name}/${toolName}`;
        const kind = inferToolKind(toolName);

        tools[qualifiedName] = {
          ...toolDef,
          execute: async (input, options) => {
            const toolCallId = options.toolCallId;
            await params.sendUpdate({
              sessionUpdate: "tool_call",
              toolCallId,
              title,
              kind,
              status: "in_progress",
              rawInput: input,
            });
            try {
              const output = await execute(input, options);
              const failed =
                !!output &&
                typeof output === "object" &&
                (output as { isError?: unknown }).isError === true;
              await params.sendUpdate({
                sessionUpdate: "tool_call_update",
                toolCallId,
                status: failed ? "failed" : "completed",
                content: [
                  {
                    type: "content",
                    content: { type: "text", text: summarizeOutput(output) },
                  },
                ],
              });
              return output;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              await params.sendUpdate({
                sessionUpdate: "tool_call_update",
                toolCallId,
                status: "failed",
                content: [{ type: "content", content: { type: "text", text: message } }],
              });
              throw error;
            }
          },
        };
      }
    }

    return { clients, tools };
  } catch (error) {
    await closeClients(clients);
    throw error;
  }
}

export async function closeAssistantMcpTools(session: AssistantMcpTools): Promise<void> {
  await closeClients(session.clients);
}
