import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { ACPBridge } from "./agent/agent-bridge";
import { storageOps } from "./storage";
import type { FelloIPCSchema } from "../shared/schema";
import { askUser } from "./ask-user";
import { t } from "./i18n";

// ── Agent Resolution ─────────────────────────────────────────────────

import { resolveAgentInfo } from "./agent/resolve-agent-info";

// ── State ────────────────────────────────────────────────────────────

type AgentType = string;
export const bridgePool = new Map<AgentType, Promise<ACPBridge>>();

// These are injected at init time by backend.ts
let sendEvent: <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => boolean = () => false;

let broadcastAndSaveSessionUpdate: (
  sessionId: string,
  notification: SessionNotification,
) => void = () => {};

export function initPool(deps: {
  sendEvent: typeof sendEvent;
  broadcastAndSaveSessionUpdate: typeof broadcastAndSaveSessionUpdate;
}) {
  sendEvent = deps.sendEvent;
  broadcastAndSaveSessionUpdate = deps.broadcastAndSaveSessionUpdate;
}

// ── Pool Management ──────────────────────────────────────────────────

export async function ensureBridge(agentId: AgentType): Promise<ACPBridge> {
  const connectPromise = bridgePool.get(agentId);
  if (connectPromise) {
    const pooledBridge = await connectPromise;
    if (pooledBridge.isConnected) {
      return pooledBridge;
    }
    if (bridgePool.get(agentId) === connectPromise) {
      bridgePool.delete(agentId);
    }
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
          storageOps.updateSession(sessionId, { title: notification.update.title });
          const updated = storageOps.getSession(sessionId);
          if (updated) sendEvent("session-changed", { session: updated });
        }
      }

      if (sessionUpdate === "current_mode_update") {
        const session = storageOps.getSession(sessionId);
        if (session && session.modes) {
          session.modes.currentModeId = notification.update.currentModeId ?? null;
          storageOps.updateSession(sessionId, { modes: session.modes });
          const updated = storageOps.getSession(sessionId);
          if (updated) sendEvent("session-changed", { session: updated });
        }
      }

      broadcastAndSaveSessionUpdate(sessionId, notification);
    },
    onPermissionRequest: async (request: RequestPermissionRequest) => {
      const sessionId = `${agentId}:${request.sessionId}`;
      const session = storageOps.getSession(sessionId);

      if (session?.permissionMode === "allow-all") {
        const allowOption =
          request.options.find((o) => o.kind === "allow_always") ??
          request.options.find((o) => o.kind === "allow_once") ??
          request.options[0];
        return {
          outcome: {
            outcome: "selected",
            optionId: allowOption?.optionId ?? "deny",
          },
        } satisfies RequestPermissionResponse;
      }

      const userResponse = await askUser({
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
        outcome: {
          outcome: "selected",
          optionId: userResponse.value,
        },
      } satisfies RequestPermissionResponse;
    },
    onAgentTerminalOutput: (resumeId: string, terminalId: string, data: string) => {
      const sessionId = `${agentId}:${resumeId}`;
      try {
        storageOps.appendTerminalOutput(sessionId, terminalId, data);
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
      if (bridgePool.get(agentId) === newConnectPromise) {
        bridgePool.delete(agentId);
      }
      await nextBridge.kill();
      throw error;
    });

  bridgePool.set(agentId, newConnectPromise);
  return newConnectPromise;
}

// ── Session Socket Server ────────────────────────────────────────────

export async function clearPool() {
  const killPromises: Promise<void>[] = [];
  for (const p of bridgePool.values()) {
    killPromises.push(p.then((b) => b.kill()).catch(() => {}));
  }
  bridgePool.clear();
  await Promise.all(killPromises);
}
