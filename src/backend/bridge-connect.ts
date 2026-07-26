import type {
  AvailableCommand,
  UsageUpdate,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AddonSessionUpdate, SubagentStatus } from "../shared/schema";
import { ACPBridge } from "./agent/agent-bridge";
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

    const agentInfo = resolveAgentInfo(agentId);
    const bridge = new ACPBridge(agentId, {
      agentInfo,
      cwd,
      onSessionConnect: (connection) => {
        currentSessionId = `${agentId}:${connection.sessionId}`;

        // Mark session as connected
        storage.updateSession(currentSessionId, { connectionStatus: "connected" }, false);
        const updated = storage.getSession(currentSessionId);
        if (updated) sendEvent("session-changed", { session: updated });
      },
      onSessionUpdate: (notification) => {
        const sessionUpdate = notification.update?.sessionUpdate;
        if (currentSessionId) {
          if (currentSessionId === `${agentId}:${notification.sessionId}`) {
            if (sessionUpdate === "session_info_update") {
              if (notification.update.title) {
                storage.updateSession(currentSessionId, { title: notification.update.title });
                const updated = storage.getSession(currentSessionId);
                if (updated) sendEvent("session-changed", { session: updated });
              }
            }

            if (sessionUpdate === "usage_update") {
              publishUsage(currentSessionId, notification.update);
              return;
            }

            if (sessionUpdate === "available_commands_update") {
              publishAvailableCommands(
                currentSessionId,
                notification.update.availableCommands ?? [],
              );
              return;
            }

            if (sessionUpdate === "current_mode_update") {
              const session = storage.getSession(currentSessionId);
              if (session && session.modes) {
                session.modes.currentModeId = notification.update.currentModeId ?? null;
                storage.updateSession(currentSessionId, { modes: session.modes });
                const updated = storage.getSession(currentSessionId);
                if (updated) sendEvent("session-changed", { session: updated });
              }
            }
          }
          broadcastAndSaveSessionUpdate(currentSessionId, notification);
        }
      },

      onExtNotification: (method, params) => {
        if (method === "_kiro.dev/metadata") {
          if (
            typeof params === "object" &&
            params &&
            "sessionId" in params &&
            typeof params.sessionId === "string" &&
            "contextUsagePercentage" in params &&
            typeof params.contextUsagePercentage === "number" &&
            currentSessionId === `${agentId}:${params.sessionId}`
          ) {
            publishUsage(currentSessionId, {
              used: params.contextUsagePercentage / 100,
              size: 1,
            });
          }
          return;
        }

        if (method === "_kiro.dev/commands/available") {
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
            publishAvailableCommands(currentSessionId, commands);
          }
          return;
        }

        if (method === "_kiro.dev/subagent/list_update") {
          // kiro 没有给主 session 的 sessionId，只能这样兼容
          if (
            typeof params === "object" &&
            params &&
            currentSessionId &&
            "subagents" in params &&
            Array.isArray(params.subagents)
          ) {
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
                  status: (
                    {
                      pending: "pending",
                      working: "in_progress",
                      terminated: "completed",
                      failed: "failed",
                    } satisfies Record<string, SubagentStatus>
                  )[String(subagent?.status?.type)],
                };
                broadcastAndSaveSessionUpdate(currentSessionId, {
                  sessionId: currentSessionId.replace(`${agentId}:`, ""),
                  update: {
                    sessionUpdate: "session_info_update",
                    _meta: {
                      fello: {
                        update,
                      },
                    },
                  },
                });
              }
            }
          }
          return;
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
  }

  async function killBridge(sessionKey: string): Promise<void> {
    const p = bridges.get(sessionKey);
    if (p) {
      bridges.delete(sessionKey);
      sessionAgentMap.delete(sessionKey);
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
