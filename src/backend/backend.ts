import { readdir, rm } from "fs/promises";
import { join } from "path";
import { startWebUI, stopWebUI, getWebUIStatus, broadcastWebUIEvent } from "./webui";
import { storageOps, TEMP_DIR } from "./storage";
import {
  initRunner,
  executeTask,
  stopAllCrons,
} from "./automation";
import * as automationHandlers from "./automation";
import { initWatcher, syncWatchers } from "./watcher";
import {
  getSkillsCatalog,
  getSkillSystemPathFromId,
  SKILL_FILENAME,
  searchSkills,
  installSkill,
} from "./skills";
import { readActiveSessionId } from "./ilink/ilink-bridge";
import { setLanguage } from "./i18n";
import type { FelloIPCSchema } from "../shared/schema";

// Domain modules
import { initPool, bridgePool, clearPool } from "./session-agent-bridge";
import { initTerminal, killAllTerminals } from "./terminal";
import * as terminalHandlers from "./terminal";
import { initAskUser } from "./ask-user";
import * as askUserHandlers from "./ask-user";
import { markProjectFsDirty } from "./project-filesystem";
import * as filesystemHandlers from "./project-filesystem";
import { initSession, broadcastAndSaveSessionUpdate, clearSession } from "./session";
import * as sessionHandlers from "./session";
import { initProject } from "./project";
import * as projectHandlers from "./project";
import { initIlinkHandlers, getILinkBridge } from "./ilink-handlers";
import * as ilinkHandlers from "./ilink-handlers";
import * as gitHandlers from "./project-git";
import { setIlinkActiveSessionId } from "./ilink-state";

// ── sendEvent ────────────────────────────────────────────────────────

let sendEvent: <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => boolean = () => false;

// ── Init / Clear ─────────────────────────────────────────────────────

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

  // Init all sub-modules
  initSession(sendEvent);
  initProject(sendEvent);
  initPool({
    sendEvent,
    broadcastAndSaveSessionUpdate,
  });
  initTerminal(sendEvent);
  initAskUser(sendEvent);
  initIlinkHandlers({ sendEvent, backendHandlers });
  initWatcher(sendEvent);

  // Initialize automation runner and restore crons
  initRunner(sendEvent);

  // Try to restore iLink session on startup
  getILinkBridge()
    .tryRestore()
    .then(async (restored) => {
      if (restored) {
        const savedId = await readActiveSessionId();
        if (savedId && storageOps.getSession(savedId)) {
          setIlinkActiveSessionId(savedId);
          sendEvent("ilink-active-session-changed", { sessionId: savedId });
        }
      }
    })
    .catch((err) => {
      console.warn("[iLink] Failed to restore session:", err);
    });
}

export async function clearBackend() {
  stopAllCrons();
  clearSession();
  await clearPool();
  await new Promise((resolve) => setTimeout(resolve, 100));
  killAllTerminals();

  for (const file of await readdir(TEMP_DIR)) {
    await rm(join(TEMP_DIR, file), { recursive: true, force: true });
  }
}

// ── backendHandlers ──────────────────────────────────────────────────

