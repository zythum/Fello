import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  PromptResponse,
  McpServer,
  ContentBlock,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import Fuse from "fuse.js";
import { z } from "zod";
import { homedir } from "os";
import { spawn as spawnPty } from "node-pty";
import { omit } from "es-toolkit";
import { createHash, randomUUID } from "crypto";
import {
  chmod,
  mkdir,
  readdir,
  readFile as fsReadFile,
  rename,
  rm,
  stat,
  writeFile,
  open,
  copyFile,
} from "fs/promises";
import * as mimeTypes from "mime-types";
import { dirname, join, relative, extname, basename } from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execFile } from "child_process";
import { promisify } from "util";
import { ACPBridge } from "./agent/agent-bridge";
import { startWebUI, stopWebUI, getWebUIStatus, broadcastWebUIEvent } from "./webui";
import { startSocketServer, type SocketServer } from "./socket-server";
import { isIgnorePath, resolveSafePath, toPosixPath } from "./utils";
import type {
  ProjectInfo,
  AgentInfo,
  SessionNotificationFelloExt,
  FelloIPCSchema,
  FelloContextUpdate,
  AskUserRequest,
  AskUserRequestOption,
  Feature,
  Schedule,
} from "../shared/schema";
import { ALL_FEATURES } from "../shared/constants";
import {
  askUserAskRequestSchema,
  askUserAskRespondSchema,
} from "../shared/zod/mcp-ask-user-schema";
import {
  skillCatalogSchema,
  skillDetailRequestSchema,
  skillDetailSchema,
} from "../shared/zod/mcp-skills-schema";
import { storageOps, SOCKETS_DIR, TEMP_DIR } from "./storage";
import {
  ILinkBridge,
  readActiveSessionId,
  writeActiveSessionId,
  hasImageItems,
  extractMessageText,
  extractVoiceText,
} from "./ilink/ilink-bridge";
import { deletePersistedSessionDirectory, loadContextTimeline } from "../agents/storage";
import {
  store as autoStore,
  initRunner,
  restoreActiveSchedules,
  scheduleCron,
  unscheduleCron,
  executeTask,
  stopAllCrons,
  getNextRun,
} from "./automation";
import { initWatcher, syncWatchers } from "./watcher";
import {
  getSkillsCatalog,
  getSkillSystemPathFromId,
  parseSkillFrontmatter,
  listSkillFiles,
  SKILL_FILENAME,
  searchSkills,
  installSkill,
} from "./skills";
import { t, setLanguage } from "./i18n";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildMcpServersConfig(
  sessionMcpIds: string[],
  options: {
    project: ProjectInfo;
    socketPath: string | null;
    features?: Feature[];
  },
): McpServer[] {
  const { project, socketPath, features = ALL_FEATURES } = options;
  // Built-in MCP servers — always first
  const servers: McpServer[] = [];

  if (socketPath && features.includes("skills")) {
    const skillCatalog: z.infer<typeof skillCatalogSchema> = getSkillsCatalog({
      projectRoot: project.cwd,
    }).map((skill) => omit(skill, ["scope", "level"]));

    const skillCatalogFilename = join(TEMP_DIR, `project-${project.id}-${randomUUID()}.json`);

    fs.writeFileSync(skillCatalogFilename, JSON.stringify(skillCatalog), "utf8");

    servers.push({
      name: "skills",
      command: process.execPath,
      args: [
        join(__dirname, "../scripts/mcp-skills/server.mjs"),
        "--project-dir",
        project.cwd,
        "--socket-path",
        socketPath,
        "--catalog",
        skillCatalogFilename,
      ],
      env: [
        {
          name: "ELECTRON_RUN_AS_NODE",
          value: "1",
        },
      ],
    });
  }

  // Dynamically add ask-user MCP server if socket server is running and ask_user feature is enabled
  if (socketPath && features.includes("ask_user")) {
    servers.push({
      name: "ask-user",
      command: process.execPath,
      args: [
        join(__dirname, "../scripts/mcp-ask-user/server.mjs"),
        "--project-dir",
        project.cwd,
        "--socket-path",
        socketPath,
      ],
      env: [
        {
          name: "ELECTRON_RUN_AS_NODE",
          value: "1",
        },
      ],
    });
  }

  const globalSettings = storageOps.getSettings();

  for (const id of sessionMcpIds) {
    const config = globalSettings.mcpServers?.find((s) => s.id === id);
    if (config) {
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
  }

  return servers;
}

export const SEARCH_MAX_RESULTS = 10;
export const SEARCH_FUSE_THRESHOLD = 0.4;
const SEARCH_CACHE_TTL_MS = 60_000;

type SearchFileItem = { id: string; filename: string; isFolder: boolean };
type SearchFileCacheEntry = {
  version: number;
  builtAt: number;
  files: SearchFileItem[];
  fuse: Fuse<SearchFileItem>;
};

const projectFsVersions = new Map<string, number>();
const searchFileCache = new Map<string, SearchFileCacheEntry>();

type AgentType = string;
const bridgePool = new Map<AgentType, Promise<ACPBridge>>();
const USER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

/** 每个 session 独立维护一个 socket server，用于 MCP 工具与 backend 通信 */
const sessionSocketServers = new Map<string, SocketServer>();

function generateSessionSocketPath(key: string): string {
  const timestamp = Date.now();
  if (process.platform === "win32") {
    // Windows 使用命名管道，退出后由 OS 自动清理
    return `\\\\.\\pipe\\fello-${key}-${timestamp}`;
  }
  return join(SOCKETS_DIR, `${key}-${timestamp}.socket`);
}

/** 创建或复用 session 对应的 socket server，并注册 ask-user/skills 路由 */
async function createSessionSocketServer(
  sessionId: string,
  options: {
    socketPath: string;
    project: ProjectInfo;
  },
): Promise<SocketServer> {
  const existing = sessionSocketServers.get(sessionId);
  // 如果已有 server 且 socketPath 匹配，直接复用
  if (existing && existing.socketPath === options.socketPath) {
    return existing;
  }
  // 如果已有 server 但 socketPath 变了，先停掉旧的（避免 MCP 进程连到错误路径）
  if (existing) {
    existing.stop();
    sessionSocketServers.delete(sessionId);
  }

  const server = await startSocketServer(options.socketPath);

  // ask-user
  server.registry("ask-user/ask", async (payload) => {
    const request = askUserAskRequestSchema.parse(payload);
    const result: z.infer<typeof askUserAskRespondSchema> = await askUser({
      sessionId,
      ...request,
    });
    return result;
  });

  // skills
  server.registry("skills/catalog", async () => {
    const catalog: z.infer<typeof skillCatalogSchema> = getSkillsCatalog({
      projectRoot: options.project.cwd,
    }).map((skill) => omit(skill, ["scope", "level"]));
    return catalog;
  });

  server.registry("skills/detail", async (payload) => {
    const { id } = skillDetailRequestSchema.parse(payload);
    const catalog = getSkillsCatalog({
      projectRoot: options.project.cwd,
    });
    const skill = catalog.find((skill) => skill.id === id);
    if (!skill) {
      return {
        error: `Skill '${id}' not found.`,
        available_skills: catalog,
      };
    }
    const skillDir = getSkillSystemPathFromId(skill.id, {
      projectRoot: options.project.cwd,
    });
    if (!skillDir) {
      return { error: `Failed to Read skill '${id}'` };
    }
    const skillFile = join(skillDir, SKILL_FILENAME);
    let body = "";
    try {
      const text = fs.readFileSync(skillFile, "utf8");
      const parsed = parseSkillFrontmatter(text);
      body = parsed.body;
    } catch {
      return { error: `Failed to read skill '${id}'` };
    }
    let supportingFiles: string[] = [];
    try {
      supportingFiles = listSkillFiles(skill.id, {
        projectRoot: options.project.cwd,
      });
    } catch {}
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: body,
      root_path: skillDir,
      supporting_files: supportingFiles,
    } satisfies z.infer<typeof skillDetailSchema>;
  });

  sessionSocketServers.set(sessionId, server);
  return server;
}

function stopSessionSocketServer(sessionId: string) {
  const ss = sessionSocketServers.get(sessionId);
  if (ss) {
    ss.stop();
  }
  sessionSocketServers.delete(sessionId);
}

// ── askUser 内部类型 ────────────────────────────────────────────────

/** askUser 的输入参数（调用者传入，无需关心 askUserId） */
export interface AskUserOptions {
  sessionId: string;
  title: string;
  description: string;
  options: AskUserRequestOption[];
  allowCustomInput?: boolean;
}

/** askUser 的返回值（调用者获取，只有结果信息） */
export interface AskUserResult {
  value: string | null;
  reason: string | null;
}

/** 挂起的 askUser 请求池：askUserId → 回调/超时/会话信息 */
const pendingAskUserRequests = new Map<
  string,
  {
    resolve: (value: AskUserResult) => void;
    timeoutId: ReturnType<typeof setTimeout>;
    sessionId: string;
    request: AskUserRequest; // 存储完整请求，用于 WeChat 序号匹配等
  }
>();

// Track sessions that are currently being restored (via loadSession) to block duplicate/invalid replays from agent
const restoringSessions = new Set<string>();

// In-memory cache for pending tool_call updates to avoid writing frequent in_progress updates to disk.
// Key: sessionId + ":" + toolCallId
// Value: the last merged ToolCallUpdate for this tool call.
const pendingToolCalls = new Map<string, ToolCallUpdate>();

function getPendingToolCallKey(sessionId: string, toolCallId: string) {
  return `${sessionId}:${toolCallId}`;
}

/**
 * 将 askUser 请求格式化为带序号的 Markdown 文本，用于微信转发
 */
