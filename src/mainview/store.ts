import { enableArrayMethods, enableMapSet, enablePatches } from "immer";
import { create } from "zustand";
import { useRef } from "react";
import type {
  SessionInfo,
  ProjectInfo,
  SettingsInfo,
  SettingEditorInfo,
  SettingSoundInfo,
  SessionNotificationFelloExt,
  AskUserRequest,
} from "../shared/schema";
import type { ChatMessage, ToolCallMessage, SubagentMessage } from "./lib/chat-message";

enableArrayMethods();
enableMapSet();
enablePatches();

export interface TerminalItem {
  id: string;
  running: boolean;
  projectId: string;
}

// Per-project state bucket
export interface ProjectState {
  terminals: TerminalItem[];
  activeTerminalId: string | null;
  /** 文件面板中已展开的文件夹 ID（相对路径）集合 */
  openFolders: string[];
}

const emptyProjectState = (): ProjectState => ({
  terminals: [],
  activeTerminalId: null,
  openFolders: [],
});

/** 暂存的附件信息（base64 编码，可序列化） */
export interface StagedAttachmentInfo {
  id: string;
  filename: string;
  mimeType: string;
  type: "image" | "file";
  /** base64 编码的文件内容（不含 data: URL 前缀） */
  data: string;
}

// Per-session state bucket
export interface SessionState {
  messages: ChatMessage[];
  isLoading: boolean;
  terminalLogs: Record<string, string>;
  askUserRequests: AskUserRequest[];
  activeToolCalls: Map<string, ToolCallMessage>;
  activeSubagents: Map<string, SubagentMessage>;
  pendingNotifications: SessionNotificationFelloExt[];
  /** 暂存的输入框内容，用于 session 切换时恢复 */
  draftInput: string;
  /** 暂存的附件列表（base64 编码），与 draftInput 一同跨 session 保持 */
  draftAttachments: StagedAttachmentInfo[];
  /**
   * 会话完成的时间戳（毫秒），用于在 sidebar 显示状态图标。
   * 当前会话：3秒后自动清除；非当前会话：在用户切到此会话时清除。
   */
  completedAt: number | null;
  /**
   * 完成状态：success（end_turn）或 error（其他），与 completedAt 配合使用。
   */
  completedStatus: "success" | "error" | null;
  /** 会话历史加载完成的时间戳（毫秒） */
  loadedAt: number | null;
}

const emptySessionState = (): SessionState => ({
  messages: [],
  isLoading: true,
  terminalLogs: {},
  askUserRequests: [],
  activeToolCalls: new Map(),
  activeSubagents: new Map(),
  pendingNotifications: [],
  draftInput: "",
  draftAttachments: [],
  completedAt: null,
  completedStatus: null,
  loadedAt: null,
});

export interface AppState {
  // ==========================================================================
  // 1. Core Data (Entities)
  // ==========================================================================
  projects: ProjectInfo[];
  sessions: SessionInfo[];

  // ==========================================================================
  // 2. Session Management
  // ==========================================================================
  isCreatingSession: boolean;
  /**
   * Per-session state bucket.
   * All state specific to an individual chat session (messages, loading state, model/mode config)
   * is strictly isolated here to prevent cross-session contamination.
   */
  sessionStates: Map<string, SessionState>;

  // ==========================================================================
  // 3. Project Management
  // ==========================================================================
  projectStates: Map<string, ProjectState>;

  // ==========================================================================
  // 4. Global UI & Configuration State
  // ==========================================================================
  sidebarOpen: boolean;
  configuredAgents: SettingsInfo["agents"];
  configuredMcpServers: SettingsInfo["mcpServers"];
  theme: SettingsInfo["theme"];
  i18n: SettingsInfo["i18n"];
  fileWatcher: SettingsInfo["fileWatcher"];
  proxy: SettingsInfo["proxy"];
  ilink: SettingsInfo["ilink"];
  editor: SettingEditorInfo;
  sound: SettingSoundInfo;
  snippets: SettingsInfo["snippets"];
  imageGeneration: SettingsInfo["imageGeneration"];
  webUIStatus: { enabled: boolean; url: string | null };
  ilinkStatus: {
    connected: boolean;
    userId?: string;
    accountId?: string;
    qrcodeUrl?: string;
    error?: string;
  };
  activeIlinkSessionId: string | null;
  isMacApp: boolean;
  isWinApp: boolean;
  isFullScreen: boolean;

  // ==========================================================================
  // 5. Global Caches & Ephemeral State
  // ==========================================================================

  // ==========================================================================
  // Selectors
  // ==========================================================================
  getSessionState: (id: string) => SessionState;
  getProjectState: (id: string) => ProjectState;

