import type { SessionNotification, PromptResponse } from "@agentclientprotocol/sdk";
import type { AddonSessionUpdate, SubagentStatus } from "../../shared/schema";
import type { ACPBridge } from "../agent/agent-bridge";
import { AcpAdapter } from "./acp-adapter";

// ── Types ────────────────────────────────────────────────────────────

interface TeamMember {
  sessionId: string;
  status: SubagentStatus;
  teamName: string;
}
interface TeamState {
  /** Global member index across all teams in this session */
  members: Map<string, TeamMember>;
  /** Most recently created non-deleted team. Used as fallback when
   * member_status_change doesn't carry teamName (current CodeBuddy
   * traffic omits it, though the docs include it). */
  activeTeamName: string | null;
}

/** CodeBuddy member.status → Fello SubagentStatus */
const CODEBUDDY_STATUS_MAP: Record<string, SubagentStatus> = {
  running: "in_progress",
  completed: "completed",
  idle: "in_progress",
  pending: "pending",
  failed: "failed",
};

// ── Adapter ──────────────────────────────────────────────────────────

/**
 * Adapts CodeBuddy-specific ACP protocol extensions into Fello's canonical
 * SessionNotification stream. Currently handles Agent Teams (memberEvent
 * chunk routing, teamUpdate lifecycle); designed to be extended for future
 * CodeBuddy protocol extensions without changing the class surface.
 */
export class CodebuddyAdapter extends AcpAdapter {
  private stateMap = new Map<string, TeamState>();

  /**
   * Per-session turn-boundary timestamp (epoch ms, from the agent's own
   * protocol clock). Frozen when a prompt completes (via handlePromptCompleted),
   * so content chunks emitted afterwards with an earlier protocol timestamp
   * are previous-turn replays. Only CodeBuddy stamps PromptResponse._meta
   * with a protocol timestamp, so this stays here rather than in the base.
   */
  private turnBoundaryTs = new Map<string, number>();

  /**
   * CodeBuddy spawn env.
   */
  override getAgentEnv(): Record<string, string> {
    return {
      CODEBUDDY_DEFER_TOOL_LOADING: "0",
      CODEBUDDY_DISABLE_AUTO_MEMORY: "1",
    };
  }

  /**
   * Freeze the turn-boundary on prompt completion. Only CodeBuddy stamps the
   * PromptResponse._meta with codebuddy.ai/requestId + a protocol timestamp,
   * so this stays here rather than in the generic bridge — the agent's own
   * clock is the boundary used to drop replayed prior-turn chunks (avoids
   * timezone / clock-skew issues that wall-clock Date.now() would introduce).
   *
   * Also recovers the failure reason: CodeBuddy reports a failed model
   * request as a normal response with stopReason="refusal" and the actual
   * cause in _meta["codebuddy.ai/errorMessage"] (a JSON string such as
   * {"code":-32000,"message":"Authentication required","data":{"details":
   * "Authentication required. Please use /login command..."}}). Returning it
   * lets Fello show the real reason instead of the generic "refusal" hint.
   */
  override handlePromptCompleted(
    _bridge: ACPBridge,
    sessionId: string,
    res: PromptResponse,
  ): string | undefined {
    const meta = res._meta as Record<string, unknown> | undefined;
    if (!meta) return undefined;

    if (typeof meta["codebuddy.ai/requestId"] === "string") {
      const ts = Date.parse(typeof meta["timestamp"] === "string" ? meta["timestamp"] : "");
      if (!isNaN(ts)) this.turnBoundaryTs.set(sessionId, ts);
    }

    return (
      CodebuddyAdapter.extractPromptErrorMessage(meta["codebuddy.ai/errorMessage"]) ?? undefined
    );
  }