function formatAskUserForWeChat(request: AskUserRequest): string {
  const lines: string[] = [];
  lines.push(`## ${t("ilink.pleaseConfirm")}`);
  if (request.title) lines.push(`**${request.title}**`, "");
  if (request.description) lines.push(request.description, "");
  if (request.options.length > 0) {
    lines.push(t("ilink.askUserReplyWithNumber"));
    request.options.forEach((opt, i) => {
      lines.push(`${i + 1}. ${opt.label}`);
    });
    lines.push("");
    lines.push(t("ilink.askUserCustomReply"));
  }
  return lines.join("\n");
}

/**
 * 通用 askUser 机制：向用户展示问题并等待选择
 * 会发送 "ask-user-request" 事件给前端，并返回一个 Promise，
 * 该 Promise 在用户选择或超时时 resolve。
 */
export async function askUser(options: AskUserOptions): Promise<AskUserResult> {
  const { sessionId } = options;
  const askUserId = randomUUID();
  const request: AskUserRequest = { ...options, askUserId };

  sendEvent("ask-user-request", request);

  // 如果是活跃 WeChat session，转发给微信用户
  if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
    const userId = ilinkBridge.userId;
    if (userId) {
      // Stop keepalive — we're waiting for user input, not thinking
      ilinkBridge.sendTyping(userId, false).catch(() => {});
      const weChatText = formatAskUserForWeChat(request);
      ilinkBridge.sendTextReply(userId, weChatText).catch((err) => {
        console.warn("[iLink] Failed to forward askUser to WeChat:", err);
      });
    }
  }

  return new Promise<AskUserResult>((resolve) => {
    const timeoutId = setTimeout(() => {
      const pending = pendingAskUserRequests.get(askUserId);
      if (pending) {
        pendingAskUserRequests.delete(askUserId);
        const response: AskUserResult = { value: null, reason: "timeout" };
        resolve(response);
        sendEvent("ask-user-response", {
          sessionId,
          askUserId,
          value: null,
          reason: "timeout",
        });
      } else {
        console.warn(`[askUser] timeout fired but no pending request found for ${askUserId}`);
      }
    }, USER_REQUEST_TIMEOUT_MS);

    pendingAskUserRequests.set(askUserId, { resolve, timeoutId, sessionId, request });
  });
}

// ── iLink State ─────────────────────────────────────────────────────

let ilinkBridge: ILinkBridge | null = null;
let ilinkActiveSessionId: string | null = null;
let ilinkReplyBuffer = "";
let iLinkCommandPending: ((input: string) => void) | null = null;