  // ==========================================================================
  // Core Mutators
  // ==========================================================================
  updateSessionState: (id: string, updater: (state: SessionState) => Partial<SessionState>) => void;
  updateProjectState: (id: string, updater: (state: ProjectState) => Partial<ProjectState>) => void;
  setProjects: (projects: ProjectInfo[]) => void;
  setSessions: (sessions: SessionInfo[]) => void;
  updateSession: (session: SessionInfo) => void;
  setIsCreatingSession: (v: boolean) => void;

  // ==========================================================================
  // Per-session mutators
  // ==========================================================================
  resetSessionState: (sessionId: string) => void;
  disposeSessionState: (sessionId: string) => void;
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  setAskUserRequest: (sessionId: string, req: AskUserRequest | null) => void;
  addAskUserRequest: (sessionId: string, req: AskUserRequest) => void;
  removeAskUserRequest: (sessionId: string, askUserId: string) => void;

  // ==========================================================================
  // Terminal log mutators
  // ==========================================================================
  appendTerminalLog: (sessionId: string, terminalId: string, chunk: string) => void;
  setTerminalLog: (sessionId: string, terminalId: string, fullLog: string) => void;

  // ==========================================================================
  // Global mutators
  // ==========================================================================
  setSidebarOpen: (v: boolean) => void;
  setConfiguredAgents: (agents: SettingsInfo["agents"]) => void;
  setConfiguredMcpServers: (mcpServers: SettingsInfo["mcpServers"]) => void;
  setTheme: (theme: SettingsInfo["theme"]) => void;
  setI18n: (i18n: SettingsInfo["i18n"]) => void;
  setFileWatcher: (fileWatcher: SettingsInfo["fileWatcher"]) => void;
  setProxy: (proxy: SettingsInfo["proxy"]) => void;
  setIlink: (ilink: SettingsInfo["ilink"]) => void;
  setEditor: (editor: SettingEditorInfo) => void;
  setSound: (sound: SettingSoundInfo) => void;
  setSnippets: (snippets: SettingsInfo["snippets"]) => void;
  setImageGeneration: (imageGeneration: SettingsInfo["imageGeneration"]) => void;
  setWebUIStatus: (status: { enabled: boolean; url: string | null }) => void;
  setIlinkStatus: (status: {
    connected: boolean;
    userId?: string;
    accountId?: string;
    qrcodeUrl?: string;
    error?: string;
  }) => void;
  setActiveIlinkSessionId: (sessionId: string | null) => void;
  setIsFullScreen: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ==========================================================================
  // 1. Core Data (Entities)
  // ==========================================================================
  projects: [],
  sessions: [],

  // ==========================================================================
  // 2. Session Management
  // ==========================================================================
  isCreatingSession: false,
  sessionStates: new Map(),

  // ==========================================================================
  // 3. Project Management
  // ==========================================================================
  projectStates: new Map(),

  // ==========================================================================
  // 4. Global UI & Configuration State
  // ==========================================================================
  sidebarOpen: true,
  configuredAgents: [],
  configuredMcpServers: [],
  theme: { themeMode: "system" },
  i18n: { language: "en" },
  fileWatcher: { enabled: true },
  proxy: { mode: "off" },
  ilink: { useOriginalImage: false },
  editor: { name: "code" },
  sound: { volume: 50, muted: false, theme: "soft" },
  snippets: [],
  imageGeneration: [],
  webUIStatus: { enabled: false, url: null },
  ilinkStatus: { connected: false },
  activeIlinkSessionId: null,
  isMacApp: window.fello?.isMacApp ?? false,
  isWinApp: window.fello?.isWinApp ?? false,
  isFullScreen: false,

  // ==========================================================================
  // 5. Global Caches & Ephemeral State
  // ==========================================================================

  // ==========================================================================
  // Selectors
  // ==========================================================================
  getSessionState: (sid: string) => {
    const state = get().sessionStates.get(sid);
    if (state) return state;

    return emptySessionState();
  },
  getProjectState: (id) => {
    if (!id) return emptyProjectState();
    return get().projectStates.get(id) ?? emptyProjectState();
  },

  // ==========================================================================
  // Core Mutators
  // ==========================================================================
  updateSessionState: (id, updater) => {
    set((state) => {
      const current = state.sessionStates.get(id);
      if (!current && !state.sessions.some((s) => s.id === id)) return state; // Deleted session, skip
      const map = new Map(state.sessionStates);
      const base = current ?? emptySessionState();
      map.set(id, { ...base, ...updater(base) });
      return { sessionStates: map };
    });
  },
  updateProjectState: (id, updater) => {
    set((state) => {
      const map = new Map(state.projectStates);
      const current = map.get(id) ?? emptyProjectState();
      map.set(id, { ...current, ...updater(current) });
      return { projectStates: map };
    });
  },

