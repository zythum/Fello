import type { RequestPermissionRequest, SessionNotification } from "@agentclientprotocol/sdk";
import type { SettingsMeta, AgentConfig, ThemeConfig } from "./interfaces";

export type { AgentConfig, ThemeConfig, SettingsMeta };

export interface ProjectInfo {
  id: string;
  title: string;
  cwd: string;
  createdAt: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  projectId: string;
  projectTitle: string;
  agentId: string;
  resumeId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ModelState {
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>;
  currentModelId: string;
}

export interface ModeState {
  availableModes: Array<{ id: string; name: string; description?: string | null }>;
  currentModeId: string;
}

export interface WebUIStatus {
  enabled: boolean;
  url: string | null;
}

export type FelloIPCRequests = {
  getSettings: { params: void; response: SettingsMeta };
  updateSettings: { params: SettingsMeta; response: void };
  startWebUIServer: { params: { port?: number; token?: string }; response: WebUIStatus };
  stopWebUIServer: { params: void; response: WebUIStatus };
  getWebUIStatus: { params: void; response: WebUIStatus };
  listSessions: { params: void; response: SessionInfo[] };
  listProjects: { params: void; response: ProjectInfo[] };
  addProject: { params: string; response: { project: ProjectInfo; created: boolean } };
  renameProject: { params: { projectId: string; title: string }; response: void };
  deleteProject: { params: string; response: void };
  newSession: {
    params: { projectId: string; agentId: string };
    response: {
      sessionId: string;
      agentInfo: unknown;
      models: ModelState | null;
      modes: ModeState | null;
    };
  };
  loadSession: {
    params: { sessionId: string };
    response: {
      sessionId: string;
      agentInfo: unknown;
      models: ModelState | null;
      modes: ModeState | null;
    };
  };
  sendMessage: {
    params: { sessionId: string; text: string; messageId?: string };
    response: { stopReason: string };
  };
  cancelPrompt: { params: { sessionId: string }; response: void };
  respondPermission: { params: { toolCallId: string; optionId: string }; response: void };
  updateSessionTitle: { params: { sessionId: string; title: string }; response: void };
  changeWorkDir: {
    params: { sessionId: string };
    response: { ok: boolean; cwd: string | null };
  };
  deleteSession: { params: string; response: void };
  getCwd: { params: void; response: string };
  getModels: {
    params: { sessionId: string };
    response: ModelState | null;
  };
  setModel: { params: { sessionId: string; modelId: string }; response: void };
  getModes: {
    params: { sessionId: string };
    response: ModeState | null;
  };
  setMode: { params: { sessionId: string; modeId: string }; response: void };
  searchFiles: {
    params: { projectId: string; query?: string };
    response: Array<{ id: string; display: string }>;
  };
  readDir: {
    params: { projectId: string; relativePath?: string; depth?: number };
    response: unknown;
  };
  createFile: {
    params: { projectId: string; relativePath: string; isFolder: boolean };
    response: void;
  };
  deleteFile: { params: { projectId: string; relativePath: string }; response: void };
  getPlatform: { params: void; response: string };
  renameFile: {
    params: { projectId: string; oldRelativePath: string; newRelativePath: string };
    response: void;
  };
  moveFile: {
    params: { projectId: string; oldRelativePath: string; newRelativePath: string };
    response: void;
  };
  readFile: {
    params: { projectId: string; relativePath: string; encoding?: "utf8" | "base64" };
    response: string;
  };
  getFileInfo: {
    params: { projectId: string; relativePath: string };
    response: { size: number; isFile: boolean; isBinary: boolean } | null;
  };
  writeExternalFile: {
    params: { projectId: string; fileName: string; base64: string; destRelativeDir?: string };
    response: void;
  };
  createTerminal: {
    params: { projectId: string; cwd?: string; cols?: number; rows?: number };
    response: { terminalId: string };
  };
  writeTerminal: {
    params: { terminalId: string; data: string };
    response: { ok: boolean };
  };
  killTerminal: {
    params: { terminalId: string };
    response: { ok: boolean };
  };
  resizeTerminal: {
    params: { terminalId: string; cols: number; rows: number };
    response: { ok: boolean };
  };
  getAgentTerminalOutput: { params: { terminalId: string }; response: string };
  getGitStatus: {
    params: { projectId: string; cwd?: string };
    response: { branch: string; files: Record<string, string> } | null;
  };
  readGitHeadFile: {
    params: { projectId: string; relativePath: string; encoding?: "utf8" | "base64" };
    response: string;
  };
};

export type FelloIPCEvents = {
  "session-clear": { sessionId: string; };
  "session-update": { sessionId: string; notification: SessionNotification};
  "permission-request": { sessionId: string; request: RequestPermissionRequest};
  "terminal-output": { terminalId: string; data: string };
  "terminal-exit": { terminalId: string; exitCode: number | null };
  "agent-terminal-output": { terminalId: string; data: string };
  "webui-status-changed": { status: WebUIStatus };
  "fs-changed": { projectId: string; changes: string[] };
};

export type FelloIPCSchema = {
  requests: FelloIPCRequests;
  events: FelloIPCEvents;
};
