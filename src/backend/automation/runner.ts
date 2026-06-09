import { join, dirname } from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import type { ContentBlock, SessionNotification, McpServer } from "@agentclientprotocol/sdk";
import { store } from "./store";
import { runningTasks } from "./scheduler";
import { storageOps, TEMP_DIR } from "../storage";
import { ACPBridge } from "../agent/agent-bridge";
import { startSocketServer, type SocketServer } from "../socket-server";
import {
  getSkillsCatalog,
  getSkillSystemPathFromId,
  parseSkillFrontmatter,
  listSkillFiles,
  SKILL_FILENAME,
} from "../skills";
import type { Schedule, SessionNotificationFelloExt } from "../../shared/schema";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let sendEvent:
  | (<K extends "schedules-changed" | "task-update">(channel: K, payload: any) => boolean)
  | null = null;

export function initRunner(
  emitter: <K extends "schedules-changed" | "task-update">(channel: K, payload: any) => boolean,
) {
  sendEvent = emitter;
}

function resolveAgentInfo(agentId: string) {
  const settings = storageOps.getSettings();
  const agent = settings.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  if (agent.type === "stdio") {
    const command = agent.command.trim();
    if (!command) throw new Error(`Agent "${agent.id}" has no command configured.`);
    return { ...agent, command };
  }
  const provider = agent.provider.trim();
  const baseUrl = agent.baseUrl.trim();
  const apiKey = agent.apiKey.trim();
  if (!provider) throw new Error(`Agent "${agent.id}" has no provider configured.`);
  if (!baseUrl) throw new Error(`Agent "${agent.id}" has no baseUrl configured.`);
  if (!apiKey) throw new Error(`Agent "${agent.id}" has no apiKey configured.`);
  return { ...agent, provider, baseUrl, apiKey };
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
    }
  }
  return servers;
}

async function setupSkillsServer(
  taskDir: string,
): Promise<{ server: SocketServer; mcpServer: McpServer }> {
  const socketPath = join(TEMP_DIR, `auto-${randomUUID()}.socket`);
  const server = await startSocketServer(socketPath);

  server.registry("skills/catalog", async () => {
    return getSkillsCatalog({ projectRoot: taskDir }).map(({ id, name, description }) => ({
      id,
      name,
      description,
    }));
  });

  server.registry("skills/detail", async (payload) => {
    const { id } = payload as { id: string };
    const catalog = getSkillsCatalog({ projectRoot: taskDir });
    const skill = catalog.find((s) => s.id === id);
    if (!skill) return { error: `Skill '${id}' not found.` };
    const skillDir = getSkillSystemPathFromId(skill.id, { projectRoot: taskDir });
    if (!skillDir) return { error: `Failed to read skill '${id}'` };
    let body = "";
    try {
      const text = fs.readFileSync(join(skillDir, SKILL_FILENAME), "utf8");
      body = parseSkillFrontmatter(text).body;
    } catch {
      return { error: `Failed to read skill '${id}'` };
    }
    let supportingFiles: string[] = [];
    try {
      supportingFiles = listSkillFiles(skill.id, { projectRoot: taskDir });
    } catch {}
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: body,
      root_path: skillDir,
      supporting_files: supportingFiles,
    };
  });

  const catalogData = getSkillsCatalog({ projectRoot: taskDir }).map(
    ({ id, name, description }) => ({ id, name, description }),
  );
  const catalogFile = join(TEMP_DIR, `auto-catalog-${randomUUID()}.json`);
  fs.writeFileSync(catalogFile, JSON.stringify(catalogData), "utf8");

  const mcpServer: McpServer = {
    name: "skills",
    command: process.execPath,
    args: [
      join(__dirname, "../scripts/mcp-skills/server.mjs"),
      "--project-dir",
      taskDir,
      "--socket-path",
      socketPath,
      "--catalog",
      catalogFile,
    ],
    env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  };

  return { server, mcpServer };
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

  // Collect notifications from the bridge directly
  const notifications: SessionNotificationFelloExt[] = [];

  try {
    const agentInfo = resolveAgentInfo(schedule.agentId);
    const taskDir = store.taskDir(scheduleId, taskId);

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
      const skills = await setupSkillsServer(taskDir);
      skillsServer = skills.server;
      mcpServers.unshift(skills.mcpServer);
    }

    const { sessionId } = await bridge.newSession({ cwd: taskDir, mcpServers });
    const promptContent: ContentBlock[] = [{ type: "text", text: schedule.prompt }];
    await bridge.sendPrompt({ sessionId, prompt: promptContent });

    // Reduce notifications into merged messages (same logic as frontend reducer)
    const messages = reduceNotificationsToMessages(notifications);

    // Write results to task directory
    store.writeTaskFile(
      scheduleId,
      taskId,
      "README.md",
      generateReadme(schedule, messages, startedAt),
    );
    store.writeTaskFile(scheduleId, taskId, "conversation.json", JSON.stringify(messages, null, 2));

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
        const content = (update as any).content;
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
        const content = (update as any).content;
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
        const content = (update as any).content;
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
        const title = (update as any).title ?? "";
        const content = (update as any).content;
        let text = "";
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") text += block.text ?? "";
          }
        }
        messages.push({ role: "tool_call", text, toolTitle: title });
        break;
      }
    }
  }

  return messages;
}

function generateReadme(schedule: Schedule, messages: ReducedMessage[], startedAt: number): string {
  const lines: string[] = [];
  lines.push(`# ${schedule.name}`);
  const locale = storageOps.getSettings().i18n?.language;
  lines.push(`> Run at ${new Date(startedAt).toLocaleString(locale)}`);
  lines.push("");
  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      const text = msg.text.trim();
      if (text) lines.push(text + "\n");
    }
  }
  return lines.join("\n");
}
