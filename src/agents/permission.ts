import type { RequestPermissionResponse, ToolCall } from "@agentclientprotocol/sdk";
import type { AgentClientProxy } from "./agent-client-proxy";

export type ToolPermissionMemory = {
  isAlwaysAllowed: (kind: ToolCall["kind"]) => boolean;
  markAlwaysAllowed: (kind: ToolCall["kind"]) => Promise<void>;
};

export type PermissionKind = Exclude<ToolCall["kind"], undefined>;
export type AllowedToolKinds = Set<PermissionKind>;

function isPermissionKind(kind: ToolCall["kind"]): kind is PermissionKind {
  return typeof kind === "string";
}

export function createPermissionMemory(options?: {
  onAlwaysAllowed?: (
    kind: PermissionKind,
    allowedToolKinds: AllowedToolKinds,
  ) => Promise<void> | void;
}): {
  allowedToolKinds: AllowedToolKinds;
  permissionMemory: ToolPermissionMemory;
} {
  const allowedToolKinds = new Set<PermissionKind>();
  return {
    allowedToolKinds,
    permissionMemory: {
      isAlwaysAllowed: (kind: ToolCall["kind"]) =>
        isPermissionKind(kind) ? allowedToolKinds.has(kind) : false,
      markAlwaysAllowed: async (kind: ToolCall["kind"]) => {
        if (!isPermissionKind(kind)) return;
        if (allowedToolKinds.has(kind)) return;
        allowedToolKinds.add(kind);
        await options?.onAlwaysAllowed?.(kind, allowedToolKinds);
      },
    },
  };
}

function isPermissionAllowed(response: RequestPermissionResponse): boolean {
  if (response.outcome.outcome !== "selected") return false;
  const optionId = response.outcome.optionId;
  return optionId === "allow_once" || optionId === "allow_always";
}

async function requestToolPermission(
  connection: AgentClientProxy,
  sessionId: string,
  toolCall: ToolCall,
): Promise<RequestPermissionResponse> {
  return connection.requestPermission({
    sessionId,
    toolCall,
    options: [
      { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
      { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
      { optionId: "reject_once", name: "Reject once", kind: "reject_once" },
    ],
  });
}

export async function ensureToolPermission(
  connection: AgentClientProxy,
  sessionId: string,
  toolCall: ToolCall,
  memory?: ToolPermissionMemory,
): Promise<void> {
  if (memory?.isAlwaysAllowed(toolCall.kind)) return;
  const permission = await requestToolPermission(connection, sessionId, toolCall);
  if (permission.outcome.outcome === "selected" && permission.outcome.optionId === "allow_always") {
    await memory?.markAlwaysAllowed(toolCall.kind);
  }
  if (isPermissionAllowed(permission)) return;
  if (permission.outcome.outcome === "cancelled") {
    throw new Error(`Permission cancelled for ${toolCall.title}.`);
  }
  throw new Error(`Permission denied for ${toolCall.title}.`);
}
