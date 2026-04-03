import type { RequestPermissionRequest, SessionNotification } from "@agentclientprotocol/sdk";

export interface ProjectInfo {
  id: string;
  title: string;
  cwd: string;
  created_at: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  project_id: string;
  project_title: string;
  agent: string;
  acp_session_id: string;
  agent_command: string;
  created_at: number;
  updated_at: number;
}

export interface ModelState {
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>;
  currentModelId: string;
}

export interface ModeState {
  availableModes: Array<{ id: string; name: string; description?: string | null }>;
  currentModeId: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface SettingsMeta {
  agents: AgentConfig[];
}

export type FelloIPCRequests = {
  getSettings: { params: void; response: SettingsMeta };
  updateSettings: { params: SettingsMeta; response: void };
  listSessions: { params: void; response: SessionInfo[] };
  listProjects: { params: void; response: ProjectInfo[] };
  addProject: {
    params: void;
    response: { project: ProjectInfo; created: boolean };
  };
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
  sendMessage: { params: string; response: { stopReason: string } };
  cancelPrompt: { params: void; response: void };
  respondPermission: { params: { toolCallId: string; optionId: string }; response: void };
  updateSessionTitle: { params: { sessionId: string; title: string }; response: void };
  changeWorkDir: {
    params: { sessionId: string };
    response: { ok: boolean; cwd: string | null };
  };
  deleteSession: { params: string; response: void };
  disconnect: { params: void; response: void };
  getCwd: { params: void; response: string };
  pickWorkDir: { params: void; response: string | null };
  getModels: {
    params: void;
    response: ModelState | null;
  };
  setModel: { params: string; response: void };
  getModes: {
    params: void;
    response: ModeState | null;
  };
  setMode: { params: string; response: void };
  searchFiles: {
    params: { cwd: string; query?: string };
    response: Array<{ id: string; display: string }>;
  };
  readDir: {
    params: { path: string; depth?: number };
    response: unknown;
  };
  createFile: { params: { path: string; isFolder: boolean }; response: void };
  deleteFile: { params: { path: string; permanent: boolean }; response: void };
  getPlatform: { params: void; response: string };
  renameFile: { params: { oldPath: string; newPath: string }; response: void };
  moveFile: { params: { oldPath: string; newPath: string }; response: void };
  readFile: { params: string; response: string };
  revealInFinder: { params: string; response: void };
  writeDroppedFile: {
    params: { fileName: string; base64: string; destDir: string };
    response: void;
  };
  writeDroppedFolder: {
    params: { destDir: string };
    response: void;
  };
  showContextMenu: {
    params: {
      items: Array<{
        label?: string;
        action?: string;
        type?: string;
        enabled?: boolean;
        data?: unknown;
      }>;
    };
    response: string | null;
  };
  createTerminal: {
    params: { sessionId: string; cwd?: string; cols?: number; rows?: number };
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
};

export type FelloIPCEvents = {
  "session-update": SessionNotification;
  "permission-request": RequestPermissionRequest;
  "terminal-output": { terminalId: string; data: string };
  "terminal-exit": { terminalId: string; exitCode: number | null };
};

export type FelloIPCSchema = {
  requests: FelloIPCRequests;
  events: FelloIPCEvents;
};
