import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { ACPBridge } from "./agent/agent-bridge";
import { resolveAgentInfo } from "./agent/resolve-agent-info";
import type { BackendContext } from "./types";
import type { AskUserModule } from "./ask-user";
import { t } from "./i18n";

// ── Types ────────────────────────────────────────────────────────────

type AgentType = string;

export interface BroadcastFn {
  (sessionId: string, notification: SessionNotification): void;
}

export interface BridgePoolModule {
  pool: Map<AgentType, Promise<ACPBridge>>;
  ensureBridge: (agentId: AgentType) => Promise<ACPBridge>;
  clearPool: () => Promise<void>;
  setBroadcast: (fn: BroadcastFn) => void;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createBridgePoolModule(
  ctx: BackendContext,
  deps: { askUser: AskUserModule },
): BridgePoolModule {
  const { sendEvent, storage } = ctx;
  const pool = new Map<AgentType, Promise<ACPBridge>>();

  let broadcastAndSaveSessionUpdate: BroadcastFn = () => {};

  function setBroadcast(fn: BroadcastFn) {
    broadcastAndSaveSessionUpdate = fn;
  }

  async function ensureBridge(agentId: AgentType): Promise<ACPBridge> {
    const connectPromise = pool.get(agentId);
    if (connectPromise) {
      const pooledBridge = await connectPromise;
      if (pooledBridge.isConnected) return pooledBridge;
      if (pool.get(agentId) === connectPromise) pool.delete(agentId);
      await pooledBridge.kill();
    }

    const agentInfo = resolveAgentInfo(agentId);
    const nextBridge = new ACPBridge(agentId, {
      agentInfo,
      onSessionUpdate: (notification: SessionNotification) => {
        const sessionId = `${agentId}:${notification.sessionId}`;
        const sessionUpdate = notification.update?.sessionUpdate;

        if (sessionUpdate === "session_info_update") {
          if (notification.update.title) {
            storage.updateSession(sessionId, { title: notification.update.title });
            const updated = storage.getSession(sessionId);
            if (updated) sendEvent("session-changed", { session: updated });
          }
        }

        if (sessionUpdate === "current_mode_update") {
          const session = storage.getSession(sessionId);
          if (session && session.modes) {
            session.modes.currentModeId = notification.update.currentModeId ?? null;
            storage.updateSession(sessionId, { modes: session.modes });
            const updated = storage.getSession(sessionId);
            if (updated) sendEvent("session-changed", { session: updated });
          }
        }

        broadcastAndSaveSessionUpdate(sessionId, notification);
      },
      onPermissionRequest: async (request: RequestPermissionRequest) => {
        const sessionId = `${agentId}:${request.sessionId}`;
        const session = storage.getSession(sessionId);

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
          sessionId,
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
      onAgentTerminalOutput: (resumeId: string, terminalId: string, data: string) => {
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
    newConnectPromise = nextBridge
      .connect()
      .then(() => nextBridge)
      .catch(async (error) => {
        if (pool.get(agentId) === newConnectPromise) pool.delete(agentId);
        await nextBridge.kill();
        throw error;
      });

    pool.set(agentId, newConnectPromise);
    return newConnectPromise;
  }

  async function clearPool() {
    const killPromises: Promise<void>[] = [];
    for (const p of pool.values()) {
      killPromises.push(p.then((b) => b.kill()).catch(() => {}));
    }
    pool.clear();
    await Promise.all(killPromises);
  }

  return { pool, ensureBridge, clearPool, setBroadcast };
}
