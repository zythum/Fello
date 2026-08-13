import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { ExtNotificationSpec } from "../agent/agent-bridge";

/**
 * Base class for ACP protocol adapters. Each adapter bridges a specific
 * agent's protocol extensions (CodeBuddy, Kiro, etc.) into Fello's
 * canonical SessionNotification stream.
 *
 * Adapters are pure translators — they take protocol events and produce
 * SessionNotification(s). All side effects (storage, enrichment,
 * broadcasting) are handled centrally by bridge-connect's
 * processSessionUpdate pipeline.
 *
 * Hooks (override only what you need; defaults are pass-through / no-op):
 * - preprocessNotification: the ONE hook for notification processing.
 *   Can transform the notification (1:1), drop it (return null), and/or
 *   produce additional synthetic notifications (1:N). Called once per
 *   incoming notification — results go through the REST of the pipeline
 *   (not through preprocessNotification again), so no recursion risk.
 *   This covers both _meta field handling (e.g. codebuddy.ai/teamUpdate)
 *   and chunk routing (e.g. memberEvent sessionId rewrite).
 * - handleExtNotification: translate a method/params ext notification
 *   into zero or more synthetic notifications.
 *
 * extNotificationSpecs: declares ext notification method names + parse
 * functions for ACPBridge to register on the ACP client.
 *
 * Lifecycle (override if the adapter holds per-session state):
 * - rekey / cleanup / clearAll
 */
export abstract class AcpAdapter {
  /** Ext notification specs to register on the ACP client. */
  extNotificationSpecs: ExtNotificationSpec[] = [];

  /**
   * Process an incoming notification.
   * - Return null to drop.
   * - Return [notification] to pass through (possibly transformed).
   * - Return [notification, ...synthetic] to pass through AND produce
   *   additional notifications.
   *
   * Results go through the REST of the pipeline (title check, broadcast,
   * storage) — NOT through preprocessNotification again, so adapters
   * can safely inspect _meta fields without recursion risk. The original
   * notification (if included in results) is stored, which preserves
   * _meta for replay/state-rebuild.
   */
  preprocessNotification(
    notification: SessionNotification,
    _currentSessionId: string,
    _agentId: string,
  ): SessionNotification[] | null {
    return [notification];
  }

  handleExtNotification(
    _method: string,
    _params: unknown,
    _currentSessionId: string | null,
    _agentId: string,
  ): SessionNotification[] {
    return [];
  }

  /**
   * Agent process env vars to inject when spawning the agent. Protocol-
   * specific environment needed by the agent process (e.g.
   * CODEBUDDY_DEFER_TOOL_LOADING for CodeBuddy). Aggregated by
   * adapters.ts and applied by ACPBridge when spawning a stdio agent;
   * agent-specific agentInfo.env still takes precedence.
   */
  getAgentEnv(): Record<string, string> {
    return {};
  }

  // ── State lifecycle (default no-ops) ───────────────────────────────

  rekey(_oldKey: string, _newKey: string): void {}
  cleanup(_sessionKey: string): void {}
  clearAll(): void {}
}
