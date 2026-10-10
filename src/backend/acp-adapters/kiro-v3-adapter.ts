import type { SessionNotification, ToolCall, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type { AddonSessionUpdate, SubagentStatus } from "../../shared/schema";
import { AcpAdapter } from "./acp-adapter";

// ── Protocol notes (kiro-cli v3, `kiro-cli acp --agent-engine=v3`) ────
//
// Unlike v2 (KiroAdapter), v3 no longer sends `_kiro.dev/*` extension
// notifications. Everything is inlined into standard session notifications
// under `update._meta.kiro`:
//
// - session_info_update + _meta.kiro.kind="context_usage"
//     → context window usage (usagePercentage 0-100 + breakdown)
// - session_info_update + _meta.kiro.kind="focus_update"
//     → session title / status (kept, so the title still flows to Fello)
// - session_info_update + _meta.kiro.kind= turn_start/turn_end/
//   turn_completion/user_message_id_assigned → housekeeping (dropped)
// - tool_call / tool_call_update + _meta.kiro.kind="agent-subtask"
//     → sub-agent registration + lifecycle
// - agent_message_chunk / agent_thought_chunk / tool_call / tool_call_update
//   carrying _meta.kiro.agentSubtaskId → sub-agent content. It reuses the
//   MAIN sessionId, so it must be re-routed to the sub-agent bucket.

// ── Types ────────────────────────────────────────────────────────────

/** Subset of the `_meta.kiro` payload this adapter reads. */
interface KiroMeta {
  kind?: string;
  toolId?: string;
  usagePercentage?: number;
  contextUsage?: { usagePercentage?: number };
  agentSubtaskId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Kiro v3 tool_call status → Fello SubagentStatus (identical vocabulary). */
const STATUS_MAP: Record<string, SubagentStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  failed: "failed",
};

/**
 * `_meta.kiro.toolId` values for kiro-internal plumbing tool calls that must
 * not surface in the chat (e.g. "fetch_cloud_config" on session startup /
 * each turn). Their follow-up `tool_call_update` carries no `_meta.kiro`.
 */
const INTERNAL_TOOL_IDS = new Set(["fetch_cloud_config"]);

function getKiroMeta(notification: SessionNotification): KiroMeta | null {
  const kiro = notification.update._meta?.["kiro"];
  if (typeof kiro !== "object" || kiro === null) return null;
  return kiro as KiroMeta;
}

/** Build the synthetic session_info_update carrying an AddonSessionUpdate. */
function makeSubagentUpdate(mainSessionId: string, addon: AddonSessionUpdate): SessionNotification {
  return {
    sessionId: mainSessionId,
    update: {
      sessionUpdate: "session_info_update",
      _meta: { fello: { update: addon } },
    },
  };
}

// ── Adapter ──────────────────────────────────────────────────────────

/**
 * Adapts kiro-cli v3 protocol extensions (all under `_meta.kiro`) into
 * Fello's canonical SessionNotification stream.
 *
 * Handles:
 * - `context_usage` → usage_update
 * - `agent-subtask` tool calls → subagent_update (registration + lifecycle)
 * - sub-agent content tagged with `agentSubtaskId` → re-keyed to the
 *   sub-agent's sessionId so the reducer routes it into the sub-agent bucket
 * - kiro-internal plumbing tool calls (e.g. `fetch_cloud_config`) → dropped,
 *   together with their follow-up `tool_call_update`
 * - remaining v3 housekeeping session_info_updates → dropped
 */
export class KiroV3Adapter extends AcpAdapter {
  /** toolCallIds of suppressed kiro-internal tool calls, keyed by session key. */
  private hiddenToolCalls = new Map<string, Set<string>>();

  override preprocessNotification(
    notification: SessionNotification,
    currentSessionId: string,
  ): SessionNotification[] | null {
    const update = notification.update;

    // ── Drop follow-up updates of hidden internal tool calls ────────
    // These updates carry no `_meta.kiro`, so the recorded toolCallId is
    // the only handle; without this they'd render as empty tool cards.
    if (
      update.sessionUpdate === "tool_call_update" &&
      this.isHiddenToolCall(currentSessionId, update.toolCallId)
    ) {
      if (update.status === "completed" || update.status === "failed") {
        this.forgetHiddenToolCall(currentSessionId, update.toolCallId);
      }
      return null;
    }

    const kiro = getKiroMeta(notification);

    // ── Drop kiro-internal plumbing tool calls ──────────────────────
    if (
      kiro &&
      update.sessionUpdate === "tool_call" &&
      typeof kiro.toolId === "string" &&
      INTERNAL_TOOL_IDS.has(kiro.toolId)
    ) {
      this.hideToolCall(currentSessionId, update.toolCallId);
      return null;
    }

    if (!kiro) return [notification];

    const subtaskId = typeof kiro.agentSubtaskId === "string" ? kiro.agentSubtaskId : null;

    // ── Context usage → usage_update ────────────────────────────────
    if (update.sessionUpdate === "session_info_update" && kiro.kind === "context_usage") {
      const percentage =
        typeof kiro.usagePercentage === "number"
          ? kiro.usagePercentage
          : typeof kiro.contextUsage?.usagePercentage === "number"
            ? kiro.contextUsage.usagePercentage
            : null;
      if (percentage === null) return null;
      return [
        {
          sessionId: notification.sessionId,
          update: { sessionUpdate: "usage_update", used: percentage / 100, size: 1 },
        },
      ];
    }

    // ── Sub-agent registration / lifecycle → subagent_update ────────
    if (kiro.kind === "agent-subtask") {
      if (
        subtaskId &&
        (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update")
      ) {
        const { name, prompt } = readSubtaskInput(update);
        const status = typeof update.status === "string" ? STATUS_MAP[update.status] : undefined;
        const addon: AddonSessionUpdate = {
          sessionUpdate: "subagent_update",
          sessionId: subtaskId,
          ...(name !== undefined && { name }),
          ...(prompt !== undefined && { prompt }),
          ...(status !== undefined && { status }),
        };
        return [makeSubagentUpdate(notification.sessionId, addon)];
      }
      return null;
    }

    // ── Re-route sub-agent content into its own session bucket ──────
    if (
      subtaskId &&
      (update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk" ||
        update.sessionUpdate === "tool_call" ||
        update.sessionUpdate === "tool_call_update")
    ) {
      return [{ ...notification, sessionId: subtaskId }];
    }

    // ── Drop remaining v3 housekeeping updates ──────────────────────
    // focus_update is deliberately kept: it carries the session title /
    // status that bridge-connect surfaces to the UI.
    if (
      update.sessionUpdate === "session_info_update" &&
      typeof kiro.kind === "string" &&
      kiro.kind !== "focus_update"
    ) {
      return null;
    }

    return [notification];
  }

  // ── Hidden internal tool calls ──────────────────────────────────

  private hideToolCall(sessionId: string, toolCallId: string): void {
    let hidden = this.hiddenToolCalls.get(sessionId);
    if (!hidden) {
      hidden = new Set();
      this.hiddenToolCalls.set(sessionId, hidden);
    }
    hidden.add(toolCallId);
  }

  private isHiddenToolCall(sessionId: string, toolCallId: string): boolean {
    return this.hiddenToolCalls.get(sessionId)?.has(toolCallId) ?? false;
  }

  private forgetHiddenToolCall(sessionId: string, toolCallId: string): void {
    this.hiddenToolCalls.get(sessionId)?.delete(toolCallId);
  }

  // ── State lifecycle ─────────────────────────────────────────────

  override rekey(oldKey: string, newKey: string): void {
    const hidden = this.hiddenToolCalls.get(oldKey);
    if (hidden) {
      this.hiddenToolCalls.delete(oldKey);
      this.hiddenToolCalls.set(newKey, hidden);
    }
  }

  override cleanup(sessionKey: string): void {
    this.hiddenToolCalls.delete(sessionKey);
  }

  override clearAll(): void {
    this.hiddenToolCalls.clear();
  }
}

/** Read `{ name, prompt }` out of a sub-agent tool_call's rawInput. */
function readSubtaskInput(update: ToolCall | ToolCallUpdate): {
  name?: string;
  prompt?: string;
} {
  const rawInput = update.rawInput;
  if (typeof rawInput !== "object" || rawInput === null) return {};
  const record = rawInput as Record<string, unknown>;
  return {
    ...(typeof record.name === "string" && { name: record.name }),
    ...(typeof record.prompt === "string" && { prompt: record.prompt }),
  };
}
