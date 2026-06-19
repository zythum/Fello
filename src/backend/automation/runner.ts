import { randomUUID } from "crypto";
import type { ContentBlock, SessionNotification, McpServer } from "@agentclientprotocol/sdk";
import { store } from "./store";
import { runningTasks, restoreActiveSchedules } from "./scheduler";
import { storageOps } from "../storage";
import { ACPBridge } from "../agent/agent-bridge";
import { startSocketServer, generateSocketPath, type SocketServer } from "../socket-server";
import { resolveAgentInfo } from "../agent/resolve-agent-info";
import { registerSkillsRoute, buildSkillsMcpServer } from "../skills";
import type { Schedule, SessionNotificationFelloExt } from "../../shared/schema";

let sendEvent:
  | (<K extends "schedules-changed" | "task-update">(channel: K, payload: any) => boolean)
  | null = null;

export function initRunner(
  emitter: <K extends "schedules-changed" | "task-update">(channel: K, payload: any) => boolean,
) {
  sendEvent = emitter;
  restoreActiveSchedules();
}

function buildAutomationMcpServers(mcpIds: string[]): McpServer[] {
  const settings = storageOps.getSettings();
  const servers: McpServer[] = [];
  for (const id of mcpIds) {
    const config = settings.mcpServers?.find((s) => s.id === id);
    if (!config) continue;
    if (config.type === "stdio") {
      servers.push({
        name: id,
        command: config.command,
        args: config.args,
        env: Object.entries(config.env).map(([k, v]) => ({ name: k, value: v })),
      });
    } else if (config.type === "http") {
      servers.push({
        type: "http",
        name: id,
        url: config.url,
        headers: Object.entries(config.headers).map(([k, v]) => ({ name: k, value: v })),
      });
    } else if (config.type === "sse") {
      servers.push({
        type: "sse",
        name: id,
        url: config.url,
        headers: Object.entries(config.headers).map(([k, v]) => ({ name: k, value: v })),
      });
    }
  }
  return servers;
}

export async function executeTask(scheduleId: string): Promise<import("../../shared/schema").Task> {
  if (runningTasks.has(scheduleId)) {
    throw new Error("Schedule task is already running");
  }

  const schedule = store.getSchedule(scheduleId);
  if (!schedule) throw new Error("Schedule not found");

  runningTasks.add(scheduleId);
  const taskId = String(Date.now());
  const startedAt = Date.now();
  const task: import("../../shared/schema").Task = {
    id: taskId,
    scheduleId,
    startedAt,
    completedAt: null,
    status: "running",
  };

  store.saveTask(scheduleId, task);
  sendEvent?.("task-update", { scheduleId, task });

  const taskDir = store.taskDir(scheduleId, taskId);

  // Collect notifications from the bridge directly
  const notifications: SessionNotificationFelloExt[] = [];

  try {
    const agentInfo = resolveAgentInfo(schedule.agentId);

    const bridge = new ACPBridge(schedule.agentId, {
      agentInfo,
      onSessionUpdate: (notification: SessionNotification) => {
        notifications.push({
          ...notification,
          update: {
            ...notification.update,
            _meta: {
              ...notification.update?._meta,
              fello: { receivedAt: Date.now(), displayId: `auto-${notifications.length}` },
            },
          },
        });
      },
      onPermissionRequest: async (req) => {
        const opt =
          req.options.find((o) => o.kind === "allow_always") ??
          req.options.find((o) => o.kind === "allow_once") ??
          req.options[0];
        return { outcome: { outcome: "selected", optionId: opt?.optionId ?? "allow" } };
      },
      onAgentTerminalOutput: () => {},
    });

    await bridge.connect();

    const mcpServers = buildAutomationMcpServers(schedule.mcpServers ?? []);
    let skillsServer: SocketServer | null = null;
    const effectiveFeatures = schedule.features ?? [];
    if (effectiveFeatures.includes("skills")) {
      const socketPath = generateSocketPath(`auto-${randomUUID()}`);
      skillsServer = await startSocketServer(socketPath);
      registerSkillsRoute(skillsServer, taskDir);
      mcpServers.unshift(buildSkillsMcpServer({ projectDir: taskDir, socketPath }));
    }

    const { sessionId } = await bridge.newSession({ cwd: taskDir, mcpServers });

    // 如果 Schedule 指定了模型，在发送 Prompt 前设置
    let modelError: string | null = null;
    if (schedule.modelId) {
      try {
        await bridge.setSessionModel({ sessionId, modelId: schedule.modelId });
      } catch (err) {
        const rawError = err instanceof Error ? err.message : String(err);
        console.warn(
          `[Automation] Failed to set model "${schedule.modelId}" for schedule "${schedule.id}":`,
          rawError,
        );
        modelError = `Failed to set model "${schedule.modelId}", using default model`;
      }
    }

    const promptContent: ContentBlock[] = [{ type: "text", text: schedule.prompt }];
    await bridge.sendPrompt({ sessionId, prompt: promptContent });

    // Reduce notifications into merged messages (same logic as frontend reducer)
    const messages = reduceNotificationsToMessages(notifications);

    // Write results to task directory
    store.writeTaskFile(
      scheduleId,
      taskId,
      "README.md",
      generateReadme(schedule, messages, startedAt, modelError),
    );
    store.writeTaskFile(scheduleId, taskId, "conversation.json", JSON.stringify(messages, null, 2));

    await bridge.closeSession(sessionId);
    await bridge.deleteSession(sessionId);

    // Cleanup: kill the dedicated bridge process
    await bridge.kill();
    skillsServer?.stop();

    // Update schedule
    schedule.lastRunAt = Date.now();
    schedule.updatedAt = Date.now();
    store.saveSchedule(schedule);
    sendEvent?.("schedules-changed", undefined);

    // Mark success
    task.completedAt = Date.now();
    task.status = "success";
    store.saveTask(scheduleId, task);
    sendEvent?.("task-update", { scheduleId, task });

    return task;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    task.completedAt = Date.now();
    task.status = "error";
    task.error = errorMessage;
    store.saveTask(scheduleId, task);
    sendEvent?.("task-update", { scheduleId, task });
    console.error(`[Automation] Task failed:`, errorMessage);

    // 即使失败也生成 README.md 和 conversation.json
    try {
      const messages = reduceNotificationsToMessages(notifications);
      store.writeTaskFile(
        scheduleId,
        taskId,
        "README.md",
        generateErrorReadme(schedule, messages, startedAt, errorMessage),
      );
      if (messages.length > 0) {
        store.writeTaskFile(
          scheduleId,
          taskId,
          "conversation.json",
          JSON.stringify(messages, null, 2),
        );
      }
    } catch (writeErr) {
      console.warn(`[Automation] Failed to write error artifacts:`, writeErr);
    }

    return task;
  } finally {
    runningTasks.delete(scheduleId);
  }
}