function getILinkBridge(): ILinkBridge {
  if (!ilinkBridge) {
    ilinkBridge = new ILinkBridge({
      onStatusChange: (status) => {
        sendEvent("ilink-status-changed", { status });
        broadcastWebUIEvent("ilink-status-changed", { status });
      },
      onMessage: async (msg) => {
        const text = extractMessageText(msg);
        const voiceText = extractVoiceText(msg);
        const hasImages = hasImageItems(msg);
        const combinedText = [text, voiceText].filter(Boolean).join("\n");
        if (!combinedText.trim() && !hasImages) return;

        const trimmed = text.trim();

        if (iLinkCommandPending) {
          iLinkCommandPending(trimmed);
          iLinkCommandPending = null;
          return;
        }

        if (trimmed[0] === "!" || trimmed[0] === "！") {
          const session = ilinkActiveSessionId ? storageOps.getSession(ilinkActiveSessionId) : null;
          if (session && session.isStreaming) {
            backendHandlers.cancelPrompt({ sessionId: session.id }).catch((err) => {
              console.warn("[iLink] Failed to cancel prompt:", err);
            });
          }

          const [command, ..._args] = trimmed.slice(1).split(/\s+/);
          if (command.toLowerCase() === "s") {
            // !s: 列出所有会话，等待用户选择序号切换
            const allSessions = storageOps.listSessions();
            if (allSessions.length === 0) {
              if (msg.from_user_id) {
                await ilinkBridge?.sendTextReply(msg.from_user_id, t("ilink.noSessions"));
              }
              return;
            }

            // 按项目分组
            const projects = storageOps.listProjects();
            const projectMap = new Map(projects.map((p) => [p.id, p]));

            const lines: string[] = [];
            lines.push(`📋 **${t("ilink.sessionList")}**`);
            lines.push(t("ilink.sessionListDesc"));
            let index = 1;
            let isFirstGroup = true;
            const sessionEntries: Array<{ sessionId: string; label: string }> = [];

            // 按项目分组
            const grouped = new Map<string, typeof allSessions>();
            for (const s of allSessions) {
              const project = projectMap.get(s.projectId);
              const key = project?.title ?? s.cwd;
              if (!grouped.has(key)) grouped.set(key, []);
              grouped.get(key)!.push(s);
            }

            const sortedProjectNames = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
            for (const projectName of sortedProjectNames) {
              const sessions = grouped.get(projectName)!;
              if (!isFirstGroup) {
                lines.push(`\n---`);
              }
              isFirstGroup = false;
              lines.push(`\n**${projectName}**`);
              for (const s of sessions) {
                const marker = s.id === ilinkActiveSessionId ? " 👈" : "";
                const label = s.title || t("ilink.newSession");
                lines.push(`  ${index}. ${label}${marker}`);
                sessionEntries.push({ sessionId: s.id, label });
                index++;
              }
            }

            lines.push("", "---", t("ilink.switchSessionHint"));

            if (msg.from_user_id) {
              await ilinkBridge?.sendTextReply(msg.from_user_id, lines.join("\n"));
            }

            // 设置回调，等待用户输入序号
            iLinkCommandPending = (input: string) => {
              const num = parseInt(input, 10);
              if (isNaN(num) || num < 1 || num > sessionEntries.length) {
                const errMsg = t("ilink.invalidSessionNumber", {
                  min: "1",
                  max: String(sessionEntries.length),
                });
                if (msg.from_user_id) {
                  ilinkBridge?.sendTextReply(msg.from_user_id, errMsg);
                }
                return;
              }
              const entry = sessionEntries[num - 1];
              // 切换到选中的会话
              ilinkActiveSessionId = entry.sessionId;
              ilinkReplyBuffer = "";
              writeActiveSessionId(entry.sessionId).catch(() => {});
              sendEvent("ilink-active-session-changed", { sessionId: entry.sessionId });
              if (msg.from_user_id) {
                ilinkBridge?.sendTextReply(
                  msg.from_user_id,
                  t("ilink.switchedToSession", { label: entry.label }),
                );
              }
            };
          } else if (command.toLowerCase() === "n") {
            // !n: 列出项目，等待用户选择序号以创建新会话
            const allProjects = storageOps.listProjects();
            if (allProjects.length === 0) {
              if (msg.from_user_id) {
                await ilinkBridge?.sendTextReply(msg.from_user_id, t("ilink.noProjects"));
              }
              return;
            }

            const sortedProjects = [...allProjects].sort((a, b) => a.title.localeCompare(b.title));

            const lines: string[] = [];
            lines.push(`📋 **${t("ilink.newSessionTitle")}**`);
            lines.push(t("ilink.newSessionDesc"));
            const projectEntries: Array<{ projectId: string; title: string }> = [];
            sortedProjects.forEach((p, i) => {
              lines.push(`  ${i + 1}. ${p.title}`);
              projectEntries.push({ projectId: p.id, title: p.title });
            });
            lines.push("", "---", t("ilink.createSessionHint"));

            if (msg.from_user_id) {
              await ilinkBridge?.sendTextReply(msg.from_user_id, lines.join("\n"));
            }

            // 设置回调，等待用户输入序号
            iLinkCommandPending = (input: string) => {
              const num = parseInt(input, 10);
              if (isNaN(num) || num < 1 || num > projectEntries.length) {
                const errMsg = t("ilink.invalidSessionNumber", {
                  min: "1",
                  max: String(projectEntries.length),
                });
                if (msg.from_user_id) {
                  ilinkBridge?.sendTextReply(msg.from_user_id, errMsg);
                }
                return;
              }
              const entry = projectEntries[num - 1];
              // 获取第一个可用的 agent
              const settings = storageOps.getSettings();
              const agent = settings.agents.find((a) => !a.disabled);
              if (!agent) {
                if (msg.from_user_id) {
                  ilinkBridge?.sendTextReply(msg.from_user_id, t("ilink.noAgent"));
                }
                return;
              }
              // 创建新会话，参数与 sidebar 对话框默认值一致
              const globalSettings = storageOps.getSettings();
              const defaultMcpIds = (globalSettings.mcpServers || [])
                .filter((s) => !s.disabled)
                .map((s) => s.id);
              backendHandlers
                .newSession({
                  projectId: entry.projectId,
                  agentId: agent.id,
                  mcpServers: defaultMcpIds,
                  features: ALL_FEATURES,
                  permissionMode: "allow-all",
                })
                .then((result) => {
                  const newSessionId = result.sessionId;
                  // 切换到新会话
                  ilinkActiveSessionId = newSessionId;
                  ilinkReplyBuffer = "";
                  writeActiveSessionId(newSessionId).catch(() => {});
                  sendEvent("ilink-active-session-changed", { sessionId: newSessionId });
                  if (msg.from_user_id) {
                    ilinkBridge?.sendTextReply(
                      msg.from_user_id,
                      t("ilink.createdAndSwitched", { project: entry.title }),
                    );
                  }
                })
                .catch((err) => {
                  console.error("[iLink] Failed to create new session:", err);
                  if (msg.from_user_id) {
                    ilinkBridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
                  }
                });
            };
          } else if (command.toLowerCase() === "m") {
            // !m: 列出当前会话的可用模型，等待用户选择序号切换
            const sessionId = ilinkActiveSessionId ?? "";
            if (!sessionId) {
              if (msg.from_user_id) {
                const noSessionMsg = [
                  `📋 **${t("ilink.noActiveSession")}**`,
                  "",
                  t("ilink.switchSessionGuide"),
                  t("ilink.createSessionGuide"),
                ];
                await ilinkBridge?.sendTextReply(msg.from_user_id, noSessionMsg.join("\n"));
              }
              return;
            }

            const modelState = await backendHandlers.getModels({ sessionId });
            if (
              !modelState ||
              !modelState.availableModels ||
              modelState.availableModels.length === 0
            ) {
              if (msg.from_user_id) {
                await ilinkBridge?.sendTextReply(msg.from_user_id, t("ilink.noModels"));
              }
              return;
            }

            const lines: string[] = [];
            lines.push(`🧠 **${t("ilink.modelList")}**`);
            lines.push(t("ilink.modelListDesc"));
            const modelEntries: Array<{ modelId: string; label: string }> = [];
            modelState.availableModels.forEach((m, i) => {
              const marker = m.modelId === modelState.currentModelId ? " 👈" : "";
              const label = m.name || m.modelId;
              lines.push(`  ${i + 1}. ${label}${marker}`);
              modelEntries.push({ modelId: m.modelId, label });
            });

            lines.push("", "---", t("ilink.switchModelHint"));

            if (msg.from_user_id) {
              await ilinkBridge?.sendTextReply(msg.from_user_id, lines.join("\n"));
            }

            // 设置回调，等待用户输入序号
            iLinkCommandPending = (input: string) => {
              const num = parseInt(input, 10);
              if (isNaN(num) || num < 1 || num > modelEntries.length) {
                const errMsg = t("ilink.invalidSessionNumber", {
                  min: "1",
                  max: String(modelEntries.length),
                });
                if (msg.from_user_id) {
                  ilinkBridge?.sendTextReply(msg.from_user_id, errMsg);
                }
                return;
              }
              const entry = modelEntries[num - 1];
              backendHandlers
                .setModel({ sessionId, modelId: entry.modelId })
                .then(() => {
                  if (msg.from_user_id) {
                    ilinkBridge?.sendTextReply(
                      msg.from_user_id,
                      t("ilink.switchedToModel", { model: entry.label }),
                    );
                  }
                })
                .catch((err) => {
                  console.error("[iLink] Failed to set model:", err);
                  if (msg.from_user_id) {
                    ilinkBridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
                  }
                });
            };
          } else if (command.toLowerCase() === "q") {
            // !q: 列出所有快捷短语（snippets），等待用户选择序号发送
            const settings = storageOps.getSettings();
            const snippets = settings.snippets ?? [];
            if (snippets.length === 0) {
              if (msg.from_user_id) {
                await ilinkBridge?.sendTextReply(msg.from_user_id, t("ilink.noSnippets"));
              }
              return;
            }

            const lines: string[] = [];
            lines.push(`📝 **${t("ilink.snippetList")}**`);
            lines.push(t("ilink.snippetListDesc"));
            const snippetEntries: Array<{
              snippetId: string;
              title: string;
              content: string;
            }> = [];
            snippets.forEach((s, i) => {
              const preview =
                s.content.length > 50 ? s.content.substring(0, 50) + "..." : s.content;
              lines.push(`  ${i + 1}. **${s.title}** — ${preview}`);
              snippetEntries.push({ snippetId: s.id, title: s.title, content: s.content });
            });

            lines.push("", "---", t("ilink.selectSnippetHint"));

            if (msg.from_user_id) {
              await ilinkBridge?.sendTextReply(msg.from_user_id, lines.join("\n"));
            }

            // 设置回调，等待用户输入序号
            iLinkCommandPending = (input: string) => {
              const num = parseInt(input, 10);
              if (isNaN(num) || num < 1 || num > snippetEntries.length) {
                const errMsg = t("ilink.invalidSessionNumber", {
                  min: "1",
                  max: String(snippetEntries.length),
                });
                if (msg.from_user_id) {
                  ilinkBridge?.sendTextReply(msg.from_user_id, errMsg);
                }
                return;
              }
              const entry = snippetEntries[num - 1];
              const sessionId = ilinkActiveSessionId ?? "";
              if (!sessionId) {
                if (msg.from_user_id) {
                  const noSessionMsg = [
                    `📋 **${t("ilink.noActiveSession")}**`,
                    "",
                    t("ilink.switchSessionGuide"),
                    t("ilink.createSessionGuide"),
                  ];
                  ilinkBridge?.sendTextReply(msg.from_user_id, noSessionMsg.join("\n"));
                }
                return;
              }

              // 将快捷短语内容发送给当前活跃 session
              backendHandlers
                .sendPrompt({
                  sessionId,
                  contents: [{ type: "text", text: entry.content }],
                })
                .then(() => {
                  if (msg.from_user_id) {
                    ilinkBridge?.sendTextReply(
                      msg.from_user_id,
                      t("ilink.snippetSent", { title: entry.title }),
                    );
                  }
                })
                .catch((err) => {
                  console.error("[iLink] Failed to send snippet:", err);
                  if (msg.from_user_id) {
                    ilinkBridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
                  }
                });
            };
          } else {
            // 显示当前微信活跃 session 的信息
            const currentSession = ilinkActiveSessionId
              ? storageOps.getSession(ilinkActiveSessionId)
              : null;
            const message = (() => {
              const lines: string[] = [];
              lines.push(`📋 **${t("ilink.sessionInfo")}**`);

              if (!currentSession) {
                lines.push(t("ilink.noActiveSession"));
                lines.push("", "---", t("ilink.switchSessionGuide"), t("ilink.createSessionGuide"));
                return lines.join("\n");
              }

              const projects = storageOps.listProjects();
              const project = projects.find((p) => p.id === currentSession.projectId);
              lines.push(
                `**${t("ilink.title")}**: ${currentSession.title || t("ilink.newSession")}`,
              );
              if (project) {
                lines.push(`**${t("ilink.project")}**: ${project.title}`);
              }
              lines.push(`**${t("ilink.projectDir")}**: \`${currentSession.cwd}\``);
              lines.push(`**${t("ilink.agent")}**: \`${currentSession.agentId}\``);

              // Features
              const enabledFeatures = new Set(currentSession.features ?? []);
              lines.push(`**${t("ilink.features")}**:`);
              for (const f of ALL_FEATURES) {
                lines.push(`  - ${enabledFeatures.has(f) ? "✓" : "✗"} ${f}`);
              }

              // MCP servers
              const globalSettings = storageOps.getSettings();
              const sessionMcpIds = new Set(currentSession.mcpServers ?? []);
              const allMcpServers = globalSettings.mcpServers ?? [];
              if (allMcpServers.length > 0) {
                lines.push(`**${t("ilink.mcpServers")}**:`);
                for (const srv of allMcpServers) {
                  const enabled = sessionMcpIds.has(srv.id) && !srv.disabled;
                  lines.push(`  - ${enabled ? "✓" : "✗"} \`${srv.id}\``);
                }
              } else {
                lines.push(`**${t("ilink.mcpServers")}**: —`);
              }

              lines.push(
                "",
                "---",
                t("ilink.switchSessionGuide"),
                t("ilink.createSessionGuide"),
                t("ilink.modelGuide"),
                t("ilink.snippetGuide"),
              );
              return lines.join("\n");
            })();
            if (msg.from_user_id) {
              await ilinkBridge?.sendTextReply(msg.from_user_id, message);
            }
          }
          return;
        }

        const sessionId = ilinkActiveSessionId ?? "";
        if (!sessionId) {
          console.warn("[iLink] No active session, ignoring message");
          if (msg.from_user_id) {
            const lines = [
              `📋 **${t("ilink.noActiveSession")}**`,
              "",
              t("ilink.switchSessionGuide"),
              t("ilink.createSessionGuide"),
            ];
            await ilinkBridge?.sendTextReply(msg.from_user_id, lines.join("\n"));
          }
          return;
        }

        const contents: ContentBlock[] = [];

        if (combinedText.trim()) {
          contents.push({ type: "text", text: combinedText });
        }

        if (hasImages && ilinkBridge) {
          const { useOriginalImage } = storageOps.getSettings().ilink;
          for (const item of msg.item_list ?? []) {
            if (item.type !== 2 || !item.image_item) continue;
            try {
              const base64 = await ilinkBridge.downloadImage(item.image_item, { useOriginalImage });
              if (base64) {
                contents.push({ type: "image", data: base64, mimeType: "image/jpeg" });
              }
            } catch (err) {
              console.error("[iLink] Failed to download image:", err);
            }
          }
        }

        if (contents.length === 0) return;

        // ── askUser 拦截：如果该 session 有 pending 的 askUser 请求，拦截回复 ──
        const pendingEntry = Array.from(pendingAskUserRequests.entries()).find(
          ([, p]) => p.sessionId === sessionId,
        );
        if (pendingEntry) {
          const [askUserId, pendingReq] = pendingEntry;
          const options = pendingReq.request.options;

          let respondedValue: string | null = null;

          // 纯数字 → 匹配选项序号（1-based）
          if (/^\d+$/.test(trimmed)) {
            const index = parseInt(trimmed, 10) - 1;
            const option = options[index];
            if (option) {
              respondedValue = option.value;
            }
          }

          if (respondedValue !== null) {
            await backendHandlers.respondAskUser({
              sessionId,
              askUserId,
              value: respondedValue,
            });
          } else {
            // 否则作为自定义回复
            await backendHandlers.respondAskUser({
              sessionId,
              askUserId,
              value: null,
              reason: trimmed || t("ilink.noInput"),
            });
          }

          // 用户已回复 askUser，agent 将继续生成 → 重启保活心跳
          if (ilinkBridge?.isConnected && ilinkActiveSessionId === sessionId) {
            const userId = ilinkBridge.userId;
            if (userId) {
              ilinkBridge.sendTyping(userId, true).catch(() => {});
            }
          }

          return; // 已拦截，不调用 sendPrompt
        }

        try {
          await backendHandlers.sendPrompt({ sessionId, contents });
        } catch (err) {
          console.error("[iLink] Failed to route message to session:", err);
          // Try to notify the WeChat user about the error
          if (msg.from_user_id) {
            await ilinkBridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
          }
        }
      },
    });
  }
  return ilinkBridge;
}

