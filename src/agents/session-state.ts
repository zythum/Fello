import type { McpServer } from "@agentclientprotocol/sdk";
import type { AgentClientProxy } from "./agent-client-proxy";
import type { ModelMessage } from "ai";
import { createACPClientTools, type ACPSessionTools } from "./acp-client-tools";
import { createMCPSessionTools, type MCPSessionTools } from "./mcp-tools";
import { createPermissionMemory, type AllowedToolKinds, type PermissionKind } from "./permission";

export type SessionState = {
  id: string;
  cwd: string;
  additionalDirectories: string[];
  modelId: string | null;
  history: ModelMessage[];
  abortController: AbortController | null;
  allowedToolKinds: AllowedToolKinds;
  acp: ACPSessionTools;
  mcp: MCPSessionTools;
  /** Tokens currently in context window after the most recent turn. */
  contextUsedTokens: number;
};

function normalizeAdditionalDirectories(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function normalizeMcpServers(value: McpServer[] | undefined): McpServer[] {
  return Array.isArray(value) ? value : [];
}

export async function createSessionState(params: {
  sessionId: string;
  cwd: string;
  additionalDirectories: string[] | undefined;
  mcpServers: McpServer[] | undefined;
  modelId: string | null;
  getConnection: () => AgentClientProxy | null;
  history?: ModelMessage[];
  allowedToolKinds?: PermissionKind[];
  onAllowedToolKindsChanged?: (allowedToolKinds: AllowedToolKinds) => Promise<void> | void;
}): Promise<SessionState> {
  const { allowedToolKinds, permissionMemory } = createPermissionMemory({
    onAlwaysAllowed: async (_kind, nextAllowedToolKinds) => {
      await params.onAllowedToolKindsChanged?.(nextAllowedToolKinds);
    },
  });
  for (const kind of params.allowedToolKinds || []) {
    allowedToolKinds.add(kind);
  }
  const mcp = await createMCPSessionTools({
    cwd: params.cwd,
    mcpServers: normalizeMcpServers(params.mcpServers),
    sessionId: params.sessionId,
    getConnection: params.getConnection,
    permissionMemory,
  });
  const acp = createACPClientTools({
    cwd: params.cwd,
    sessionId: params.sessionId,
    getConnection: params.getConnection,
    permissionMemory,
  });
  return {
    id: params.sessionId,
    cwd: params.cwd,
    additionalDirectories: normalizeAdditionalDirectories(params.additionalDirectories),
    modelId: params.modelId,
    history: params.history || [],
    abortController: null,
    allowedToolKinds,
    acp,
    mcp,
    contextUsedTokens: 0,
  };
}
