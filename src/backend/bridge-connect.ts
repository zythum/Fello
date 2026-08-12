import type {
  AvailableCommand,
  UsageUpdate,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { ACPBridge } from "./agent/agent-bridge";
import { adapters, extNotificationSpecs } from "./acp-adapters/adapters";
import { resolveAgentInfo } from "./agent/resolve-agent-info";
import type { BackendContext } from "./types";
import type { AskUserModule } from "./ask-user";
import { t } from "./i18n";

// ── Types ────────────────────────────────────────────────────────────

export interface BroadcastFn {
  (sessionId: string, notification: SessionNotification): void;
}

export interface BridgeConnectModule {
  /** sessionId → bridge promise */
  bridges: Map<string, Promise<ACPBridge>>;
  ensureBridge: (sessionKey: string, agentId: string, cwd: string) => Promise<ACPBridge>;
  rekeyBridge: (oldKey: string, newKey: string) => void;
  killBridge: (sessionKey: string) => Promise<void>;
  killBridgesByAgent: (agentId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  setBroadcast: (fn: BroadcastFn) => void;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createBridgeConnectModule(
  ctx: BackendContext,
  deps: { askUser: AskUserModule },
): BridgeConnectModule {
  const { sendEvent, storage } = ctx;
  const bridges = new Map<string, Promise<ACPBridge>>();

  /** Track which agentId each sessionKey belongs to */
  const sessionAgentMap = new Map<string, string>();

  let broadcastAndSaveSessionUpdate: BroadcastFn = () => {};

  function setBroadcast(fn: BroadcastFn) {
    broadcastAndSaveSessionUpdate = fn;
  }

  function publishAvailableCommands(sessionId: string, availableCommands: AvailableCommand[]) {
    storage.updateSession(sessionId, { availableCommands }, false);
    const updated = storage.getSession(sessionId);
    if (updated) sendEvent("session-changed", { session: updated });
  }

  function publishUsage(sessionId: string, usage: UsageUpdate) {
    storage.updateSession(
      sessionId,
      {
        usage: {
          size: usage.size ?? 0,
          used: usage.used ?? 0,
          cost: usage.cost ?? null,
        },
      },
      false,
    );
    const updated = storage.getSession(sessionId);
    if (updated) sendEvent("session-changed", { session: updated });
  }

  // ── Bridge lifecycle ──────────────────────────────────────────────

  async function ensureBridge(
    sessionKey: string,
    agentId: string,
    cwd: string,
  ): Promise<ACPBridge> {
    const connectPromise = bridges.get(sessionKey);
    if (connectPromise) {
      const existingBridge = await connectPromise;
      if (existingBridge.isConnected) return existingBridge;
      if (bridges.get(sessionKey) === connectPromise) bridges.delete(sessionKey);
      await existingBridge.kill();
    }

    sessionAgentMap.set(sessionKey, agentId);

    let currentSessionId: string | null = null;

    /**
     * Unified session-notification pipeline. Called by onSessionUpdate for
     * native ACP notifications AND by onExtNotification for synthetic
     * notifications produced by adapters.
     *
     * Adapter preprocessing runs ONCE per incoming notification — results
     * (the original possibly transformed + any synthetic) go through the
     * REST of the pipeline (session-specific handling, broadcast, storage),
     * NOT through preprocessing again. This avoids recursion while keeping
     * the original stored for replay/state-rebuild.
     */
    function processSessionUpdate(notification: SessionNotification) {
      // Step 1: adapter preprocessing (pipeline-style across adapters)
      let results: SessionNotification[] = [notification];
      if (currentSessionId) {
        for (const adapter of adapters) {
          const next: SessionNotification[] = [];
          for (const n of results) {
            const processed = adapter.preprocessNotification(n, currentSessionId, agentId);
            if (processed !== null) {
              next.push(...processed);
            }
          }
          results = next;
        }
      }

      if (results.length === 0) return; // all dropped
      if (!currentSessionId) return;

      // Step 2: rest of the pipeline for each result
      for (const result of results) {
        const sessionUpdate = result.update?.sessionUpdate;

        if (currentSessionId && currentSessionId === `${agentId}:${result.sessionId}`) {
          if (sessionUpdate === "session_info_update") {
            if (result.update.title) {
              storage.updateSession(currentSessionId, { title: result.update.title });
              const updated = storage.getSession(currentSessionId);
              if (updated) sendEvent("session-changed", { session: updated });
            }
          }

          if (sessionUpdate === "usage_update") {
            publishUsage(currentSessionId, result.update);
            continue;
          }

          if (sessionUpdate === "available_commands_update") {
            publishAvailableCommands(currentSessionId, result.update.availableCommands ?? []);
            continue;
          }

          if (sessionUpdate === "current_mode_update") {
            const session = storage.getSession(currentSessionId);
            if (session && session.modes) {
              session.modes.currentModeId = result.update.currentModeId ?? null;
              storage.updateSession(currentSessionId, { modes: session.modes });
              const updated = storage.getSession(currentSessionId);
              if (updated) sendEvent("session-changed", { session: updated });
            }
          }
        }
        broadcastAndSaveSessionUpdate(currentSessionId, result);
      }
    }

    const agentInfo = resolveAgentInfo(agentId);
    const bridge = new ACPBridge(agentId, {
      agentInfo,
      cwd,
      extNotificationSpecs,
      onSessionConnect: (connection) => {
        currentSessionId = `${agentId}:${connection.sessionId}`;

        // Mark session as connected
        storage.updateSession(currentSessionId, { connectionStatus: "connected" }, false);
        const updated = storage.getSession(currentSessionId);
        if (updated) sendEvent("session-changed", { session: updated });
      },
      onSessionUpdate: (notification) => {
        processSessionUpdate(notification);
      },

      onExtNotification: (method, params) => {
        // Adapters translate ext notifications into synthetic
        // SessionNotifications, which are fed back through
        // processSessionUpdate for unified handling.
        for (const adapter of adapters) {
          const results = adapter.handleExtNotification(method, params, currentSessionId, agentId);
          if (results.length > 0) {
            for (const result of results) {
              processSessionUpdate(result);
            }
            return;
          }
        }
      },
      onPermissionRequest: async (request) => {
        if (!currentSessionId) {
          return {
            outcome: { outcome: "selected", optionId: "deny" },
          } satisfies RequestPermissionResponse;
        }

        const session = storage.getSession(currentSessionId);

        if (session?.permissionMode === "allow-all") {
          const allowOption =
            request.options.find((o) => o.kind === "allow_always") ??
            request.options.find((o) => o.kind === "allow_once") ??
            request.options[0];
          return {
            outcome: { outcome: "selected", optionId: allowOption?.optionId ?? "deny" },
          } satisfies RequestPermissionResponse;
        }

        const userResponse = await deps.askUser.askUser({
          sessionId: currentSessionId,
          title: request.toolCall.title ?? t("ilink.permissionRequest"),
          description: request.toolCall.rawInput ? JSON.stringify(request.toolCall.rawInput) : "",
          allowCustomInput: false,
          options: request.options.map((o) => ({
            value: o.optionId,
            label: (() => {
              const name = o.name;
              switch (o.kind) {
                case "allow_once":
                  return t("ilink.permissionAllowOnce", { name });
                case "allow_always":
                  return t("ilink.permissionAllowAlways", { name });
                case "reject_once":
                  return t("ilink.permissionRejectOnce", { name });
                case "reject_always":
                  return t("ilink.permissionRejectAlways", { name });
                default:
                  return name;
              }
            })(),
            priority: o.kind === "allow_always" ? "high" : "medium",
            danger: o.kind === "reject_once" || o.kind === "reject_always",
          })),
        });

        if (userResponse.value === null) {
          return { outcome: { outcome: "selected", optionId: "deny" } };
        }
        return {
          outcome: { outcome: "selected", optionId: userResponse.value },
        } satisfies RequestPermissionResponse;
      },
      onAgentTerminalOutput: (resumeId, terminalId, data) => {
        const sessionId = `${agentId}:${resumeId}`;
        try {
          storage.appendTerminalOutput(sessionId, terminalId, data);
        } catch (err) {
          console.error("write terminal output error: ", { sessionId, terminalId, err });
        }
        sendEvent("agent-terminal-output", { sessionId, terminalId, data });
      },
    });

    let newConnectPromise!: Promise<ACPBridge>;
    newConnectPromise = bridge
      .connect()
      .then(() => bridge)
      .catch(async (error) => {
        if (bridges.get(sessionKey) === newConnectPromise) bridges.delete(sessionKey);
        await bridge.kill();
        throw error;
      });

    bridges.set(sessionKey, newConnectPromise);

    // Mark session as connecting
    storage.updateSession(sessionKey, { connectionStatus: "connecting" }, false);
    const connectingSession = storage.getSession(sessionKey);
    if (connectingSession) sendEvent("session-changed", { session: connectingSession });

    return newConnectPromise;
  }

  function rekeyBridge(oldKey: string, newKey: string): void {
    const p = bridges.get(oldKey);
    if (p) {
      bridges.delete(oldKey);
      bridges.set(newKey, p);
    }
    const agentId = sessionAgentMap.get(oldKey);
    if (agentId !== undefined) {
      sessionAgentMap.delete(oldKey);
      sessionAgentMap.set(newKey, agentId);
    }
    for (const a of adapters) a.rekey(oldKey, newKey);
  }

  async function killBridge(sessionKey: string): Promise<void> {
    const p = bridges.get(sessionKey);
    if (p) {
      bridges.delete(sessionKey);
      sessionAgentMap.delete(sessionKey);
      for (const a of adapters) a.cleanup(sessionKey);
      try {
        const b = await p;
        await b.kill();
      } catch {}
    }
    // Mark session as disconnected
    storage.updateSession(
      sessionKey,
      { connectionStatus: "disconnected", availableCommands: [] },
      false,
    );
    const session = storage.getSession(sessionKey);
    if (session) sendEvent("session-changed", { session });
  }

  async function killBridgesByAgent(agentId: string): Promise<void> {
    const keysToKill: string[] = [];
    for (const [key, aid] of sessionAgentMap) {
      if (aid === agentId) keysToKill.push(key);
    }
    await Promise.all(keysToKill.map((key) => killBridge(key)));
  }

  async function clearAll() {
    const killPromises: Promise<void>[] = [];
    for (const p of bridges.values()) {
      killPromises.push(p.then((b) => b.kill()).catch(() => {}));
    }
    bridges.clear();
    sessionAgentMap.clear();
    for (const a of adapters) a.clearAll();
    await Promise.all(killPromises);
  }

  return {
    bridges,
    ensureBridge,
    rekeyBridge,
    killBridge,
    killBridgesByAgent,
    clearAll,
    setBroadcast,
  };
}