/**
 * Merge a tool_call_update into a base ToolCallUpdate.
 * Mirrors the logic in mainview/lib/session-state-reducer.ts calculateToolCall.
 */
function mergeToolCallUpdate<T extends ToolCallUpdate>(base: ToolCallUpdate, update: T): T {
  const merged: ToolCallUpdate = { ...base };

  if (Object.prototype.hasOwnProperty.call(update, "title")) {
    merged.title = update.title;
  }
  if (Object.prototype.hasOwnProperty.call(update, "status") && update.status != null) {
    merged.status = update.status;
  }
  if (Object.prototype.hasOwnProperty.call(update, "content")) {
    merged.content = update.content;
  }
  if (Object.prototype.hasOwnProperty.call(update, "kind") && update.kind != null) {
    merged.kind = update.kind;
  }
  if (Object.prototype.hasOwnProperty.call(update, "rawInput")) {
    merged.rawInput = update.rawInput;
  }
  if (Object.prototype.hasOwnProperty.call(update, "locations")) {
    merged.locations = update.locations;
  }
  if (Object.prototype.hasOwnProperty.call(update, "rawOutput")) {
    merged.rawOutput = update.rawOutput;
  }
  if (Object.prototype.hasOwnProperty.call(update, "_meta")) {
    merged._meta = update._meta;
  }

  return merged as T;
}

type ManagedTerminal = {
  write: (data: string) => void;
  kill: () => void;
  resize: (cols: number, rows: number) => void;
  onData: (listener: (data: string) => void) => void;
  onExit: (listener: (exitCode: number | null) => void) => void;
};
const terminals = new Map<string, ManagedTerminal>();
export const clientTerminals = new Map<string, Set<string>>();
let terminalCounter = 0;
let isNodePtyHelperPrepared = false;

let sendEvent: <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => boolean = () => false;

function broadcastAndSaveSessionUpdate(sessionId: string, notification: SessionNotification) {
  const enrichedNotification: SessionNotificationFelloExt = {
    ...notification,
    update: {
      ...notification.update,
      _meta: {
        ...notification.update?._meta,
        fello: {
          receivedAt: Date.now(),
          displayId: randomUUID(),
        },
      },
    },
  };

  const sessionUpdate = enrichedNotification.update.sessionUpdate;

  // ── iLink forwarding: agent response → WeChat ─────────────────
  if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
    const userId = ilinkBridge.userId;
    if (userId) {
      if (sessionUpdate === "agent_message_chunk") {
        const content = enrichedNotification.update.content;
        if (content?.type === "text" && content.text) {
          // Buffer chunks, send only when streaming ends
          ilinkReplyBuffer += content.text;
        }
      }
    }
  }

  // ── iLink forwarding: flush buffered text before tool call ──
  // So WeChat users can see the agent's reasoning before a tool invocation.
  if (
    sessionUpdate === "tool_call" &&
    ilinkBridge?.isConnected &&
    sessionId === ilinkActiveSessionId
  ) {
    const userId = ilinkBridge.userId;
    if (userId && ilinkReplyBuffer) {
      const text = ilinkReplyBuffer;
      ilinkReplyBuffer = "";
      ilinkBridge.sendTextReply(userId, text).catch((err) => {
        console.warn("[iLink] Failed to forward pre-tool text to WeChat:", err);
      });
    }
  }

  if (sessionUpdate === "tool_call_update") {
    const update = enrichedNotification.update;
    const toolCallId = update.toolCallId;
    const key = getPendingToolCallKey(sessionId, toolCallId);
    const base = pendingToolCalls.get(key);

    if (update.status === "in_progress") {
      if (base) {
        const mergedUpdate = mergeToolCallUpdate(base, update);
        pendingToolCalls.set(key, mergedUpdate);
      } else {
        pendingToolCalls.set(key, { ...update });
      }
    } else {
      if (base) {
        enrichedNotification.update = mergeToolCallUpdate(base, update);
        pendingToolCalls.delete(key);
      }
      storageOps.appendSessionMessage(sessionId, {
        ...enrichedNotification,
        update: omit(enrichedNotification.update, ["rawInput", "rawOutput"]),
      });
    }
  } else if (
    (sessionUpdate as string) === "context_snapshot" ||
    (sessionUpdate as string) === "context_event" ||
    (sessionUpdate as string) === "context_timeline"
  ) {
    // 上下文洞察数据：不写入聊天历史，走独立 context-update 事件推送。
    // 持久化由 agent 侧单独处理（context.jsonl）。
    sendEvent("context-update", {
      sessionId,
      update: enrichedNotification.update as unknown as FelloContextUpdate,
    });
    return;
  } else {
    storageOps.appendSessionMessage(sessionId, enrichedNotification);
  }

  sendEvent("session-update", { sessionId, notification: enrichedNotification });
}

function markProjectFsDirty(projectId: string) {
  const nextVersion = (projectFsVersions.get(projectId) ?? 0) + 1;
  projectFsVersions.set(projectId, nextVersion);
  searchFileCache.delete(projectId);
}

function getProjectFsVersion(projectId: string) {
  return projectFsVersions.get(projectId) ?? 0;
}

function clearProjectSearchState(projectId: string) {
  projectFsVersions.delete(projectId);
  searchFileCache.delete(projectId);
}

async function buildSearchIndex(cwd: string): Promise<SearchFileItem[]> {
  const fileScene = new Set<string>();
  const allFiles: SearchFileItem[] = [];

  async function collect(dir: string) {
    if (fileScene.has(dir)) return;
    fileScene.add(dir);
    const entries = await readdir(dir).catch(() => []);
    for (const name of entries) {
      const full = join(dir, name);
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      if (isIgnorePath(full, cwd)) continue;
      if (fileScene.has(full)) continue;
      const rel = relative(cwd, full);
      const posixRel = toPosixPath(rel);
      allFiles.push({ id: posixRel, filename: rel, isFolder: s.isDirectory() });
      if (s.isDirectory()) await collect(full);
    }
  }

  await collect(cwd);
  return allFiles;
}

export function initBackend(
  emitter: <K extends keyof FelloIPCSchema["events"]>(
    channel: K,
    payload: FelloIPCSchema["events"][K],
  ) => boolean,
) {
  sendEvent = (channel, payload) => {
    if (channel === "fs-changed") {
      markProjectFsDirty((payload as FelloIPCSchema["events"]["fs-changed"]).projectId);
    }

    const sentWebUI = broadcastWebUIEvent(channel, payload);
    const sentNative = emitter(channel, payload);
    return sentWebUI || sentNative;
  };
  initWatcher(sendEvent);

  // Initialize automation runner and restore crons
  initRunner(sendEvent);
  restoreActiveSchedules();

  // Try to restore iLink session on startup
  getILinkBridge()
    .tryRestore()
    .then(async (restored) => {
      if (restored) {
        // Restore persisted active session
        const savedId = await readActiveSessionId();
        if (savedId && storageOps.getSession(savedId)) {
          ilinkActiveSessionId = savedId;
          sendEvent("ilink-active-session-changed", { sessionId: savedId });
        }
      }
    })
    .catch((err) => {
      console.warn("[iLink] Failed to restore session:", err);
    });
}