interface ReducedMessage {
  role: "user" | "assistant" | "thought" | "tool_call";
  text: string;
  toolTitle?: string;
}

function reduceNotificationsToMessages(
  notifications: SessionNotificationFelloExt[],
): ReducedMessage[] {
  const messages: ReducedMessage[] = [];

  for (const n of notifications) {
    const update = n.update;
    if (!update) continue;

    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        const content = update.content;
        if (!content || content.type !== "text") break;
        const last = messages[messages.length - 1];
        if (last && last.role === "user") {
          last.text += content.text ?? "";
        } else {
          messages.push({ role: "user", text: content.text ?? "" });
        }
        break;
      }
      case "agent_message_chunk": {
        const content = update.content;
        if (!content || content.type !== "text") break;
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant") {
          last.text += content.text ?? "";
        } else {
          messages.push({ role: "assistant", text: content.text ?? "" });
        }
        break;
      }
      case "agent_thought_chunk": {
        const content = update.content;
        if (!content || content.type !== "text") break;
        const last = messages[messages.length - 1];
        if (last && last.role === "thought") {
          last.text += content.text ?? "";
        } else {
          messages.push({ role: "thought", text: content.text ?? "" });
        }
        break;
      }
      case "tool_call":
      case "tool_call_update": {
        const title = update.title ?? "";
        const content = update.content;
        let text = "";
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "content") text += block.content.type ?? "";
          }
        }
        messages.push({ role: "tool_call", text, toolTitle: title });
        break;
      }
    }
  }

  return messages;
}

/** Append user/assistant message text to lines array (shared by all README generators) */
function renderMessages(lines: string[], messages: ReducedMessage[]): void {
  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      const text = msg.text.trim();
      if (text) lines.push(text + "\n");
    }
  }
}

function generateErrorReadme(
  schedule: Schedule,
  messages: ReducedMessage[],
  startedAt: number,
  errorMessage: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${schedule.name}`);
  const locale = storageOps.getSettings().i18n?.language;
  lines.push(`> Run at ${new Date(startedAt).toLocaleString(locale)}`);
  lines.push("");
  lines.push(`> ❌ Task failed: ${errorMessage}`);
  lines.push("");
  renderMessages(lines, messages);
  return lines.join("\n");
}

function generateReadme(
  schedule: Schedule,
  messages: ReducedMessage[],
  startedAt: number,
  modelError: string | null,
): string {
  const lines: string[] = [];
  lines.push(`# ${schedule.name}`);
  const locale = storageOps.getSettings().i18n?.language;
  lines.push(`> Run at ${new Date(startedAt).toLocaleString(locale)}`);

  if (modelError) {
    lines.push("");
    lines.push(`> ⚠️ ${modelError}`);
    lines.push(`> The task continued with the agent's default model.`);
  }

  lines.push("");
  renderMessages(lines, messages);
  return lines.join("\n");
}
