import { existsSync, statfsSync } from "fs";
import { readdir, rm, readFile } from "fs/promises";
import { join } from "path";
import type { ElectronDiagnostics, FelloIPCSchema, Schedule } from "../shared/schema";
import type { BackendContext, SendEventFn, EventListener, BackendHandlers } from "./types";
import { FELLO_DIR, storageOps, TEMP_DIR } from "./storage";
import {
  DEFAULT_DATA_ROOT,
  FELLO_RC_PATH,
  getDataRootInfo,
  setDataRoot as applyDataRoot,
} from "./config/config";
import { samePath } from "./utils";
import { setLanguage } from "./i18n";
import {
  deleteAgentPersistedStorage,
  deleteOrphanedAgentSessionDirectories,
} from "../agents/storage";

// ── Module factories ─────────────────────────────────────────────────

import { createWebUIModule } from "./webui";
import { createTunnelModule } from "./tunnel";
import { createWatcherModule } from "./watcher";
import { createSkillsModule, SKILL_FILENAME } from "./skills";
import { createSearchModule, glob, grep } from "./search";
import { createAskUserModule } from "./ask-user";
import { createShareToUserModule } from "./share-to-user";
import { createBridgeConnectModule } from "./bridge-connect";
import { createTerminalModule } from "./terminal";
import { createProjectModule } from "./project";
import { createSessionModule } from "./session";
import { createIlinkModule } from "./ilink";
import { createInferenceModule } from "./inference";
import { createAutomationModule } from "./automation";
import { createMemoryModule } from "./memory";
import { createImageGenerationModule } from "./image-generation";
import { createToolboxModule } from "./toolbox";
import { listAgentModels as loadAgentModels } from "./agent/model-catalog";
import { createAsrManager } from "./speech/asr-manager";
import { createTtsManager } from "./speech/tts-manager";
import { createAssistantManager } from "./assistant";
import { assistantPaths } from "../assistant/config";
import { assistantProtectedRoots } from "../assistant/fs/path";
import { taskProjectId } from "../shared/task-project";

// ── Init ─────────────────────────────────────────────────────────────