function resolveAgentInfo(agentId: string): AgentInfo {
  const settings = storageOps.getSettings();
  const agent = settings.agents.find((a) => a.id === agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}. Please check your settings.`);
  }
  if (agent.type === "stdio") {
    const command = agent.command.trim();
    if (!command) {
      throw new Error(`Agent "${agent.id}" has no command configured.`);
    }
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

      if (
        restoringSessions.has(sessionId) &&
        sessionUpdate !== "available_commands_update" &&
        sessionUpdate !== "usage_update"
      ) {
        return; // Block agent replay during loadSession
      }

      broadcastAndSaveSessionUpdate(sessionId, notification);
    },
    onPermissionRequest: async (request: RequestPermissionRequest) => {
      const sessionId = `${agentId}:${request.sessionId}`;
      const session = storageOps.getSession(sessionId);

      // allow-all 模式：直接自动审批，不走 askUser
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

      // 通过通用 askUser 通道向用户展示权限选项
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

      // 将通用响应转回 ACP 协议格式
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

export async function clearBackend() {
  stopAllCrons();
  for (const ss of sessionSocketServers.values()) {
    ss.stop();
  }
  sessionSocketServers.clear();
  const killPromises: Promise<void>[] = [new Promise((resolve) => setTimeout(resolve, 100))];
  for (const p of bridgePool.values()) {
    killPromises.push(p.then((b) => b.kill()).catch(() => {}));
  }
  bridgePool.clear();
  for (const terminal of terminals.values()) {
    terminal.kill();
  }
  terminals.clear();
  clientTerminals.clear();
  await Promise.all(killPromises);

  for (const file of await readdir(TEMP_DIR)) {
    await rm(join(TEMP_DIR, file), { recursive: true, force: true });
  }
}

async function resolveTerminalCwd(preferredCwd: string) {
  const candidates = [preferredCwd, process.cwd(), homedir()]
    .map((value) => value.trim())
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => null);
    if (info?.isDirectory()) return candidate;
  }
  return process.cwd();
}

function resolveShellCandidates() {
  if (process.platform === "win32") {
    return [process.env.COMSPEC?.trim() ?? "", "powershell.exe", "cmd.exe"].filter(
      (value, index, array) => value.length > 0 && array.indexOf(value) === index,
    );
  }
  return [process.env.SHELL?.trim() ?? "", "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
    (value, index, array) => value.length > 0 && array.indexOf(value) === index,
  );
}

async function ensureNodePtySpawnHelperExecutable() {
  if (process.platform === "win32") return;
  if (isNodePtyHelperPrepared) return;
  const packageJsonPath = require.resolve("node-pty/package.json");
  const packageDir = dirname(packageJsonPath);
  const helperPath = join(
    packageDir,
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  const info = await stat(helperPath).catch(() => null);
  if (!info?.isFile()) {
    throw new Error(`node-pty spawn-helper not found: ${helperPath}`);
  }
  if ((info.mode & 0o111) === 0) {
    await chmod(helperPath, 0o755);
  }
  isNodePtyHelperPrepared = true;
}

async function createTerminalProcess(cwd: string, initialSize?: { cols?: number; rows?: number }) {
  const ptyShellArgs = process.platform === "win32" ? [] : ["-i"];
  const resolvedCwd = await resolveTerminalCwd(cwd);
  const shellCandidates = resolveShellCandidates();
  let child: ManagedTerminal | null = null;
  let lastError: unknown = null;

  const createPtyTerminal = (shellPath: string) => {
    const pty = spawnPty(shellPath, ptyShellArgs, {
      cwd: resolvedCwd,
      cols: Math.max(20, Math.floor(initialSize?.cols ?? 80)),
      rows: Math.max(6, Math.floor(initialSize?.rows ?? 24)),
      name: "xterm-256color",
      env: { ...process.env, TERM: "xterm-256color" },
    });
    return {
      write: (data: string) => pty.write(data),
      kill: () => pty.kill(),
      resize: (cols: number, rows: number) => pty.resize(cols, rows),
      onData: (listener: (data: string) => void) => {
        pty.onData((data) => listener(data));
      },
      onExit: (listener: (exitCode: number | null) => void) => {
        pty.onExit(({ exitCode }) => listener(exitCode));
      },
    } satisfies ManagedTerminal;
  };

  try {
    await ensureNodePtySpawnHelperExecutable();
  } catch (error) {
    lastError = error;
  }

  for (const shellPath of shellCandidates) {
    try {
      child = createPtyTerminal(shellPath);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!child) {
    throw new Error(
      `Failed to create PTY terminal. cwd=${resolvedCwd}; ptyShells=${shellCandidates.join(", ")}; error=${String(lastError)}`,
    );
  }
  const terminalSeed = `terminal-${Date.now()}-${terminalCounter++}`;
  const terminalId = createHash("sha1").update(terminalSeed).digest("hex").slice(0, 12);
  terminals.set(terminalId, child);
  child.onData((data: string) => {
    sendEvent("terminal-output", { terminalId, data });
  });
  child.onExit((exitCode: number | null) => {
    terminals.delete(terminalId);
    for (const set of clientTerminals.values()) {
      set.delete(terminalId);
    }
    sendEvent("terminal-exit", { terminalId, exitCode });
  });
  return terminalId;
}

/**
 * 合并连续的同类型 notifications，减少前端需要处理的消息数量。
 * - 连续的 agent_message_chunk / agent_thought_chunk：合并文本块
 * - 同一 toolCallId 的 tool_call + tool_call_update：合并为一条
 */
function mergeNotifications(
  notifications: SessionNotificationFelloExt[],
): SessionNotificationFelloExt[] {
  const result: SessionNotificationFelloExt[] = [];

  for (const notification of notifications) {
    const update = notification.update;
    if (!update) {
      result.push(notification);
      continue;
    }

    const type = update.sessionUpdate;

    if (type === "agent_message_chunk" || type === "agent_thought_chunk") {
      const prev = result.length > 0 ? result[result.length - 1] : undefined;
      if (
        prev?.update?.sessionUpdate === type &&
        prev.update.content?.type === "text" &&
        update.content?.type === "text"
      ) {
        result[result.length - 1] = {
          ...prev,
          update: {
            ...prev.update,
            content: {
              ...prev.update.content,
              text: prev.update.content.text + update.content.text,
            },
          },
        };
        continue;
      }
    }

    if (type === "tool_call" || type === "tool_call_update") {
      const toolCallId = update.toolCallId;
      const idx = result.findIndex(
        (n) =>
          (n.update?.sessionUpdate === "tool_call" ||
            n.update?.sessionUpdate === "tool_call_update") &&
          (n.update as { toolCallId?: string }).toolCallId === toolCallId,
      );
      if (idx !== -1) {
        const prev = result[idx];
        result[idx] = {
          ...prev,
          update: {
            ...prev.update,
            ...update,
            sessionUpdate: "tool_call",
          },
        } as SessionNotificationFelloExt;
        continue;
      }
    }

    result.push(notification);
  }

  return result;
}

export const backendHandlers: {
  [K in keyof FelloIPCSchema["requests"]]: (
    params: FelloIPCSchema["requests"][K]["params"],
  ) => Promise<FelloIPCSchema["requests"][K]["response"]>;
} = {
  async getWebUIStatus() {
    return getWebUIStatus();
  },

  async getSkillsCatalog({ all, projectId }) {
    const projectRoot = projectId ? storageOps.getProject(projectId)?.cwd : undefined;
    return getSkillsCatalog({
      projectRoot,
      all,
    });
  },

  async readSkillFile({ skillId, projectId }) {
    try {
      return await fsReadFile(
        await this.getSkillFileSystemFilePath({ skillId, projectId }),
        "utf-8",
      );
    } catch (err: any) {
      throw new Error(`Failed to read skill: ${err.message}`);
    }
  },

  async getSkillFileSystemFilePath({ skillId, projectId }) {
    const projectRoot = projectId ? storageOps.getProject(projectId)?.cwd : undefined;
    const skillDir = getSkillSystemPathFromId(skillId, { projectRoot });
    if (!skillDir) {
      throw new Error(`Failed to read skill: ${skillId}`);
    }
    return join(skillDir, SKILL_FILENAME);
  },

  async uninstallSkill({ skillId, projectId }) {
    const projectRoot = projectId ? storageOps.getProject(projectId)?.cwd : undefined;
    const skillDir = getSkillSystemPathFromId(skillId, { projectRoot });
    if (!skillDir) {
      throw new Error(`Failed to read skill: ${skillId}`);
    }
    try {
      await rm(skillDir, { recursive: true, force: true });
    } catch (err: any) {
      throw new Error(`Failed to uninstall skill: ${err.message}`);
    }
  },

  async searchSkillsFromSkillsSh({ query }) {
    try {
      return await searchSkills(query);
    } catch (err: any) {
      throw new Error(`Failed to search skills: ${err.message}`);
    }
  },

  async installSkillFromSkillsSh({ source, slug }) {
    try {
      await installSkill(source, slug);
    } catch (err: any) {
      throw new Error(`Failed to install skill: ${err.message}`);
    }
  },

  async startWebUIServer({ port, token }) {
    const { url } = await startWebUI({ port, token });
    const status = { enabled: true, url: url };
    sendEvent("webui-status-changed", { status });
    return status;
  },

  async stopWebUIServer() {
    stopWebUI();
    const status = { enabled: false, url: null };
    sendEvent("webui-status-changed", { status });
    return status;
  },

  async getSettings() {
    return storageOps.getSettings();
  },

  async updateSettings(settings) {
    // If agent config changed, invalidate pooled bridges so next ensureBridge picks up fresh config
    const newAgents = settings.agents;
    if (newAgents) {
      const oldAgents = storageOps.getSettings().agents;
      const changed =
        oldAgents.length !== newAgents.length ||
        oldAgents.some((a, i) => JSON.stringify(a) !== JSON.stringify(newAgents[i]));
      if (changed) {
        for (const [agentId, p] of bridgePool) {
          bridgePool.delete(agentId);
          p.then((b) => b.kill()).catch(() => {});
        }
      }
    }
    storageOps.updateSettings(settings);
    if (settings.i18n?.language) {
      setLanguage(settings.i18n.language);
    }
    // Re-sync file watchers; syncWatchers() internally checks the persisted
    // fileWatcher.enabled setting and starts/stops watchers accordingly.
    await syncWatchers();
  },

  async listSessions() {
    return storageOps.listSessions();
  },

  async listProjects() {
    return storageOps.listProjects();
  },

  async addProject(cwd: string) {
    const ProjectInfo = storageOps.addProject(cwd);
    if (!projectFsVersions.has(ProjectInfo.id)) {
      projectFsVersions.set(ProjectInfo.id, 0);
    }
    await syncWatchers();
    sendEvent("projects-changed", undefined);
    return ProjectInfo;
  },

  async renameProject({ projectId, title }) {
    storageOps.updateProjectTitle(projectId, title);
    sendEvent("projects-changed", undefined);
  },

  async deleteProject(projectId: string) {
    const projectSessions = storageOps
      .listSessions()
      .filter((session) => session.projectId === projectId);
    storageOps.deleteProject(projectId);
    for (const session of projectSessions) {
      // Close the session on the agent side if still active
      try {
        const connectPromise = bridgePool.get(session.agentId);
        if (connectPromise) {
          const b = await connectPromise;
          if (b.isSessionLoaded(session.resumeId)) {
            await b.closeSession(session.resumeId);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[backend] Failed to close session on agent for ${session.agentId}:${session.resumeId}: ${message}`,
        );
      }

      try {
        deletePersistedSessionDirectory({
          agentId: session.agentId,
          sessionId: session.resumeId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[backend] Failed to delete persisted session directory for ${session.agentId}:${session.resumeId}: ${message}`,
        );
      }
    }
    clearProjectSearchState(projectId);
    await syncWatchers();
    sendEvent("projects-changed", undefined);
    sendEvent("sessions-changed", undefined);
  },

  async newSession({ projectId, agentId, mcpServers, permissionMode, features }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project does not exist");
    const b = await ensureBridge(agentId);

    const socketPath = generateSessionSocketPath(randomUUID());

    // Use the user-selected MCP servers, falling back to all non-disabled servers as default
    const sessionMcpIds =
      mcpServers ??
      (storageOps.getSettings().mcpServers || []).filter((s) => !s.disabled).map((s) => s.id);
    const effectiveFeatures: Feature[] = features ?? ALL_FEATURES;
    const activeMcpServers = buildMcpServersConfig(sessionMcpIds, {
      project,
      socketPath,
      features: effectiveFeatures,
    });

    const {
      sessionId: resumeId,
      models,
      modes,
    } = await b.newSession({
      cwd: project.cwd,
      mcpServers: activeMcpServers,
    });
    const sessionInfo = storageOps.createSession(project.id, resumeId, agentId, {
      mcpServers: sessionMcpIds,
      features: effectiveFeatures,
      permissionMode: permissionMode ?? "ask",
      models: models ?? null,
      modes: modes ?? null,
      initializeInfo: b.initializeInfo,
    });

    await createSessionSocketServer(sessionInfo.id, { socketPath, project });

    sendEvent("sessions-changed", undefined);
    return {
      sessionId: sessionInfo.id,
      initializeInfo: b.initializeInfo,
      models: models ?? null,
      modes: modes ?? null,
    };
  },

  async loadSession({ sessionId, force }: { sessionId: string; force?: boolean }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const project = storageOps.getProject(session.projectId);
    if (!project) throw new Error("Project does not exist");

    const b = await ensureBridge(session.agentId);

    // If already loaded and not forced, return cached state (e.g. page reload reconnect)
    if (b.isSessionLoaded(session.resumeId) && !force) {
      return {
        sessionId: session.id,
        initializeInfo: b.initializeInfo,
        models: b.getModelState(session.resumeId) ?? session.models,
        modes: b.getModeState(session.resumeId) ?? session.modes,
      };
    }

    // Clear stale isStreaming flag (e.g. from agent crash or interrupted generation)
    if (session.isStreaming) {
      storageOps.updateSession(sessionId, { isStreaming: false });
      session.isStreaming = false;
      sendEvent("session-changed", { session });
    }

    // Reuse existing socket server path if one is already running for this session
    const existingSocketServer = sessionSocketServers.get(session.id);
    const socketPath = existingSocketServer
      ? existingSocketServer.socketPath
      : generateSessionSocketPath(randomUUID());
    const activeMcpServers = buildMcpServersConfig(session.mcpServers, {
      project,
      socketPath,
      features: session.features,
    });

    if (b.isSessionLoaded(session.resumeId)) {
      // force reload → close and re-load with fresh config
      console.log(`[Fello] Session ${session.resumeId} force reloading...`);
      await b.closeSession(session.resumeId);
      await stopSessionSocketServer(session.id);
    }

    restoringSessions.add(session.id);
    let loadResult;
    try {
      loadResult = await b.loadSession({
        sessionId: session.resumeId,
        cwd: session.cwd,
        mcpServers: activeMcpServers,
      });
      await createSessionSocketServer(session.id, { socketPath, project });
    } finally {
      restoringSessions.delete(session.id);
    }

    // Use models/modes from loadResult if available, otherwise fall back to bridge cache or storage
    let finalModels = loadResult?.models ?? null;
    let finalModes = loadResult?.modes ?? null;

    let shouldUpdateCache = false;

    if (finalModels) {
      shouldUpdateCache = true;
    } else {
      // Try bridge cache (populated during newSession)
      const cachedModels = b.getModelState(session.resumeId);
      if (cachedModels) {
        finalModels = cachedModels;
        shouldUpdateCache = true;
      } else {
        finalModels = session.models;
      }
    }

    if (finalModes) {
      shouldUpdateCache = true;
    } else {
      // Try bridge cache (populated during newSession)
      const cachedModes = b.getModeState(session.resumeId);
      if (cachedModes) {
        finalModes = cachedModes;
        shouldUpdateCache = true;
      } else {
        finalModes = session.modes;
      }
    }

    if (shouldUpdateCache || b.initializeInfo) {
      storageOps.updateSession(
        session.id,
        {
          models: finalModels,
          modes: finalModes,
          initializeInfo: b.initializeInfo,
        },
        false,
      );
    }

    const freshSession = storageOps.getSession(session.id);
    if (freshSession) {
      sendEvent("session-changed", { session: freshSession });
    }

    return {
      sessionId: session.id,
      initializeInfo: b.initializeInfo,
      models: finalModels,
      modes: finalModes,
    };
  },

  async getSessionHistory({ sessionId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const messages = mergeNotifications(storageOps.readSessionMessages(sessionId));
    return {
      messages,
    };
  },

  async getContextTimeline({ sessionId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    try {
      const { timeline, events } = await loadContextTimeline({
        agentId: session.agentId,
        sessionId: session.resumeId,
      });
      return { timeline, events };
    } catch {
      return { timeline: [], events: [] };
    }
  },

  async sendPrompt({ sessionId, contents }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const project = storageOps.getProject(session.projectId);
    if (!project) throw new Error("Project does not exist");

    // If this session is currently streaming, cancel the previous generation first
    if (session.isStreaming) {
      console.log(
        `[Fello] Session ${sessionId} is already streaming, cancelling previous generation...`,
      );
      const connectPromise = bridgePool.get(session.agentId);
      if (connectPromise) {
        for (const [askUserId, request] of Array.from(pendingAskUserRequests.entries())) {
          if (request.sessionId === sessionId) {
            try {
              await this.respondAskUser({ sessionId, askUserId, value: null, reason: "" });
            } catch (err) {
              console.warn("[SendPrompt] Respond Previous Ask User Error", err);
            }
          }
        }
        const b = await connectPromise;
        await b.cancel({ sessionId: session.resumeId }).catch((err) => {
          console.warn(
            `[Fello] Failed to cancel previous generation for session ${sessionId}: ${err}`,
          );
        });
        // 同时结束之前 generation 启动的 agent 终端
        const killed = b.terminalManager.killBySession(session.resumeId);
        if (killed > 0) {
          console.log(
            `[SendPrompt] Killed ${killed} agent terminal(s) from previous generation for session ${sessionId}`,
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    // Fallback: If it's a new chat, simulate an agent title update
    if (!session.title) {
      const firstTextContent = contents.find((c) => c.type === "text");
      if (firstTextContent && firstTextContent.type === "text" && firstTextContent.text) {
        let fallbackTitle = firstTextContent.text.trim().split("\n")[0].substring(0, 30);
        if (firstTextContent.text.length > 30) fallbackTitle += "...";
        storageOps.updateSession(sessionId, { title: fallbackTitle });
        // We emit session-changed below after touchSession anyway
      }
    }

    const b = await ensureBridge(session.agentId);

    if (!b.isSessionLoaded(session.resumeId)) {
      console.log(`[Fello] Session ${session.resumeId} not loaded in Agent, lazy loading...`);
      const socketPath = generateSessionSocketPath(randomUUID());
      const activeMcpServers = buildMcpServersConfig(session.mcpServers, {
        project,
        socketPath,
        features: session.features,
      });
      await b.loadSession({
        sessionId: session.resumeId,
        cwd: session.cwd,
        mcpServers: activeMcpServers,
      });
      await createSessionSocketServer(session.id, { socketPath, project });
    }

    storageOps.updateSession(sessionId, { isStreaming: true });
    const updated = storageOps.getSession(sessionId);
    if (updated) sendEvent("session-changed", { session: updated });
    sendEvent("prompt-start", { sessionId });
    if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
      const userId = ilinkBridge.userId;
      if (userId) {
        ilinkBridge.sendTyping(userId, true).catch(() => {});
      }
    }

    // Broadcast user message to clients
    for (const content of contents) {
      const notification: SessionNotification = {
        sessionId: session.resumeId,
        update: {
          sessionUpdate: "user_message_chunk",
          content: content,
        },
      };
      broadcastAndSaveSessionUpdate(session.id, notification);
    }

    let promptResponse: PromptResponse | undefined;
    let promptError: string | undefined;
    try {
      promptResponse = await b.sendPrompt({
        sessionId: session.resumeId,
        prompt: contents,
      });
      return promptResponse;
    } catch (err) {
      promptError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      sendEvent("prompt-end", {
        sessionId,
        stopReason: promptResponse?.stopReason,
        error: promptError,
      });
      storageOps.updateSession(sessionId, { isStreaming: false });
      const updated = storageOps.getSession(sessionId);
      if (updated) sendEvent("session-changed", { session: updated });
      if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
        const userId = ilinkBridge.userId;
        if (userId) {
          const bridge = ilinkBridge;
          bridge.sendTyping(userId, false).catch(() => {});
          // Flush buffered reply synchronously, then send notification
          const bufferedText = ilinkReplyBuffer;
          ilinkReplyBuffer = "";
          const flushPromise = bufferedText
            ? bridge.sendTextReply(userId, bufferedText).catch((err) => {
                console.warn("[iLink] Failed to forward reply to WeChat:", err);
              })
            : Promise.resolve();
          // Notify iLink user of errors or non-end_turn completion (after flush)
          if (promptError) {
            flushPromise.then(() =>
              bridge
                .sendTextReply(userId, t("ilink.promptError", { error: promptError }))
                .catch(() => {}),
            );
          } else if (promptResponse?.stopReason && promptResponse.stopReason !== "end_turn") {
            const stopReasonLabels: Record<string, string> = {
              max_tokens: t("ilink.promptMaxTokens"),
              max_turn_requests: t("ilink.promptMaxTurnRequests"),
              refusal: t("ilink.promptRefusal"),
              cancelled: t("ilink.promptCancelled"),
            };
            const label = stopReasonLabels[promptResponse.stopReason] || promptResponse.stopReason;
            flushPromise.then(() => bridge.sendTextReply(userId, label).catch(() => {}));
          }
        }
      }
    }
  },

  async cancelPrompt({ sessionId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) return;
    for (const [askUserId, request] of Array.from(pendingAskUserRequests.entries())) {
      if (request.sessionId === sessionId) {
        try {
          await this.respondAskUser({ sessionId, askUserId, value: null, reason: "" });
        } catch (err) {
          console.warn("[CancelPrompt] Respond Previous Ask User Error", err);
        }
      }
    }
    const connectPromise = bridgePool.get(session.agentId);
    if (connectPromise) {
      const b = await connectPromise;
      await b.cancel({ sessionId: session.resumeId });
      // 同时结束该 session 所有 agent 启动的终端进程（SIGTERM）
      const killed = b.terminalManager.killBySession(session.resumeId);
      if (killed > 0) {
        console.log(`[CancelPrompt] Killed ${killed} agent terminal(s) for session ${sessionId}`);
      }
    }
  },

  async getPendingAskUserRequests({ sessionId }) {
    const result: AskUserRequest[] = [];
    for (const pending of pendingAskUserRequests.values()) {
      if (pending.sessionId === sessionId) {
        result.push(pending.request);
      }
    }
    return result;
  },

  async respondAskUser({ sessionId, askUserId, value, reason }) {
    const pending = pendingAskUserRequests.get(askUserId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pending.resolve({ value, reason: reason ?? null });
      pendingAskUserRequests.delete(askUserId);
      sendEvent("ask-user-response", {
        sessionId,
        askUserId,
        value,
        reason: reason ?? null,
      });
    } else {
      console.warn(`[askUser] respond fired but no pending request found for ${askUserId}`);
    }
  },

  async updateSession({ sessionId, ...updates }) {
    storageOps.updateSession(sessionId, updates);
    const session = storageOps.getSession(sessionId);
    if (session) sendEvent("session-changed", { session });
  },

  async changeWorkDir() {
    return { ok: false, cwd: null };
  },

  async deleteSession(sessionId: string) {
    const session = storageOps.getSession(sessionId);

    // Close the session on the agent side if it's still active
    if (session) {
      try {
        const connectPromise = bridgePool.get(session.agentId);
        if (connectPromise) {
          const b = await connectPromise;
          if (b.isSessionLoaded(session.resumeId)) {
            await b.closeSession(session.resumeId);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[backend] Failed to close session on agent for ${session.agentId}:${session.resumeId}: ${message}`,
        );
      }
    }

    storageOps.deleteSession(sessionId);

    stopSessionSocketServer(sessionId);

    if (ilinkActiveSessionId === sessionId) {
      ilinkActiveSessionId = null;
      ilinkReplyBuffer = "";
      try {
        await writeActiveSessionId(null);
      } catch (error) {
        console.warn("[iLink] Failed to clear persisted active session:", error);
      }
      sendEvent("ilink-active-session-changed", { sessionId: null });
    }
    if (session) {
      try {
        deletePersistedSessionDirectory({
          agentId: session.agentId,
          sessionId: session.resumeId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[backend] Failed to delete persisted session directory for ${session.agentId}:${session.resumeId}: ${message}`,
        );
      }
    }
    sendEvent("sessions-changed", undefined);
  },

  async getSystemFilePath({ projectId, path: inputPath, isAbsolute }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");

    if (isAbsolute) {
      return resolveSafePath(project.cwd, inputPath);
    }
    return relative(project.cwd, resolveSafePath(project.cwd, inputPath));
  },

  async copyFileToWorkspace({ projectId, sourcePath, destDir }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const cwd = destDir || project.cwd;

    const fileName = basename(sourcePath);
    let destPath = join(cwd, fileName);
    let counter = 1;

    while (true) {
      const info = await stat(destPath).catch(() => null);
      if (!info) break;
      const ext = extname(fileName);
      const name = basename(fileName, ext);
      destPath = join(cwd, `${name}(${counter})${ext}`);
      counter++;
    }

    await copyFile(sourcePath, destPath);
    markProjectFsDirty(projectId);
    return { success: true, destPath: toPosixPath(relative(cwd, destPath)) };
  },

  async readUrlAsDataUrl({ url: inputUrl, mimeType }) {
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB limit

    // 如果是 http(s)，我们可以在这里通过 fetch 下载，但这部分也可以由前端直接加载
    // 为了满足“读取URL为DataUrl”的能力，这里也支持对 http 资源的获取
    if (inputUrl.startsWith("http://") || inputUrl.startsWith("https://")) {
      try {
        const res = await fetch(inputUrl, { method: "HEAD" });
        if (res.ok) {
          const contentLength = res.headers.get("content-length");
          if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
            throw new Error(`File is too large (exceeds 20MB)`);
          }
        }
      } catch (err) {
        // 忽略 HEAD 请求的失败（如 405 Method Not Allowed 或 CORS 问题）
        // 我们会继续尝试通过 GET 请求下载，并在拿到数据时进行大小校验
        if (err instanceof Error && err.message.includes("exceeds 20MB")) {
          throw err;
        }
      }

      const getRes = await fetch(inputUrl);
      if (!getRes.ok) throw new Error(`Failed to fetch URL: ${getRes.statusText}`);

      const arrayBuffer = await getRes.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
        throw new Error(`File is too large (exceeds 20MB)`);
      }

      const buffer = Buffer.from(arrayBuffer);
      const data = buffer.toString("base64");
      const mime = mimeType || getRes.headers.get("content-type") || "application/octet-stream";
      return `data:${mime};base64,${data}`;
    }

    let inputPath = "";
    if (inputUrl.startsWith("file://")) {
      inputPath = decodeURIComponent(inputUrl.slice(7));
    } else {
      throw new Error(`Unsupported protocol or path format: ${inputUrl}`);
    }

    // 因为我们要求 uri 必须是 file:// 协议（绝对路径），所以不再依赖 project.cwd
    // 直接读取本地系统路径即可
    const safePath = inputPath;

    const fileStat = await stat(safePath);
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(`File is too large (exceeds 20MB)`);
    }

    const data = await fsReadFile(safePath, "base64");

    let mime = mimeType;
    if (!mime) {
      mime = mimeTypes.lookup(safePath) || "application/octet-stream";
    }

    return `data:${mime};base64,${data}`;
  },

  async getModels({ sessionId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) return null;
    const connectPromise = bridgePool.get(session.agentId);
    if (!connectPromise) return null;
    const b = await connectPromise;
    return b.getModelState(session.resumeId);
  },

  async setModel({ sessionId, modelId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const connectPromise = bridgePool.get(session.agentId);
    if (!connectPromise) throw new Error("Agent bridge not found for session");
    const b = await connectPromise;
    await b.setSessionModel({ sessionId: session.resumeId, modelId });

    // Update local cache
    if (session.models) {
      session.models.currentModelId = modelId;
      storageOps.updateSession(session.id, { models: session.models });
      const updated = storageOps.getSession(session.id);
      if (updated) sendEvent("session-changed", { session: updated });
    }
  },

  async getModes({ sessionId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) return null;
    const connectPromise = bridgePool.get(session.agentId);
    if (!connectPromise) return null;
    const b = await connectPromise;
    return b.getModeState(session.resumeId);
  },

  async setMode({ sessionId, modeId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const connectPromise = bridgePool.get(session.agentId);
    if (!connectPromise) throw new Error("Agent bridge not found for session");
    const b = await connectPromise;
    await b.setSessionMode({ sessionId: session.resumeId, modeId });

    // Update local cache
    if (session.modes) {
      session.modes.currentModeId = modeId;
      storageOps.updateSession(session.id, { modes: session.modes });
      const updated = storageOps.getSession(session.id);
      if (updated) sendEvent("session-changed", { session: updated });
    }
  },

  async searchFiles({ projectId, query }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const cwd = project.cwd;

    const fileScene = new Set<string>();

    if (!query || query.trim() === "") {
      const entries = await readdir(cwd).catch(() => []);
      const results: Array<{ id: string; filename: string; isFolder: boolean }> = [];
      for (const name of entries) {
        const full = join(cwd, name);
        if (isIgnorePath(full, cwd)) continue;

        if (fileScene.has(full)) continue;
        fileScene.add(full);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        const rel = relative(cwd, full);
        results.push({ id: toPosixPath(rel), filename: rel, isFolder: s.isDirectory() });
        if (results.length >= SEARCH_MAX_RESULTS) break;
      }
      results.sort((a, b) => a.filename.localeCompare(b.filename));
      return results;
    }

    const normalizedQuery = toPosixPath(query);
    const currentVersion = getProjectFsVersion(projectId);
    const cached = searchFileCache.get(projectId);
    let entry: SearchFileCacheEntry;
    if (
      cached &&
      cached.version === currentVersion &&
      Date.now() - cached.builtAt <= SEARCH_CACHE_TTL_MS
    ) {
      entry = cached;
    } else {
      const files = await buildSearchIndex(cwd);
      entry = {
        version: currentVersion,
        builtAt: Date.now(),
        files,
        fuse: new Fuse(files, {
          keys: ["filename"],
          threshold: SEARCH_FUSE_THRESHOLD,
        }),
      };
      searchFileCache.set(projectId, entry);
    }

    return entry.fuse
      .search(normalizedQuery, { limit: SEARCH_MAX_RESULTS })
      .map((result) => result.item);
  },

  async readDir({ projectId, relativePath = "" }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const cwd = project.cwd;

    const startPath = resolveSafePath(cwd, relativePath);

    const entries = await readdir(startPath).catch(() => []);
    const results: { id: string; name: string; isFolder: boolean }[] = [];
    for (const name of entries) {
      const full = join(startPath, name);
      const s = await stat(full).catch(() => null);
      if (!s) continue;

      if (isIgnorePath(full, cwd)) continue;

      const relId = toPosixPath(relative(cwd, full));
      if (s.isDirectory()) {
        results.push({ id: relId, name, isFolder: true });
      } else {
        results.push({ id: relId, name, isFolder: false });
      }
    }

    results.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  },

  async createFile({ projectId, relativePath, isFolder }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);

    if (isFolder) {
      await mkdir(targetPath, { recursive: true });
    } else {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, "");
    }
    markProjectFsDirty(projectId);
  },

  async deleteFile({ projectId, relativePath }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);
    await rm(targetPath, { recursive: true, force: true });
    markProjectFsDirty(projectId);
  },

  async getPlatform() {
    return process.platform;
  },

  async renameFile({ projectId, oldRelativePath, newRelativePath }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const oldPath = resolveSafePath(project.cwd, oldRelativePath);
    const newPath = resolveSafePath(project.cwd, newRelativePath);
    await rename(oldPath, newPath);
    markProjectFsDirty(projectId);
  },

  async moveFile({ projectId, oldRelativePath, newRelativePath }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const oldPath = resolveSafePath(project.cwd, oldRelativePath);
    const newPath = resolveSafePath(project.cwd, newRelativePath);
    await rename(oldPath, newPath);
    markProjectFsDirty(projectId);
  },

  async readFile({ projectId, relativePath, encoding }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);
    return fsReadFile(targetPath, encoding ?? "utf8");
  },

  async getFileInfo({ projectId, relativePath }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);

    try {
      const s = await stat(targetPath);
      let isBinary = false;
      if (s.isFile() && s.size > 0) {
        const fd = await open(targetPath, "r");
        try {
          const buffer = Buffer.alloc(512);
          const { bytesRead } = await fd.read(buffer, 0, 512, 0);
          for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) {
              isBinary = true;
              break;
            }
          }
        } finally {
          await fd.close();
        }
      }
      return { size: s.size, isFile: s.isFile(), isBinary };
    } catch {
      return null;
    }
  },

  async writeExternalFile({ projectId, fileName, base64, destRelativeDir }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const destDir = resolveSafePath(project.cwd, destRelativeDir || "");

    const ext = extname(fileName);
    const base = basename(fileName, ext);
    let counter = 0;
    let currentDest = join(destDir, fileName);

    while (true) {
      const existing = await stat(currentDest).catch(() => null);
      if (!existing) break; // Path is free

      if (counter === 0 && existing.isDirectory()) {
        throw new Error("Cannot overwrite a folder with a file");
      }

      counter++;
      currentDest = join(destDir, `${base}(${counter})${ext}`);
    }

    const buffer = Buffer.from(base64, "base64");
    await mkdir(destDir, { recursive: true });
    await writeFile(currentDest, buffer);
    markProjectFsDirty(projectId);
  },

  async registerClient({ clientId }) {
    if (!clientTerminals.has(clientId)) {
      clientTerminals.set(clientId, new Set());
    }
  },

  async createTerminal({ projectId, cwd, cols, rows, clientId }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetCwd = cwd ? resolveSafePath(project.cwd, cwd) : project.cwd;

    const terminalId = await createTerminalProcess(targetCwd, { cols, rows });
    if (clientId) {
      let set = clientTerminals.get(clientId);
      if (!set) {
        set = new Set();
        clientTerminals.set(clientId, set);
      }
      set.add(terminalId);
    }
    return { terminalId };
  },

  async writeTerminal({ terminalId, data }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return { ok: false };
    terminal.write(data);
    return { ok: true };
  },

  async killTerminalsByClient({ clientId }) {
    const termIds = clientTerminals.get(clientId);
    const terminalIds = termIds ? [...termIds] : [];
    for (const tid of terminalIds) {
      const terminal = terminals.get(tid);
      if (terminal) {
        terminal.kill();
        terminals.delete(tid);
      }
    }
    clientTerminals.delete(clientId);
    return { terminalIds };
  },

  async killTerminal({ terminalId }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return {};
    terminal.kill();
    terminals.delete(terminalId);
    for (const set of clientTerminals.values()) {
      set.delete(terminalId);
    }
    return { terminalId };
  },

  async resizeTerminal({ terminalId, cols, rows }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return { ok: false };
    terminal.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    return { ok: true };
  },

  async getAgentTerminalOutput({ sessionId, terminalId }) {
    for (const connectPromise of bridgePool.values()) {
      try {
        const b = await connectPromise;
        const output = b.terminalManager.getOutput(terminalId);
        if (output?.output) return output.output;
      } catch {
        continue;
      }
    }
    return storageOps.readTerminalOutput(sessionId, terminalId) || "";
  },

  async getGitStatus({ projectId, cwd }) {
    try {
      const project = storageOps.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const targetCwd = cwd ? resolveSafePath(project.cwd, cwd) : project.cwd;

      const { stdout } = await execFileAsync("git", ["status", "--porcelain", "-b", "-z"], {
        cwd: targetCwd,
        timeout: 2000,
      });
      const lines = stdout.split("\0").filter(Boolean);
      if (lines.length === 0) return null;
      let branchLine = lines[0];
      let branch = "";
      if (branchLine.startsWith("## ")) {
        branchLine = branchLine.slice(3);
        if (branchLine.startsWith("No commits yet on ")) {
          branch = branchLine.slice("No commits yet on ".length);
        } else if (branchLine.startsWith("HEAD (no branch)")) {
          branch = "HEAD";
        } else {
          branch = branchLine.split("...")[0];
        }
      }
      const files: Record<string, string> = {};
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const status = line.slice(0, 2);
        if (line.length < 4) continue;
        let path = line.slice(3);
        if ((status.includes("R") || status.includes("C")) && i + 1 < lines.length) {
          path = lines[i + 1];
          i++;
        }
        files[toPosixPath(path)] = status;
      }
      return { branch, files };
    } catch {
      return null;
    }
  },

  async readGitHeadFile({ projectId, relativePath, encoding }) {
    try {
      const project = storageOps.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const targetPath = resolveSafePath(project.cwd, relativePath);

      const cwd = dirname(targetPath);
      const relPath = relative(cwd, targetPath);
      const { stdout } = await execFileAsync("git", ["show", `HEAD:./${relPath}`], {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        encoding: encoding ?? "utf8",
      });
      return stdout;
    } catch {
      return "";
    }
  },

  // ── iLink Handlers ────────────────────────────────────────────

  async getIlinkStatus() {
    const bridge = ilinkBridge;
    if (!bridge) return { connected: false };
    const status = bridge.status;
    // If bridge status shows disconnected but tryRestore() may still be in progress,
    // do an immediate re-check by trying to restore again.
    if (!status.connected) {
      try {
        const restored = await bridge.tryRestore();
        if (restored) return bridge.status;
      } catch {}
    }
    return status;
  },

  async startIlinkLogin() {
    const bridge = getILinkBridge();
    return bridge.startLogin();
  },

  async pollIlinkQrcode({ qrcode }) {
    const bridge = getILinkBridge();
    const status = await bridge.checkQrcodeStatus(qrcode);
    return { status };
  },

  async stopIlink() {
    if (ilinkBridge) {
      await ilinkBridge.stop();
      ilinkBridge = null;
    }
    ilinkActiveSessionId = null;
    ilinkReplyBuffer = "";
    await writeActiveSessionId(null);
    sendEvent("ilink-active-session-changed", { sessionId: null });
  },

  async setActiveIlinkSession({ sessionId }) {
    if (!sessionId) {
      // Clear active session
      ilinkActiveSessionId = null;
      ilinkReplyBuffer = "";
      await writeActiveSessionId(null);
      sendEvent("ilink-active-session-changed", { sessionId: null });
      return;
    }
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    ilinkActiveSessionId = sessionId;
    ilinkReplyBuffer = "";
    await writeActiveSessionId(sessionId);
    sendEvent("ilink-active-session-changed", { sessionId });
  },

  async getActiveIlinkSession() {
    if (ilinkActiveSessionId) {
      return { sessionId: ilinkActiveSessionId };
    }
    // tryRestore() may not have completed yet — read persisted file directly as fallback
    try {
      const savedId = await readActiveSessionId();
      if (savedId && storageOps.getSession(savedId)) {
        ilinkActiveSessionId = savedId;
        return { sessionId: savedId };
      }
    } catch {}
    return { sessionId: null };
  },

  // ── Automation Handlers ───────────────────────────────────────────

  async listSchedules() {
    return autoStore.listSchedules().map((s) => ({ ...s, nextRunAt: getNextRun(s) }));
  },

  async getServerTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  },

  async createSchedule(params) {
    const scheduleId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const schedule: Schedule = {
      id: scheduleId,
      name: params.name,
      agentId: params.agentId,
      prompt: params.prompt,
      cron: { type: params.cron.type, expr: params.cron.expr },
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      features: (params.features ?? []).filter((f) => f !== "ask_user"),
      mcpServers: params.mcpServers ?? [],
    };
    autoStore.saveSchedule(schedule);

    // Schedule if cron
    if (schedule.cron.type === "cron" && schedule.cron.expr) {
      scheduleCron(schedule);
    }

    sendEvent("schedules-changed", undefined);
    return schedule;
  },

  async updateSchedule({ scheduleId, updates }) {
    const schedule = autoStore.getSchedule(scheduleId);
    if (!schedule) throw new Error("Schedule not found");

    Object.assign(schedule, updates);
    schedule.updatedAt = Date.now();
    autoStore.saveSchedule(schedule);

    // Re-schedule if cron config changed
    if (schedule.cron.type === "cron" && schedule.cron.expr) {
      scheduleCron(schedule);
    } else {
      unscheduleCron(scheduleId);
    }

    sendEvent("schedules-changed", undefined);
    return schedule;
  },

  async deleteSchedule({ scheduleId }) {
    unscheduleCron(scheduleId);
    autoStore.deleteSchedule(scheduleId);
    sendEvent("schedules-changed", undefined);
  },

  async triggerSchedule({ scheduleId }) {
    return executeTask(scheduleId);
  },

  async getTasks({ scheduleId }) {
    return autoStore.listTasks(scheduleId);
  },

  async getTaskFiles({ scheduleId, taskId }) {
    return autoStore.listTaskFiles(scheduleId, taskId);
  },

  async readTaskFile({ scheduleId, taskId, filePath, encoding }) {
    return autoStore.readTaskFile(scheduleId, taskId, filePath, encoding);
  },

  async getTaskFileSystemPath({ scheduleId, taskId, filePath }) {
    const base = autoStore.taskDir(scheduleId, taskId);
    const fullPath = join(base, filePath);
    if (!fullPath.startsWith(base + "/") && fullPath !== base) throw new Error("Invalid file path");
    return fullPath;
  },

  async deleteTask({ scheduleId, taskId }) {
    autoStore.deleteTask(scheduleId, taskId);
  },
};

export { type FelloIPCSchema };