  /**
   * Extract the user-visible text from codebuddy.ai/errorMessage. The payload
   * is a JSON string; `data.details` carries the actionable message (e.g.
   * "Please use /login"), `message` the short reason. Non-JSON payloads are
   * used verbatim.
   */
  private static extractPromptErrorMessage(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        const payload = parsed as Record<string, unknown>;
        const data = payload.data;
        if (data && typeof data === "object") {
          const details = (data as Record<string, unknown>).details;
          if (typeof details === "string" && details.trim()) return details.trim();
        }
        if (typeof payload.message === "string" && payload.message.trim()) {
          return payload.message.trim();
        }
      }
    } catch {
      // Not JSON — fall through and use the raw text.
    }
    return trimmed;
  }

  /**
   * One unified hook for all notification processing:
   *
   * 1. Replay detection — the adapter freezes a turn-boundary timestamp in
   *    handlePromptCompleted() when a prompt completes (using the agent's own
   *    protocol clock). Drop agent_message_chunk / agent_thought_chunk whose
   *    _meta.timestamp is earlier than that boundary: CodeBuddy re-broadcasts
   *    the previous turn's messages when a new prompt begins, and those
   *    re-emitted chunks carry the previous turn's (earlier) timestamps. Only
   *    applies to chunks that carry codebuddy.ai/requestId.
   * 2. memberEvent chunk routing — rewrite notification.sessionId from
   *    parent to member sessionId (CodeBuddy stamps all member chunks
   *    with the parent session).
   * 3. Drop teammate-directed user_message_chunks (task assignments from
   *    team-lead to members, wrapped in <teammate-message>).
   * 4. teamUpdate lifecycle — convert team_created / member_status_change /
   *    team_deleted into AddonSessionUpdate broadcasts via _meta.fello.update.
   *
   * Returns null to drop, [notification] to pass through, or
   * [notification, ...synthetic] to pass through + produce additional.
   * Results go through the REST of the pipeline (not this method again).
   */
  override preprocessNotification(
    _bridge: ACPBridge,
    sessionId: string,
    notification: SessionNotification,
  ): SessionNotification[] | null {
    const meta = notification.update?._meta as Record<string, unknown> | undefined;
    const sessionUpdate = notification.update?.sessionUpdate;

    // Replay detection: CodeBuddy content chunks (agent_message_chunk /
    // agent_thought_chunk) that carry codebuddy.ai/requestId and a protocol
    // _meta.timestamp (the agent's own UTC clock). If the chunk's timestamp is
    // earlier than the frozen turn-boundary for this session — set by the
    // adapter via handlePromptCompleted() when the previous prompt completed — it's
    // a replayed prior-turn chunk, drop it. Dropping against the agent's
    // protocol clock (not wall-clock) avoids timezone / clock-skew issues.
    const requestId = meta?.["codebuddy.ai/requestId"];
    const metaTimestamp = meta?.["timestamp"];
    if (
      typeof requestId === "string" &&
      typeof metaTimestamp === "string" &&
      (sessionUpdate === "agent_message_chunk" || sessionUpdate === "agent_thought_chunk")
    ) {
      const ts = Date.parse(metaTimestamp);
      if (!isNaN(ts)) {
        const boundary = this.turnBoundaryTs.get(sessionId);
        if (boundary !== undefined && ts < boundary) {
          return null;
        }
      }
    }

    const memberEvent = meta?.["codebuddy.ai/memberEvent"];

    // Drop teammate-directed user_message_chunks — these are task
    // assignments / follow-ups from team-lead to members (wrapped in
    // <teammate-message>), not real user input. They must never appear
    // in the main user bubble. The task content is already surfaced via
    // the member's `prompt` field (from member_status_change.description).
    if (sessionUpdate === "user_message_chunk" && typeof memberEvent === "string") {
      return null;
    }

    // Rewrite chunk routing for member events
    let result = notification;
    if (typeof memberEvent === "string") {
      const state = this.stateMap.get(sessionId);
      const memberSessionId = state?.members.get(memberEvent)?.sessionId;
      if (memberSessionId && notification.sessionId !== memberSessionId) {
        result = { ...notification, sessionId: memberSessionId };
      }
    }

    // Handle teamUpdate — update state + produce synthetic subagent_updates
    const teamUpdate = meta?.["codebuddy.ai/teamUpdate"];
    if (teamUpdate && typeof teamUpdate === "object") {
      const synthetic = this.processTeamUpdate(teamUpdate as Record<string, unknown>, sessionId);
      return synthetic.length > 0 ? [result, ...synthetic] : [result];
    }

    return [result];
  }

  // ── Team update processing ─────────────────────────────────────────

  /**
   * Process a codebuddy.ai/teamUpdate event. Updates the cached team
   * state and produces synthetic subagent_update notifications.
   *
   * - team_created → cache teamName as activeTeamName (no notifications)
   * - member_status_change → resolve each member's teamName via event-level
   *   teamName / existing member's teamName / activeTeamName, then produce
   *   a subagent_update notification per member
   * - team_deleted → mark still-active members of THAT team as `failed`
   *   (preserving completed/failed), then produce a notification per active
   *   member. Only removes that team's members from the cache.
   * - team_idle / others → no-op
   */
  private processTeamUpdate(
    teamUpdate: Record<string, unknown>,
    sessionId: string,
  ): SessionNotification[] {
    const type = typeof teamUpdate.type === "string" ? teamUpdate.type : "";
    const eventTeamName = typeof teamUpdate.teamName === "string" ? teamUpdate.teamName : null;

    const getOrCreateState = (): TeamState => {
      let s = this.stateMap.get(sessionId);
      if (!s) {
        s = { members: new Map(), activeTeamName: null };
        this.stateMap.set(sessionId, s);
      }
      return s;
    };

    const makeSubagentUpdate = (
      memberSessionId: string,
      memberName: string | undefined,
      prompt: string | undefined,
      status: SubagentStatus,
    ): SessionNotification => {
      const update: AddonSessionUpdate = {
        sessionUpdate: "subagent_update",
        sessionId: memberSessionId,
        ...(memberName !== undefined && { name: memberName }),
        ...(prompt !== undefined && { prompt }),
        status,
      };
      return {
        sessionId,
        update: {
          sessionUpdate: "session_info_update",
          _meta: { fello: { update } },
        },
      };
    };

    if (type === "team_created") {
      const state = getOrCreateState();
      if (eventTeamName) state.activeTeamName = eventTeamName;
      return [];
    }

    if (type === "team_deleted") {
      const state = this.stateMap.get(sessionId);
      if (!state || !eventTeamName) return [];
      const results: SessionNotification[] = [];
      for (const [memberName, member] of state.members) {
        if (member.teamName !== eventTeamName) continue;
        if (member.status !== "completed" && member.status !== "failed") {
          results.push(makeSubagentUpdate(member.sessionId, undefined, undefined, "failed"));
        }
        state.members.delete(memberName);
      }
      if (state.activeTeamName === eventTeamName) {
        state.activeTeamName = null;
      }
      return results;
    }

    if (type === "member_status_change") {
      const state = getOrCreateState();
      const members = Array.isArray(teamUpdate.members) ? teamUpdate.members : [];
      const results: SessionNotification[] = [];
      for (const member of members) {
        if (!member || typeof member !== "object") continue;
        const m = member as Record<string, unknown>;
        const memberName = typeof m.name === "string" ? m.name : null;
        const memberSessionId = typeof m.sessionId === "string" ? m.sessionId : null;
        if (!memberName || !memberSessionId) continue;

        const status =
          typeof m.status === "string"
            ? (CODEBUDDY_STATUS_MAP[m.status] ?? "in_progress")
            : "in_progress";

        // Resolve teamName: event-level → existing member → activeTeamName → ""
        const existing = state.members.get(memberName);
        const resolvedTeamName = eventTeamName ?? existing?.teamName ?? state.activeTeamName ?? "";
        state.members.set(memberName, {
          sessionId: memberSessionId,
          status,
          teamName: resolvedTeamName,
        });

        const prompt = typeof m.description === "string" ? m.description : undefined;
        results.push(makeSubagentUpdate(memberSessionId, memberName, prompt, status));
      }
      return results;
    }

    // team_idle and any other events: no-op
    return [];
  }

  // ── State lifecycle (mirror bridge-connect) ────────────────────────

  override rekey(oldKey: string, newKey: string): void {
    const state = this.stateMap.get(oldKey);
    if (state) {
      this.stateMap.delete(oldKey);
      this.stateMap.set(newKey, state);
    }
    const boundary = this.turnBoundaryTs.get(oldKey);
    if (boundary !== undefined) {
      this.turnBoundaryTs.delete(oldKey);
      this.turnBoundaryTs.set(newKey, boundary);
    }
  }

  override cleanup(sessionKey: string): void {
    this.stateMap.delete(sessionKey);
    this.turnBoundaryTs.delete(sessionKey);
  }

  override clearAll(): void {
    this.stateMap.clear();
    this.turnBoundaryTs.clear();
  }
}