  setProjects: (projects) => set({ projects }),
  setSessions: (sessions) => set({ sessions }),
  updateSession: (session) =>
    set((state) => {
      const idx = state.sessions.findIndex((s) => s.id === session.id);
      if (idx === -1) return state;
      const next = [...state.sessions];
      next[idx] = session;
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      return { sessions: next };
    }),
  setIsCreatingSession: (v) => set({ isCreatingSession: v }),

  // ==========================================================================
  // Per-session mutators
  // ==========================================================================
  resetSessionState: (sessionId) =>
    set((state) => {
      const map = new Map(state.sessionStates);
      map.set(sessionId, emptySessionState());
      return { sessionStates: map };
    }),
  disposeSessionState: (sessionId) =>
    set((state) => {
      const map = new Map(state.sessionStates);
      map.delete(sessionId);
      return { sessionStates: map };
    }),
  setMessages: (sessionId, messages) => get().updateSessionState(sessionId, () => ({ messages })),
  addMessage: (sessionId, message) =>
    get().updateSessionState(sessionId, (s) => ({ messages: [...s.messages, message] })),
  setAskUserRequest: (sessionId, req) =>
    get().updateSessionState(sessionId, () => ({
      askUserRequests: req ? [req] : [],
    })),
  addAskUserRequest: (sessionId, req) =>
    get().updateSessionState(sessionId, (s) => ({
      askUserRequests: [...s.askUserRequests, req],
    })),
  removeAskUserRequest: (sessionId, askUserId) =>
    get().updateSessionState(sessionId, (s) => ({
      askUserRequests: s.askUserRequests.filter((r) => r.askUserId !== askUserId),
    })),

  // ==========================================================================
  // Terminal log mutators
  // ==========================================================================
  appendTerminalLog: (sessionId, terminalId, chunk) =>
    get().updateSessionState(sessionId, (state) => ({
      terminalLogs: {
        ...state.terminalLogs,
        [terminalId]: (state.terminalLogs[terminalId] || "") + chunk,
      },
    })),
  setTerminalLog: (sessionId, terminalId, fullLog) =>
    get().updateSessionState(sessionId, (state) => {
      const currentLog = state.terminalLogs[terminalId] || "";
      if (!currentLog) {
        return {
          terminalLogs: {
            ...state.terminalLogs,
            [terminalId]: fullLog,
          },
        };
      }

      if (fullLog.endsWith(currentLog)) {
        return { terminalLogs: { ...state.terminalLogs, [terminalId]: fullLog } };
      }
      if (currentLog.startsWith(fullLog)) {
        return {};
      }

      let overlap = 0;
      const maxOverlapCheck = 8192;
      const minLen = Math.min(fullLog.length, currentLog.length, maxOverlapCheck);
      for (let i = minLen; i > 0; i--) {
        if (fullLog.endsWith(currentLog.substring(0, i))) {
          overlap = i;
          break;
        }
      }

      return {
        terminalLogs: {
          ...state.terminalLogs,
          [terminalId]: fullLog + currentLog.substring(overlap),
        },
      };
    }),

  // ==========================================================================
  // Global mutators
  // ==========================================================================
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setConfiguredAgents: (agents) => set({ configuredAgents: agents }),
  setConfiguredMcpServers: (mcpServers) => set({ configuredMcpServers: mcpServers }),
  setTheme: (theme) => set({ theme }),
  setI18n: (i18n) => set({ i18n }),
  setFileWatcher: (fileWatcher) => set({ fileWatcher }),
  setProxy: (proxy) => set({ proxy }),
  setIlink: (ilink) => set({ ilink }),
  setEditor: (editor) => set({ editor }),
  setSound: (sound) => set({ sound }),
  setSnippets: (snippets) => set({ snippets }),
  setImageGeneration: (imageGeneration) => set({ imageGeneration }),
  setWebUIStatus: (status) => set({ webUIStatus: status }),
  setIlinkStatus: (status) => set({ ilinkStatus: status }),
  setActiveIlinkSessionId: (sessionId) => set({ activeIlinkSessionId: sessionId }),
  setIsFullScreen: (v) => set({ isFullScreen: v }),
}));

// Selector: derive current session's state for use in components
export function useSessionState(sessionId: string | null) {
  const fallbackRef = useRef<SessionState | null>(null);
  if (!fallbackRef.current) {
    fallbackRef.current = emptySessionState();
  }
  return useAppStore(
    (s) => (sessionId ? s.sessionStates.get(sessionId) : undefined) ?? fallbackRef.current!,
  );
}

export function useProjectState(projectId: string | null) {
  const fallbackRef = useRef<ProjectState | null>(null);
  if (!fallbackRef.current) {
    fallbackRef.current = emptyProjectState();
  }
  return useAppStore(
    (s) => (projectId ? s.projectStates.get(projectId) : undefined) ?? fallbackRef.current!,
  );
}