export function initBackend(
  emitter: <K extends keyof FelloIPCSchema["events"]>(
    channel: K,
    payload: FelloIPCSchema["events"][K],
  ) => boolean,
  /** Host capabilities that only the desktop app can provide. */
  native?: {
    trashItem?: (path: string) => Promise<void>;
    /** Runtime info that only Electron can report; omitted by the headless server. */
    diagnostics?: () => ElectronDiagnostics;
  },
) {
  // ── Event bus ──
  const listeners: EventListener[] = [];

  // WebUI must be created before sendEvent (sendEvent broadcasts to WebUI clients)
  const webui = createWebUIModule();

  const sendEvent: SendEventFn = (channel, payload) => {
    for (const listener of listeners) listener(channel, payload);
    const sentWebUI = webui.broadcastEvent(channel, payload);
    const sentNative = emitter(channel, payload);
    return sentWebUI || sentNative;
  };

  // 公网隧道（devtunnel / ngrok）：把 WebUI 端口暴露到公网，状态通过事件同步给设置页。
  const tunnel = createTunnelModule({
    onChange: (status) => sendEvent("tunnel-status-changed", { status }),
  });

  const onEvent = (listener: EventListener) => {
    listeners.push(listener);
  };

  const ctx: BackendContext = { sendEvent, onEvent, storage: storageOps };

  // ── Layer 0: ilink (provides state for ask-user, share-to-user, session) ──
  const ilink = createIlinkModule(ctx);

  // ── Layer 1: basic modules ──
  const askUser = createAskUserModule(ctx, { ilink: ilink.state });
  const shareToUser = createShareToUserModule(ctx, { ilink: ilink.state });
  const skills = createSkillsModule(ctx);
  const search = createSearchModule(ctx);
  const watcher = createWatcherModule(ctx);
  const toolbox = createToolboxModule(ctx);

  // ── Layer 2: bridge connect (needs askUser) ──
  const bridgeConnect = createBridgeConnectModule(ctx, { askUser });

  // ── Layer 3: inference + memory (inference standalone, memory needs inference) ──
  const _inference = createInferenceModule(ctx, { skills, search, toolbox });
  const memory = createMemoryModule(ctx, { inference: _inference });
  const imageGeneration = createImageGenerationModule(ctx, { ilink: ilink.state });
  const asr = createAsrManager(ctx);
  const tts = createTtsManager(ctx);

  // ── Layer 4: assistant + session, project, terminal ──
  // Assistants are pseudo sessions; session I/O dispatches to them by id, so they must exist first.
  const assistant = createAssistantManager(ctx, {
    askUser,
    filesystem: {
      grep,
      glob,
      trashItem: native?.trashItem,
      // 受保护目录在这里算一次：数据根只有宿主知道，assistant 侧不再 import backend。
      protectedWriteRoots: assistantProtectedRoots(FELLO_DIR),
    },
    mcpDeps: { skills, askUser, shareToUser, search, memory, imageGeneration, toolbox },
    ilink: ilink.state,
  });
  const session = createSessionModule(ctx, {
    bridgeConnect,
    askUser,
    shareToUser,
    skills,
    search,
    memory,
    imageGeneration,
    toolbox,
    ilink: ilink.state,
    assistant,
  });
  const project = createProjectModule(ctx, { session, watcher });
  const terminal = createTerminalModule(ctx, { bridges: bridgeConnect.bridges });

  // ── Late bindings (resolve circular deps) ──
  ilink.setHandlers({
    sendPrompt: session.sendPrompt,
    cancelPrompt: session.cancelPrompt,
    newSession: session.newSession,
    getModels: session.getModels,
    setModel: session.setModel,
    updateSession: session.updateSession,
    loadSession: session.loadSession,
    isSessionStreaming: session.isSessionStreaming,
    respondAskUser: askUser.respondAskUser,
    getPendingAskUserRequests: askUser.getPendingAskUserRequests,
    isAssistantSession: assistant.isAssistantSession,
    listAssistants: assistant.listConfigs,
    getAssistantStatus: assistant.getStatus,
  });

  // ── Layer 5: automation + personal assistant lifecycle ──
  const automation = createAutomationModule(ctx, { inference: _inference });
  assistant.startAll().catch((err) => {
    console.warn("[assistant] Failed to start:", err);
  });

  // Try to restore iLink connection on startup
  ilink.tryRestore().catch((err) => {
    console.warn("[iLink] Failed to restore session:", err);
  });

  // ── Assemble backendHandlers ───────────────────────────────────────
  const backendHandlers: BackendHandlers = {
    // WebUI
    async getWebUIStatus() {
      return webui.getStatus();
    },
    async startWebUIServer({ port, token }: { port?: number; token?: string }) {
      const { url } = await webui.start({ port, token });
      const status = { enabled: true, url };
      sendEvent("webui-status-changed", { status });
      return status;
    },
    async stopWebUIServer() {
      // WebUI 关闭后隧道失去转发目标，必须一起停掉（并删除本次创建的隧道）。
      await tunnel.stopAll();
      webui.stop();
      const status = { enabled: false, url: null };
      sendEvent("webui-status-changed", { status });
      return status;
    },

    // Public tunnel (devtunnel / ngrok)：每个提供方独立，可同时开启。
    async getTunnelStatus(params) {
      return { providers: await tunnel.getProviderInfos({ refresh: params?.refresh }) };
    },
    async startTunnel({ provider }) {
      const access = webui.getAccessInfo();
      if (!access.enabled || access.port === null) {
        throw new Error("WebUI is not running. Start the WebUI service before opening a tunnel.");
      }
      return tunnel.start({ provider, port: access.port, token: access.token });
    },
    async stopTunnel({ provider }) {
      return tunnel.stop(provider);
    },

    // Settings
    async getSettings() {
      return storageOps.getSettings();
    },
    async updateSettings(settings: Parameters<typeof storageOps.updateSettings>[0]) {
      const previousSettings = storageOps.getSettings();
      const newAgents = settings.agents;
      const changedOrRemoved = new Set<string>();
      if (newAgents) {
        const oldAgents = previousSettings.agents;
        const oldMap = new Map(oldAgents.map((a) => [a.id, a]));
        const newMap = new Map(newAgents.map((a) => [a.id, a]));

        for (const [id, oldCfg] of oldMap) {
          if (!newMap.has(id)) {
            changedOrRemoved.add(id);
          } else {
            const newCfg = newMap.get(id)!;
            if (JSON.stringify(oldCfg) !== JSON.stringify(newCfg)) changedOrRemoved.add(id);
          }
        }

        if (changedOrRemoved.size > 0) {
          for (const agentId of changedOrRemoved) {
            const isRemoved = !newMap.has(agentId);
            if (isRemoved) {
              await session.deleteAgentSessions(agentId).catch((err) => {
                console.warn(`[backend] Failed to delete sessions for agent ${agentId}:`, err);
              });
              if (oldMap.get(agentId)?.type === "api") {
                try {
                  deleteAgentPersistedStorage(agentId);
                } catch (err) {
                  console.warn(
                    `[backend] Failed to delete persisted storage for agent ${agentId}:`,
                    err,
                  );
                }
              }
            } else {
              await session.resetAgentSessions(agentId).catch((err) => {
                console.warn(`[backend] Failed to reset sessions for agent ${agentId}:`, err);
              });
              if (oldMap.get(agentId)?.type === "api") {
                const knownResumeIds = new Set(
                  storageOps
                    .listSessions()
                    .filter((s) => s.agentId === agentId)
                    .map((s) => s.resumeId),
                );
                deleteOrphanedAgentSessionDirectories(agentId, knownResumeIds);
              }
            }
            await bridgeConnect.killBridgesByAgent(agentId);
          }
        }
      }
      storageOps.updateSettings(settings);
      const currentSettings = storageOps.getSettings();
      await assistant.applySettingsChange(previousSettings, currentSettings);
      if (!currentSettings.assistant.enabled) {
        const active = ilink.state.getActiveSessionId();
        if (active && assistant.isAssistantSession(active)) {
          await ilink.setActiveIlinkSession({ sessionId: null });
        }
      }
      if (settings.i18n?.language) setLanguage(settings.i18n.language);
      await watcher.syncWatchers();
    },

    // Data root: read is open to every transport; the write handler below
    // rejects anything that did not come from the desktop renderer over IPC.
    async getDataRoot() {
      const info = getDataRootInfo();
      return {
        current: FELLO_DIR,
        configured: info.configured,
        source: info.source,
        defaultPath: DEFAULT_DATA_ROOT,
        rcPath: FELLO_RC_PATH,
        rcExists: existsSync(FELLO_RC_PATH),
        // A problem means the configured value cannot be used at all; the UI
        // shows it separately, so only report a pending change when it is usable.
        restartRequired: info.problem === null && !samePath(info.dir, FELLO_DIR),
        problem: info.problem,
      };
    },

    async setDataRoot(params, ctx) {
      // 数据根只允许桌面端修改：webui / internal 来源都会被拒绝。
      if (ctx.transport !== "ipc") {
        throw new Error("Changing the data root is only allowed in the desktop app.");
      }
      // 先守卫再读参数：params 来自 IPC，不能假设一定是 { target }。
      if (!params || (params.target !== null && typeof params.target !== "string")) {
        throw new Error("Invalid data root target.");
      }
      return applyDataRoot(params.target, FELLO_DIR);
    },

    // Runtime diagnostics (read-only, for the Advanced settings page)
    async getDiagnostics() {
      const electron = native?.diagnostics?.() ?? null;

      let freeSpaceBytes: number | null = null;
      try {
        const fsStats = statfsSync(FELLO_DIR);
        freeSpaceBytes = fsStats.bavail * fsStats.bsize;
      } catch {
        freeSpaceBytes = null;
      }

      return {
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        electronVersion: electron?.electronVersion ?? null,
        chromeVersion: electron?.chromeVersion ?? null,
        packaged: electron?.packaged ?? null,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryBytes: electron?.memoryBytes ?? process.memoryUsage().rss,
        memoryScope: electron ? ("app" as const) : ("process" as const),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        freeSpaceBytes,
        crashLogPath: electron?.crashLogPath ?? null,
        crashLogExists: electron?.crashLogExists ?? false,
      };
    },

    // Skills
    async getSkillsCatalog({ all, projectId }: { all?: boolean; projectId?: string }) {
      return skills.getSkillsCatalog({
        projectRoot: projectId ? storageOps.getProject(projectId)?.cwd : undefined,
        all,
      });
    },
    async readSkillFile({ skillId, projectId }: { skillId: string; projectId?: string }) {
      return readFile(
        await backendHandlers.getSkillFileSystemFilePath({ skillId, projectId }, { transport: "internal" }),
        "utf-8",
      );
    },
    async getSkillFileSystemFilePath({
      skillId,
      projectId,
    }: {
      skillId: string;
      projectId?: string;
    }) {
      const projectRoot = projectId ? storageOps.getProject(projectId)?.cwd : undefined;
      const skillDir = skills.getSkillSystemPathFromId(skillId, { projectRoot });
      if (!skillDir) throw new Error(`Failed to read skill: ${skillId}`);
      return join(skillDir, SKILL_FILENAME);
    },
    async uninstallSkill({ skillId, projectId }: { skillId: string; projectId?: string }) {
      const projectRoot = projectId ? storageOps.getProject(projectId)?.cwd : undefined;
      const skillDir = skills.getSkillSystemPathFromId(skillId, { projectRoot });
      if (!skillDir) throw new Error(`Failed to read skill: ${skillId}`);
      await rm(skillDir, { recursive: true, force: true });
    },
    async searchSkillsFromSkillsSh({ query }: { query: string }) {
      return skills.searchSkills(query);
    },
    async installSkillFromSkillsSh({ source, slug }: { source: string; slug: string }) {
      await skills.installSkill(source, slug);
    },

    // Projects
    async listProjects() {
      return project.listProjects();
    },
    async addProject(cwd: string) {
      return project.addProject(cwd);
    },
    async renameProject(params: { projectId: string; title: string }) {
      return project.renameProject(params);
    },
    async deleteProject(projectId: string) {
      return project.deleteProject(projectId);
    },

    // Personal Assistant
    async listAssistants() {
      return assistant.listConfigs();
    },
    async createAssistant(params) {
      const created = await assistant.create(params);
      await watcher.syncWatchers();
      return created;
    },
    async updateAssistantConfig({ assistantId, patch }) {
      const next = await assistant.updateConfig(assistantId, patch);
      if (patch.disabled === true && ilink.state.getActiveSessionId() === assistantId) {
        await ilink.setActiveIlinkSession({ sessionId: null });
      }
      return next;
    },
    async deleteAssistant({ assistantId }) {
      await assistant.delete(assistantId);
      await watcher.syncWatchers();
      if (ilink.state.getActiveSessionId() === assistantId) {
        await ilink.setActiveIlinkSession({ sessionId: null });
      }
    },
    async getAssistantStatus({ assistantId }) {
      return assistant.getStatus(assistantId);
    },
    async dismissAssistantDreamError({ assistantId }) {
      assistant.dismissDreamError(assistantId);
    },
    async runAssistantDream({ assistantId }) {
      return assistant.dreamNow(assistantId);
    },
    async getAssistantDataSystemPath({ assistantId }) {
      if (!assistant.isAssistantSession(assistantId)) {
        throw new Error(`Assistant ${assistantId} does not exist.`);
      }
      return assistantPaths(assistantId).root;
    },
    async listAssistantReminders({ assistantId }) {
      return assistant.listReminders(assistantId);
    },
    async listAssistantDiaries({ assistantId }) {
      return assistant.listDiaries(assistantId);
    },
    async readAssistantDiary({ assistantId, file }) {
      return assistant.readDiary(assistantId, file);
    },
    async readAssistantMemory({ assistantId }) {
      return assistant.readMemory(assistantId);
    },
    async listAssistantWorkers({ assistantId }) {
      return assistant.listWorkers(assistantId);
    },
    async getAssistantWorkerHistorySegment({ assistantId, workerId, segmentId }) {
      return assistant.readWorkerHistorySegment(assistantId, { workerId, segmentId });
    },
    async restartAssistant({ assistantId, config }) {
      return assistant.restart(assistantId, config);
    },

    // Sessions
    async listSessions() {
      return storageOps.listSessions();
    },
    async newSession(params) {
      return session.newSession(params);
    },
    async loadSession(params) {
      return session.loadSession(params);
    },
    async getSessionHistorySegment(params) {
      return session.getSessionHistorySegment(params);
    },
    async getSessionTokenUsage(params) {
      return session.getSessionTokenUsage(params);
    },
    async exportSession({ sessionId }) {
      return session.exportConversation(sessionId);
    },
    async sendPrompt(params) {
      return session.sendPrompt(params);
    },
    async cancelPrompt(params) {
      return session.cancelPrompt(params);
    },
    async updateSession(params) {
      return session.updateSession(params);
    },
    async changeWorkDir() {
      return session.changeWorkDir();
    },
    async closeSession({ sessionId }: { sessionId: string }) {
      return session.closeSession({ sessionId });
    },
    async deleteSession(sessionId: string) {
      return session.deleteSession(sessionId);
    },
    async getSessionDataSystemPath({ sessionId }: { sessionId: string }) {
      return session.getSessionDataSystemPath({ sessionId });
    },
    async resetAgent({ agentId }: { agentId: string }) {
      await session.resetAgentSessions(agentId);
      const agentCfg = storageOps.getSettings().agents.find((a) => a.id === agentId);
      if (agentCfg?.type === "api") {
        const knownResumeIds = new Set(
          storageOps
            .listSessions()
            .filter((s) => s.agentId === agentId)
            .map((s) => s.resumeId),
        );
        deleteOrphanedAgentSessionDirectories(agentId, knownResumeIds);
      }
      await bridgeConnect.killBridgesByAgent(agentId);
    },
    async clearAgentSessions({ agentId }: { agentId: string }) {
      const deletedSessionIds = await session.deleteAgentSessions(agentId);
      return { deletedSessionIds };
    },
    async getModels(params) {
      return session.getModels(params);
    },
    async setModel(params) {
      return session.setModel(params);
    },
    async listAgentModels({ agentId }: { agentId: string }) {
      return loadAgentModels(agentId);
    },
    async getModes(params) {
      return session.getModes(params);
    },
    async setMode(params) {
      return session.setMode(params);
    },
    async getThoughtLevels(params) {
      return session.getThoughtLevels(params);
    },
    async setThoughtLevel(params) {
      return session.setThoughtLevel(params);
    },

    // Ask User
    async getPendingAskUserRequests(params) {
      return askUser.getPendingAskUserRequests(params);
    },
    async respondAskUser(params) {
      return askUser.respondAskUser(params);
    },

    // Filesystem
    async getSystemFilePath(params) {
      return project.getSystemFilePath(params);
    },
    async copyFileToWorkspace(params) {
      return project.copyFileToWorkspace(params);
    },
    async readUrlAsDataUrl(params) {
      return project.readUrlAsDataUrl(params);
    },
    async searchFiles(params) {
      return project.searchFiles(params);
    },
    async readDir(params) {
      return project.readDir(params);
    },
    async createFile(params) {
      return project.createFile(params);
    },
    async deleteFile(params) {
      return project.deleteFile(params);
    },
    async renameFile(params) {
      return project.renameFile(params);
    },
    async moveFile(params) {
      return project.moveFile(params);
    },
    async readFile(params) {
      return project.readFile(params);
    },
    async writeFile(params) {
      return project.writeFile(params);
    },
    async getFileInfo(params) {
      return project.getFileInfo(params);
    },
    async writeExternalFile(params) {
      return project.writeExternalFile(params);
    },
    async getPlatform() {
      return project.getPlatform();
    },

    // Terminal
    async registerClient(params) {
      return terminal.registerClient(params);
    },
    async createTerminal(params) {
      return terminal.createTerminal(params);
    },
    async writeTerminal(params) {
      return terminal.writeTerminal(params);
    },
    async killTerminalsByClient(params) {
      return terminal.killTerminalsByClient(params);
    },
    async killTerminal(params) {
      return terminal.killTerminal(params);
    },
    async resizeTerminal(params) {
      return terminal.resizeTerminal(params);
    },
    async getAgentTerminalOutput(params) {
      return terminal.getAgentTerminalOutput(params);
    },
    async killAgentTerminal(params) {
      return terminal.killAgentTerminal(params);
    },

    // Git
    async getGitStatus(params) {
      return project.getGitStatus(params);
    },
    async readGitHeadFile(params) {
      return project.readGitHeadFile(params);
    },

    // iLink
    async getIlinkStatus() {
      return ilink.getIlinkStatus();
    },
    async startIlinkLogin() {
      return ilink.startIlinkLogin();
    },
    async pollIlinkQrcode(params) {
      return ilink.pollIlinkQrcode(params);
    },
    async stopIlink(params) {
      return ilink.stopIlink(params);
    },
    async setActiveIlinkSession(params) {
      return ilink.setActiveIlinkSession(params);
    },
    async getActiveIlinkSession() {
      return ilink.getActiveIlinkSession();
    },

    // Automation
    async listSchedules() {
      return automation.listSchedules();
    },
    async getServerTimezone() {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    },
    async createSchedule(params) {
      const schedule = automation.createSchedule(params);
      sendEvent("schedules-changed", undefined);
      return schedule;
    },
    async updateSchedule({
      scheduleId,
      updates,
    }: {
      scheduleId: string;
      updates: Partial<Schedule>;
    }) {
      const schedule = automation.updateSchedule(scheduleId, updates);
      sendEvent("schedules-changed", undefined);
      return schedule;
    },
    async deleteSchedule({ scheduleId }: { scheduleId: string }) {
      automation.deleteSchedule(scheduleId);
      sendEvent("schedules-changed", undefined);
    },
    async triggerSchedule({ scheduleId }: { scheduleId: string }) {
      return automation.executeTask(scheduleId);
    },
    async getTasks({ scheduleId }: { scheduleId: string }) {
      return automation.listTasks(scheduleId);
    },
    async getTaskProject({ scheduleId, taskId }: { scheduleId: string; taskId: string }) {
      return {
        projectId: taskProjectId(scheduleId, taskId),
        cwd: automation.getTaskDir(scheduleId, taskId),
      };
    },
    async getShareFileSystemPath({
      sessionId,
      sharePath,
    }: {
      sessionId: string;
      sharePath: string;
    }) {
      const shareDir = storageOps.sessionShareDir(sessionId);
      if (!shareDir) throw new Error("Session not found");
      return join(shareDir, sharePath);
    },
    async deleteTask({ scheduleId, taskId }: { scheduleId: string; taskId: string }) {
      automation.deleteTask(scheduleId, taskId);
    },

    // Memory
    async getMemory({ projectId }: { projectId: string }) {
      return memory.getMemory(projectId);
    },
    async deleteMemoryEntry({ projectId, entryId }: { projectId: string; entryId: string }) {
      return memory.deleteMemoryEntry(projectId, entryId);
    },
    async clearMemory({ projectId }: { projectId: string }) {
      memory.clearMemory(projectId);
    },
    async getMemorySystemFilePath({ projectId }: { projectId: string }) {
      return memory.getFilePath(projectId);
    },

    // Realtime ASR
    async startRealtimeAsr({ clientId, asrSessionId }) {
      return asr.start(clientId, asrSessionId);
    },
    async sendRealtimeAsrFrame({ clientId, asrSessionId, audioB64 }) {
      asr.frame(clientId, asrSessionId, audioB64);
    },
    async stopRealtimeAsr({ clientId, asrSessionId }) {
      await asr.stop(clientId, asrSessionId);
    },

    // Speech Synthesis (TTS)：无状态转发，文本整理在渲染层
    async startTts({ ttsSessionId }) {
      return tts.start(ttsSessionId);
    },
    async speakTts({ ttsSessionId, text }) {
      await tts.speak(ttsSessionId, text);
    },
    async endTts({ ttsSessionId }) {
      await tts.end(ttsSessionId);
    },
  };

  // Inject handlers into webui (after assembly)
  webui.setHandlers(backendHandlers);

  // ── closeBackend ─────────────────────────────────────────────────
  async function closeBackend() {
    automation.stopAllCrons();
    // 隧道清理要跑一次联网的 CLI 删除命令，尽量提前：退出路径有看门狗，放到后面可能被直接切断。
    await tunnel.stopAll();
    await assistant.shutdown();
    await asr.closeAll();
    await tts.closeAll();
    webui.stop();
    await ilink.stopIlink({ logout: false });
    session.clearSession();
    await bridgeConnect.clearAll();
    await new Promise((resolve) => setTimeout(resolve, 100));
    terminal.killAllTerminals();
    await watcher.stopAll();
    for (const file of await readdir(TEMP_DIR)) {
      await rm(join(TEMP_DIR, file), { recursive: true, force: true });
    }
  }

  return {
    backendHandlers,
    closeBackend,
    isAssistantSession: assistant.isAssistantSession,
    isAssistantAvailable: (assistantId: string) =>
      assistant.isAssistantSession(assistantId) && assistant.getStatus(assistantId).enabled,
  };
}
