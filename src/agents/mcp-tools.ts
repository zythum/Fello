import type { ToolSet } from "ai";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServer, ToolKind } from "@agentclientprotocol/sdk";

export type MCPSessionTools = {
  clients: MCPClient[];
  tools: ToolSet;
  toolMeta: Record<string, { title: string; kind: ToolKind }>;
};

type CreateMCPSessionToolsParams = {
  mcpServers: McpServer[];
  cwd: string;
};

type MCPToolsResult = Awaited<ReturnType<MCPClient["tools"]>>;
type MCPListToolsResult = Awaited<ReturnType<MCPClient["listTools"]>>;

function sanitizeName(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
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
  if (normalized.includes("write") || normalized.includes("edit") || normalized.includes("update")) {
    return "edit";
  }
  if (normalized.includes("run") || normalized.includes("exec") || normalized.includes("command")) {
    return "execute";
  }
  return "other";
}

async function createClient(server: McpServer, cwd: string): Promise<MCPClient> {
  if ("type" in server) {
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

export async function createMCPSessionTools({
  mcpServers,
  cwd,
}: CreateMCPSessionToolsParams): Promise<MCPSessionTools> {
  if (mcpServers.length === 0) {
    return { clients: [], tools: {}, toolMeta: {} };
  }

  const clients: MCPClient[] = [];
  try {
    for (const server of mcpServers) {
      try {
        clients.push(await createClient(server, cwd));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to connect MCP server "${server.name}": ${reason}`);
      }
    }

    const allTools: ToolSet = {};
    const toolMeta: Record<string, { title: string; kind: ToolKind }> = {};
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      const server = mcpServers[i];
      const prefix = sanitizeName(server.name || `server_${i + 1}`) || `server_${i + 1}`;
      const [serverTools, definitions] = await Promise.all([
        client.tools(),
        client.listTools(),
      ]) as [MCPToolsResult, MCPListToolsResult];
      const definitionsByName = new Map(definitions.tools.map((item) => [item.name, item]));

      for (const [toolName, toolDef] of Object.entries(serverTools)) {
        const qualifiedName = `mcp_${prefix}__${toolName}`;
        allTools[qualifiedName] = toolDef;

        const details = definitionsByName.get(toolName);
        const title = details?.title || `${server.name}: ${toolName}`;
        toolMeta[qualifiedName] = {
          title,
          kind: inferToolKind(toolName),
        };
      }
    }

    return {
      clients,
      tools: allTools,
      toolMeta,
    };
  } catch (error) {
    await closeClients(clients);
    throw error;
  }
}

export async function closeMCPSessionTools(session: MCPSessionTools): Promise<void> {
  await closeClients(session.clients);
}
