import type { AcpAdapter } from "./acp-adapter";
import { CodebuddyAdapter } from "./codebuddy-adapter";
import { KiroAdapter } from "./kiro-adapter";

const codebuddyAdapter = new CodebuddyAdapter();
const kiroAdapter = new KiroAdapter();

/**
 * Registry of all protocol adapters. Hooks are dispatched uniformly by
 * bridge-connect — adding a new adapter only requires appending to this
 * array, with no changes to the bridge callbacks.
 *
 * Instances are safe to share across sessions: CodebuddyAdapter keys its
 * per-session state by currentSessionId, and KiroAdapter is stateless.
 */
export const adapters: AcpAdapter[] = [codebuddyAdapter, kiroAdapter];

/** Aggregated ext notification specs from all adapters. ACPBridge iterates
 * these to register .onNotification handlers on the ACP client. */
export const extNotificationSpecs = adapters.flatMap((a) => a.extNotificationSpecs);

/** Aggregated agent env vars from all adapters. ACPBridge merges these into
 * the stdio agent spawn env (agent-specific agentInfo.env still wins). */
export const agentEnv: Record<string, string> = Object.assign(
  {},
  ...adapters.map((a) => a.getAgentEnv()),
);
