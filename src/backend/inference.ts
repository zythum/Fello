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
import { adapters, extNotificationSpecs } from "./acp-adapters/adapters";
import { resolveAgentInfo } from "./agent/resolve-agent-info";
import { startSocketServer, generateSocketPath, type SocketServer } from "./socket-server";
import type { SkillsModule } from "./skills";
import type { SearchModule } from "./search";
import type { ToolboxModule } from "./toolbox";
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
  deps: { skills: SkillsModule; search: SearchModule; toolbox: ToolboxModule },
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
    let currentSessionId: string | null = null;

    /** Simplified version of bridge-connect's processSessionUpdate:
     *  runs adapter preprocessing + _meta handling, then collects
     *  notifications (no storage/broadcast). Synthetic notifications
     *  from adapters are fed back through the same function. */
    function processNotification(notification: SessionNotification) {
      // Step 1: adapter preprocessing (pipeline-style)
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

      if (results.length === 0) return;

      // Step 2: collect each result
      for (const result of results) {
        notifications.push(result);
        if (result.update?.sessionUpdate === "agent_message_chunk") {
          const content = result.update.content;
          if (content?.type === "text" && content.text) {
            textChunks.push(content.text);
          }
        }
      }
    }

    const bridge = new ACPBridge(agentId, {
      agentInfo,
      cwd,
      extNotificationSpecs,
      onSessionConnect: (connection) => {
        currentSessionId = `${agentId}:${connection.sessionId}`;
      },
      onSessionUpdate: (notification: SessionNotification) => {
        processNotification(notification);
      },
      onExtNotification: (method, params) => {
        for (const adapter of adapters) {
          const results = adapter.handleExtNotification(
            method,
            params,
            currentSessionId,
            agentId,
          );
          if (results.length > 0) {
            for (const result of results) {
              processNotification(result);
            }
            return;
          }
        }
      },
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
      {
        const socketPath = generateSocketPath(`inf-${randomUUID()}`);
        const socketServer = await startSocketServer(socketPath);
        servers.push(socketServer);

        // Toolbox is always loaded (not a user-configurable feature)
        deps.toolbox.registerToolboxRoute(socketServer, cwd);
        mcpServers.push(deps.toolbox.buildToolboxMcpServer({ projectDir: cwd, socketPath }));

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
