/**
 * Headless one-shot inference primitive.
 *
 * Provides a simple `runInference(req)` function that:
 * 1. Creates a temporary agent session (invisible to UI)
 * 2. Sends a prompt
 * 3. Collects the full response
 * 4. Tears down the session
 * 5. Returns the result
 *
 * No UI events, no persistence, no iLink forwarding.
 * Used by: automation, memory/summarizer, ilink smart-reply, etc.
 */

import { randomUUID } from "crypto";
import type { ContentBlock, McpServer, SessionNotification } from "@agentclientprotocol/sdk";
import { ACPBridge } from "./agent/agent-bridge";
import { resolveAgentInfo } from "./agent/resolve-agent-info";
import { startSocketServer, generateSocketPath, type SocketServer } from "./socket-server";
import type { SkillsModule } from "./skills";
import type { SearchModule } from "./search";
import type { BackendContext } from "./types";
import type { Feature } from "../shared/schema";

// ── Types ────────────────────────────────────────────────────────────

export interface InferenceRequest {
  agentId: string;
  prompt: string | ContentBlock[];
  /** External user-defined MCP servers (NOT built-in features) */
  mcpServers?: McpServer[];
  /** Built-in features to enable (skills, search, etc.). Default: [] */
  features?: Feature[];
  model?: string;
  /** Working directory for the agent session */
  cwd?: string;
  /** Timeout in ms (default: 5 min) */
  timeout?: number;
}

export interface InferenceResult {
  text: string;
  notifications: SessionNotification[];
  terminalLogs: Record<string, string>;
  stopReason?: string;
}

export interface InferenceModule {
  runInference: (req: InferenceRequest) => Promise<InferenceResult>;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createInferenceModule(
  _ctx: BackendContext,
  deps: { skills: SkillsModule; search: SearchModule },
): InferenceModule {
  async function runInference(req: InferenceRequest): Promise<InferenceResult> {
    const {
      agentId,
      prompt,
      model,
      cwd = process.cwd(),
      features = [],
      timeout = 30 * 60 * 1000,
    } = req;

    const notifications: SessionNotification[] = [];
    const textChunks: string[] = [];
    const terminalLogs: Record<string, string> = {};

    const agentInfo = resolveAgentInfo(agentId);
    const bridge = new ACPBridge(agentId, {
      agentInfo,
      cwd,
      onSessionConnect: () => {},
      onSessionUpdate: (notification: SessionNotification) => {
        notifications.push(notification);
        if (notification.update?.sessionUpdate === "agent_message_chunk") {
          const content = notification.update.content;
          if (content?.type === "text" && content.text) {
            textChunks.push(content.text);
          }
        }
      },
      onExtNotification: () => {},
      onPermissionRequest: async (request) => {
        const opt =
          request.options.find((o) => o.kind === "allow_always") ??
          request.options.find((o) => o.kind === "allow_once") ??
          request.options[0];
        return { outcome: { outcome: "selected", optionId: opt?.optionId ?? "allow" } };
      },
      onAgentTerminalOutput: (_sessionId, terminalId, data) => {
        terminalLogs[terminalId] = (terminalLogs[terminalId] ?? "") + data;
      },
    });

    const servers: SocketServer[] = [];

    try {
      await bridge.connect();

      const mcpServers: McpServer[] = [...(req.mcpServers ?? [])];

      // Set up built-in feature MCP servers based on features[]
      if (features.length > 0) {
        const socketPath = generateSocketPath(`inf-${randomUUID()}`);
        const socketServer = await startSocketServer(socketPath);
        servers.push(socketServer);

        if (features.includes("skills")) {
          deps.skills.registerSkillsRoute(socketServer, cwd);
          mcpServers.push(deps.skills.buildSkillsMcpServer({ projectDir: cwd, socketPath }));
        }
        if (features.includes("search")) {
          deps.search.registerSearchRoute(socketServer, cwd);
          mcpServers.push(deps.search.buildSearchMcpServer({ projectDir: cwd, socketPath }));
        }
        // ask_user and share_to_user are intentionally excluded in headless mode
      }

      const { sessionId } = await bridge.newSession({ cwd, mcpServers });

      if (model) {
        try {
          await bridge.setSessionModel({ sessionId, modelId: model });
        } catch (err) {
          console.warn(`[Inference] Failed to set model "${model}":`, err);
        }
      }

      const contents: ContentBlock[] =
        typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt;

      const timer = setTimeout(() => {
        bridge.cancel({ sessionId }).catch(() => {});
      }, timeout);

      let stopReason: string | undefined;
      try {
        const response = await bridge.sendPrompt({ sessionId, prompt: contents });
        stopReason = response?.stopReason;
      } finally {
        clearTimeout(timer);
      }

      await bridge.closeSession(sessionId);
      await bridge.deleteSession(sessionId);

      return { text: textChunks.join(""), notifications, terminalLogs, stopReason };
    } finally {
      await bridge.kill().catch(() => {});
      for (const s of servers) s.stop();
    }
  }

  return { runInference };
}
