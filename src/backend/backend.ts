import { readdir, rm, readFile } from "fs/promises";
import { join } from "path";
import type { FelloIPCSchema, Schedule } from "../shared/schema";
import type { BackendContext, SendEventFn, EventListener, BackendHandlers } from "./types";
import { storageOps, TEMP_DIR } from "./storage";
import { setLanguage } from "./i18n";
import {
  deleteAgentPersistedStorage,
  deleteOrphanedAgentSessionDirectories,
} from "../agents/storage";

// ── Module factories ─────────────────────────────────────────────────

import { createWebUIModule } from "./webui";
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
import { taskProjectId } from "../shared/task-project";

// ── Init ─────────────────────────────────────────────────────────────

export function initBackend(
  emitter: <K extends keyof FelloIPCSchema["events"]>(
    channel: K,
    payload: FelloIPCSchema["events"][K],
  ) => boolean,
  /** Host capabilities that only the desktop app can provide. */
  native?: { trashItem?: (path: string) => Promise<void> },
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
    filesystem: { grep, glob, trashItem: native?.trashItem },
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
      webui.stop();
      const status = { enabled: false, url: null };
      sendEvent("webui-status-changed", { status });
      return status;
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

    // Skills
    async getSkillsCatalog({ all, projectId }: { all?: boolean; projectId?: string }) {
      return skills.getSkillsCatalog({
        projectRoot: projectId ? storageOps.getProject(projectId)?.cwd : undefined,
        all,
      });
    },
    async readSkillFile({ skillId, projectId }: { skillId: string; projectId?: string }) {
      return readFile(
        await backendHandlers.getSkillFileSystemFilePath({ skillId, projectId }),
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
    async getAssistantHistorySegment({ assistantId, segmentId }) {
      return assistant.getHistorySegment(assistantId, { segmentId });
    },
    async sendAssistantPrompt({ assistantId, contents }) {
      return assistant.sendPrompt(assistantId, contents);
    },
    async cancelAssistantPrompt({ assistantId }) {
      return assistant.cancelPrompt(assistantId);
    },
    async setAssistantModel({ assistantId, modelId }) {
      return assistant.setModel(assistantId, modelId);
    },
    async setAssistantThoughtLevel({ assistantId, thoughtLevelId }) {
      return assistant.setThoughtLevel(assistantId, thoughtLevelId);
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