export const backendHandlers: {
  [K in keyof FelloIPCSchema["requests"]]: (
    params: FelloIPCSchema["requests"][K]["params"],
  ) => Promise<FelloIPCSchema["requests"][K]["response"]>;
} = {
  // WebUI
  async getWebUIStatus() {
    return getWebUIStatus();
  },
  async startWebUIServer({ port, token }) {
    const { url } = await startWebUI({ port, token });
    const status = { enabled: true, url };
    sendEvent("webui-status-changed", { status });
    return status;
  },
  async stopWebUIServer() {
    stopWebUI();
    const status = { enabled: false, url: null };
    sendEvent("webui-status-changed", { status });
    return status;
  },

  // Settings
  async getSettings() {
    return storageOps.getSettings();
  },
  async updateSettings(settings) {
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
    if (settings.i18n?.language) setLanguage(settings.i18n.language);
    await syncWatchers();
  },

  // Skills
  async getSkillsCatalog({ all, projectId }) {
    return getSkillsCatalog({
      projectRoot: projectId ? storageOps.getProject(projectId)?.cwd : undefined,
      all,
    });
  },
  async readSkillFile({ skillId, projectId }) {
    const { readFile } = await import("fs/promises");
    return readFile(await this.getSkillFileSystemFilePath({ skillId, projectId }), "utf-8");
  },
  async getSkillFileSystemFilePath({ skillId, projectId }) {
    const projectRoot = projectId ? storageOps.getProject(projectId)?.cwd : undefined;
    const skillDir = getSkillSystemPathFromId(skillId, { projectRoot });
    if (!skillDir) throw new Error(`Failed to read skill: ${skillId}`);
    return join(skillDir, SKILL_FILENAME);
  },
  async uninstallSkill({ skillId, projectId }) {
    const projectRoot = projectId ? storageOps.getProject(projectId)?.cwd : undefined;
    const skillDir = getSkillSystemPathFromId(skillId, { projectRoot });
    if (!skillDir) throw new Error(`Failed to read skill: ${skillId}`);
    await rm(skillDir, { recursive: true, force: true });
  },
  async searchSkillsFromSkillsSh({ query }) {
    return searchSkills(query);
  },
  async installSkillFromSkillsSh({ source, slug }) {
    await installSkill(source, slug);
  },

  // Projects
  async listProjects() {
    return projectHandlers.listProjects();
  },
  async addProject(cwd: string) {
    return projectHandlers.addProject(cwd);
  },
  async renameProject(params) {
    return projectHandlers.renameProject(params);
  },
  async deleteProject(projectId: string) {
    return projectHandlers.deleteProject(projectId);
  },

  // Sessions
  async listSessions() {
    return storageOps.listSessions();
  },
  async newSession(params) {
    return sessionHandlers.newSession(params);
  },
  async loadSession(params) {
    return sessionHandlers.loadSession(params);
  },
  async getSessionHistory(params) {
    return sessionHandlers.getSessionHistory(params);
  },
  async sendPrompt(params) {
    return sessionHandlers.sendPrompt(params);
  },
  async cancelPrompt(params) {
    return sessionHandlers.cancelPrompt(params);
  },
  async updateSession(params) {
    return sessionHandlers.updateSession(params);
  },
  async changeWorkDir() {
    return sessionHandlers.changeWorkDir();
  },
  async deleteSession(sessionId) {
    return sessionHandlers.deleteSession(sessionId);
  },
  async getModels(params) {
    return sessionHandlers.getModels(params);
  },
  async setModel(params) {
    return sessionHandlers.setModel(params);
  },
  async getModes(params) {
    return sessionHandlers.getModes(params);
  },
  async setMode(params) {
    return sessionHandlers.setMode(params);
  },

  // Ask User
  async getPendingAskUserRequests(params) {
    return askUserHandlers.getPendingAskUserRequests(params);
  },
  async respondAskUser(params) {
    return askUserHandlers.respondAskUser(params);
  },

  // Filesystem
  async getSystemFilePath(params) {
    return filesystemHandlers.getSystemFilePath(params);
  },
  async copyFileToWorkspace(params) {
    return filesystemHandlers.copyFileToWorkspace(params);
  },
  async readUrlAsDataUrl(params) {
    return filesystemHandlers.readUrlAsDataUrl(params);
  },
  async searchFiles(params) {
    return filesystemHandlers.searchFiles(params);
  },
  async readDir(params) {
    return filesystemHandlers.readDir(params);
  },
  async createFile(params) {
    return filesystemHandlers.createFile(params);
  },
  async deleteFile(params) {
    return filesystemHandlers.deleteFile(params);
  },
  async renameFile(params) {
    return filesystemHandlers.renameFile(params);
  },
  async moveFile(params) {
    return filesystemHandlers.moveFile(params);
  },
  async readFile(params) {
    return filesystemHandlers.readFile(params);
  },
  async getFileInfo(params) {
    return filesystemHandlers.getFileInfo(params);
  },
  async writeExternalFile(params) {
    return filesystemHandlers.writeExternalFile(params);
  },
  async getPlatform() {
    return filesystemHandlers.getPlatform();
  },

  // Terminal
  async registerClient(params) {
    return terminalHandlers.registerClient(params);
  },
  async createTerminal(params) {
    return terminalHandlers.createTerminal(params);
  },
  async writeTerminal(params) {
    return terminalHandlers.writeTerminal(params);
  },
  async killTerminalsByClient(params) {
    return terminalHandlers.killTerminalsByClient(params);
  },
  async killTerminal(params) {
    return terminalHandlers.killTerminal(params);
  },
  async resizeTerminal(params) {
    return terminalHandlers.resizeTerminal(params);
  },
  async getAgentTerminalOutput(params) {
    return terminalHandlers.getAgentTerminalOutput(params);
  },

  // Git
  async getGitStatus(params) {
    return gitHandlers.getGitStatus(params);
  },
  async readGitHeadFile(params) {
    return gitHandlers.readGitHeadFile(params);
  },

  // iLink
  async getIlinkStatus() {
    return ilinkHandlers.getIlinkStatus();
  },
  async startIlinkLogin() {
    return ilinkHandlers.startIlinkLogin();
  },
  async pollIlinkQrcode(params) {
    return ilinkHandlers.pollIlinkQrcode(params);
  },
  async stopIlink() {
    return ilinkHandlers.stopIlink();
  },
  async setActiveIlinkSession(params) {
    return ilinkHandlers.setActiveIlinkSession(params);
  },
  async getActiveIlinkSession() {
    return ilinkHandlers.getActiveIlinkSession();
  },

  // Automation
  async listSchedules() {
    return automationHandlers.listSchedules();
  },
  async getServerTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  },
  async createSchedule(params) {
    const schedule = automationHandlers.createSchedule(params);
    sendEvent("schedules-changed", undefined);
    return schedule;
  },
  async updateSchedule({ scheduleId, updates }) {
    const schedule = automationHandlers.updateSchedule(scheduleId, updates);
    sendEvent("schedules-changed", undefined);
    return schedule;
  },
  async deleteSchedule({ scheduleId }) {
    automationHandlers.deleteSchedule(scheduleId);
    sendEvent("schedules-changed", undefined);
  },
  async triggerSchedule({ scheduleId }) {
    return executeTask(scheduleId);
  },
  async getTasks({ scheduleId }) {
    return automationHandlers.listTasks(scheduleId);
  },
  async getTaskFiles({ scheduleId, taskId }) {
    return automationHandlers.listTaskFiles(scheduleId, taskId);
  },
  async readTaskFile({ scheduleId, taskId, filePath, encoding }) {
    return automationHandlers.readTaskFile(scheduleId, taskId, filePath, encoding);
  },
  async getTaskFileSystemPath({ scheduleId, taskId, filePath }) {
    return automationHandlers.getTaskFileSystemPath(scheduleId, taskId, filePath);
  },
  async deleteTask({ scheduleId, taskId }) {
    automationHandlers.deleteTask(scheduleId, taskId);
  },
};
