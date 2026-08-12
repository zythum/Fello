import type {
  AvailableCommand,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AddonSessionUpdate, SubagentStatus } from "../../shared/schema";
import { AcpAdapter } from "./acp-adapter";

// ── Status map ───────────────────────────────────────────────────────

/** Kiro subagent status.type → Fello SubagentStatus */
const KIRO_STATUS_MAP: Record<string, SubagentStatus> = {
  pending: "pending",
  working: "in_progress",
  terminated: "completed",
  failed: "failed",
};

// ── Param types ──────────────────────────────────────────────────────

interface MetadataParams {
  sessionId: string;
  contextUsagePercentage: number;
}
interface CommandsAvailableParams {
  sessionId: string;
  commands: Array<{ name: string; description?: string }>;
}
interface SubagentListParams {
  subagents: Array<{
    sessionId: string;
    sessionName?: string;
    initialQuery?: string;
    status?: { type: string };
  }>;
}

// ── Parse functions (type narrowing for the ACP SDK) ───────────────
// These declare the expected param shape for SDK-level type narrowing.
// Runtime validation happens in the handler methods below.

const parseMetadata = (p: unknown): MetadataParams => p as MetadataParams;
const parseCommandsAvailable = (p: unknown): CommandsAvailableParams =>
  p as CommandsAvailableParams;
const parseSubagentList = (p: unknown): SubagentListParams =>
  p as SubagentListParams;

// ── Adapter ──────────────────────────────────────────────────────────

/**
 * Adapts Kiro protocol ext notifications (`_kiro.dev/*`) into Fello's
 * canonical SessionNotification stream. Produces synthetic notifications
 * that bridge-connect feeds back through processSessionUpdate, so all
 * storage/broadcast handling is unified.
 *
 * Handles:
 * - `_kiro.dev/metadata` → usage_update
 * - `_kiro.dev/commands/available` → available_commands_update
 * - `_kiro.dev/subagent/list_update` → session_info_update (subagent_update)
 */
export class KiroAdapter extends AcpAdapter {
  /** Ext notification specs declared here, registered by ACPBridge. */
  override extNotificationSpecs = [
    { method: "_kiro.dev/metadata", parse: parseMetadata },
    { method: "_kiro.dev/commands/available", parse: parseCommandsAvailable },
    { method: "_kiro.dev/subagent/list_update", parse: parseSubagentList },
  ];

  /**
   * Translate a Kiro ext notification into synthetic SessionNotification(s).
   * Returns an empty array if the method is unrecognized.
   */
  override handleExtNotification(
    method: string,
    params: unknown,
    currentSessionId: string | null,
    agentId: string,
  ): SessionNotification[] {
    switch (method) {
      case "_kiro.dev/metadata":
        return this.handleMetadata(params, currentSessionId, agentId);
      case "_kiro.dev/commands/available":
        return this.handleCommandsAvailable(params, currentSessionId, agentId);
      case "_kiro.dev/subagent/list_update":
        return this.handleSubagentListUpdate(params, currentSessionId, agentId);
      default:
        return [];
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────

  private handleMetadata(
    params: unknown,
    currentSessionId: string | null,
    agentId: string,
  ): SessionNotification[] {
    if (
      typeof params === "object" &&
      params &&
      "sessionId" in params &&
      typeof params.sessionId === "string" &&
      "contextUsagePercentage" in params &&
      typeof params.contextUsagePercentage === "number" &&
      currentSessionId === `${agentId}:${params.sessionId}`
    ) {
      return [
        {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "usage_update",
            used: params.contextUsagePercentage / 100,
            size: 1,
          },
        },
      ];
    }
    return [];
  }

  private handleCommandsAvailable(
    params: unknown,
    currentSessionId: string | null,
    agentId: string,
  ): SessionNotification[] {
    if (
      typeof params === "object" &&
      params &&
      "sessionId" in params &&
      typeof params.sessionId === "string" &&
      "commands" in params &&
      Array.isArray(params.commands) &&
      currentSessionId === `${agentId}:${params.sessionId}`
    ) {
      const commands: AvailableCommand[] = [];
      for (const item of params.commands) {
        if (
          typeof item === "object" &&
          item &&
          "name" in item &&
          typeof item.name === "string"
        ) {
          commands.push({
            name: item.name.replace(/^\//, ""),
            description: item.description ? String(item.description) : "",
          });
        }
      }
      return [
        {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: commands,
          },
        },
      ];
    }
    return [];
  }

  private handleSubagentListUpdate(
    params: unknown,
    currentSessionId: string | null,
    agentId: string,
  ): SessionNotification[] {
    // kiro 没有给主 session 的 sessionId，只能这样兼容
    if (
      typeof params === "object" &&
      params &&
      currentSessionId &&
      "subagents" in params &&
      Array.isArray(params.subagents)
    ) {
      const results: SessionNotification[] = [];
      for (const subagent of params.subagents) {
        if (
          typeof subagent === "object" &&
          subagent &&
          "sessionId" in subagent &&
          typeof subagent.sessionId === "string"
        ) {
          const update: AddonSessionUpdate = {
            sessionUpdate: "subagent_update",
            sessionId: subagent.sessionId,
            name: typeof subagent.sessionName === "string" ? subagent.sessionName : undefined,
            prompt:
              typeof subagent.initialQuery === "string" ? subagent.initialQuery : undefined,
            status: KIRO_STATUS_MAP[String(subagent?.status?.type)],
          };
          results.push({
            sessionId: currentSessionId.replace(`${agentId}:`, ""),
            update: {
              sessionUpdate: "session_info_update",
              _meta: { fello: { update } },
            },
          });
        }
      }
      return results;
    }
    return [];
  }
}
