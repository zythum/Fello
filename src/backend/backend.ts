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
import { createSearchModule } from "./search";
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

// ── Init ─────────────────────────────────────────────────────────────

export function initBackend(
  emitter: <K extends keyof FelloIPCSchema["events"]>(
    channel: K,
    payload: FelloIPCSchema["events"][K],
  ) => boolean,
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

  // ── Layer 2: bridge connect (needs askUser) ──
  const bridgeConnect = createBridgeConnectModule(ctx, { askUser });

  // ── Layer 3: inference + memory (inference standalone, memory needs inference) ──
  const _inference = createInferenceModule(ctx, { skills, search });
  const memory = createMemoryModule(ctx, { inference: _inference });

  // ── Layer 4: session, project, terminal ──
  const session = createSessionModule(ctx, {
    bridgeConnect,
    askUser,
    shareToUser,
    skills,
    search,
    memory,
    ilink: ilink.state,
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
    respondAskUser: askUser.respondAskUser,
    getPendingAskUserRequests: askUser.getPendingAskUserRequests,
  });

  // ── Layer 5: automation ──
  const automation = createAutomationModule(ctx, { inference: _inference });

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
      const newAgents = settings.agents;
      if (newAgents) {
        const oldAgents = storageOps.getSettings().agents;
        const oldMap = new Map(oldAgents.map((a) => [a.id, a]));
        const newMap = new Map(newAgents.map((a) => [a.id, a]));
        const changedOrRemoved = new Set<string>();

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
    async getSessionHistory(params) {
      return session.getSessionHistory(params);
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
    async getModes(params) {
      return session.getModes(params);
    },
    async setMode(params) {
      return session.setMode(params);
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
    async getTaskFiles({ scheduleId, taskId }: { scheduleId: string; taskId: string }) {
      return automation.listTaskFiles(scheduleId, taskId);
    },
    async readTaskFile({
      scheduleId,
      taskId,
      filePath,
      encoding,
    }: {
      scheduleId: string;
      taskId: string;
      filePath: string;
      encoding?: "base64";
    }) {
      return automation.readTaskFile(scheduleId, taskId, filePath, encoding);
    },
    async getTaskFileSystemPath({
      scheduleId,
      taskId,
      filePath,
    }: {
      scheduleId: string;
      taskId: string;
      filePath: string;
    }) {
      return automation.getTaskFileSystemPath(scheduleId, taskId, filePath);
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
      return memory.getEntries(projectId);
    },
    async clearMemory({ projectId }: { projectId: string }) {
      memory.clearMemory(projectId);
    },
    async getMemorySystemFilePath({ projectId }: { projectId: string }) {
      return memory.getFilePath(projectId);
    },
  };

  // Inject handlers into webui (after assembly)
  webui.setHandlers(backendHandlers);

  // ── closeBackend ─────────────────────────────────────────────────
  async function closeBackend() {
    automation.stopAllCrons();
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

  return { backendHandlers, closeBackend };
}
