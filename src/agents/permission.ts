import type {
  AgentSideConnection,
  RequestPermissionResponse,
  ToolCall,
} from "@agentclientprotocol/sdk";

function isPermissionAllowed(response: RequestPermissionResponse): boolean {
  if (response.outcome.outcome !== "selected") return false;
  const optionId = response.outcome.optionId;
  return optionId === "allow_once" || optionId === "allow_always";
}

async function requestToolPermission(
  connection: AgentSideConnection,
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
  connection: AgentSideConnection,
  sessionId: string,
  toolCall: ToolCall,
): Promise<void> {
  const permission = await requestToolPermission(connection, sessionId, toolCall);
  if (isPermissionAllowed(permission)) return;
  if (permission.outcome.outcome === "cancelled") {
    throw new Error(`Permission cancelled for ${toolCall.title}.`);
  }
  throw new Error(`Permission denied for ${toolCall.title}.`);
}
