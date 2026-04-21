import { create } from "zustand";
import { useRef } from "react";
import type { SessionInfo, ProjectInfo, SettingsInfo } from "../shared/schema";
import type { ChatMessage, ToolCallMessage } from "./lib/chat-message";
import type {
  ModelInfo,
  SessionMode,
  RequestPermissionRequest,
  UsageUpdate,
  InitializeResponse,
} from "@agentclientprotocol/sdk";

export type PermissionRequest = Omit<RequestPermissionRequest, "sessionId">;

export interface TerminalItem {
  id: string;
  running: boolean;
  projectId: string;
}

// Per-project state bucket
export interface ProjectState {
  terminals: TerminalItem[];
  activeTerminalId: string | null;
}

const emptyProjectState = (): ProjectState => ({
  terminals: [],
  activeTerminalId: null,
});

// Per-session state bucket
export interface SessionState {
  messages: ChatMessage[];
  usage: UsageUpdate | null;
  isStreaming: boolean;
  isLoading: boolean;
  permissionRequests: PermissionRequest[];
  activeToolCalls: Map<string, ToolCallMessage>;
  availableModels: ModelInfo[];
  currentModelId: string | null;
  availableModes: SessionMode[];
  currentModeId: string | null;
  agentInfo: InitializeResponse | null;
}

const emptySessionState = (): SessionState => ({
  messages: [],
  usage: null,
  isStreaming: false,
  isLoading: false,
  permissionRequests: [],
  activeToolCalls: new Map(),
  availableModels: [],
  currentModelId: null,
  availableModes: [],
  currentModeId: null,
  agentInfo: null,
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
  theme: SettingsInfo["theme"];
  i18n: SettingsInfo["i18n"];
  webUIStatus: { enabled: boolean; url: string | null };
  isMacApp: boolean;
  isFullScreen: boolean;

  // ==========================================================================
  // 5. Global Caches & Ephemeral State
  // ==========================================================================
  globalErrorMessages: string[];
  /**
   * Global cache for terminal logs.
   * Kept flat and global to avoid deep updates in SessionState and to persist
   * across session refreshes. Keyed by globally unique terminalId.
   */
  terminalLogs: Record<string, string>;

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
  setIsCreatingSession: (v: boolean) => void;

  // ==========================================================================
  // Per-session mutators
  // ==========================================================================
  resetSessionState: (sessionId: string) => void;
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  setIsStreaming: (sessionId: string, v: boolean) => void;
  setPermissionRequest: (sessionId: string, req: PermissionRequest | null) => void;
  addPermissionRequest: (sessionId: string, req: PermissionRequest) => void;
  removePermissionRequest: (sessionId: string, toolCallId: string) => void;

  // ==========================================================================
  // Terminal log mutators
  // ==========================================================================
  appendTerminalLog: (terminalId: string, chunk: string) => void;
  setTerminalLog: (terminalId: string, fullLog: string) => void;

  // ==========================================================================
  // Global mutators
  // ==========================================================================
  setSidebarOpen: (v: boolean) => void;
  setConfiguredAgents: (agents: SettingsInfo["agents"]) => void;
  setTheme: (theme: SettingsInfo["theme"]) => void;
  setI18n: (i18n: SettingsInfo["i18n"]) => void;
  setWebUIStatus: (status: { enabled: boolean; url: string | null }) => void;
  setIsFullScreen: (v: boolean) => void;
  pushGlobalErrorMessage: (message: string) => void;
  shiftGlobalErrorMessage: () => void;
  clearGlobalErrors: () => void;
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
  theme: { themeMode: "system" },
  i18n: { language: "en" },
  webUIStatus: { enabled: false, url: null },
  isMacApp: window.fello?.isMacApp ?? false,
  isFullScreen: false,

  // ==========================================================================
  // 5. Global Caches & Ephemeral State
  // ==========================================================================
  globalErrorMessages: [],
  terminalLogs: {},

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
      const map = new Map(state.sessionStates);
      const current = map.get(id) ?? emptySessionState();
      map.set(id, { ...current, ...updater(current) });
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
  setMessages: (sessionId, messages) => get().updateSessionState(sessionId, () => ({ messages })),
  addMessage: (sessionId, message) =>
    get().updateSessionState(sessionId, (s) => ({ messages: [...s.messages, message] })),
  setIsStreaming: (sessionId, v) => get().updateSessionState(sessionId, () => ({ isStreaming: v })),
  setPermissionRequest: (sessionId, req) =>
    get().updateSessionState(sessionId, () => ({
      permissionRequests: req ? [req] : [],
    })),
  addPermissionRequest: (sessionId, req) =>
    get().updateSessionState(sessionId, (s) => ({
      permissionRequests: [...s.permissionRequests, req],
    })),
  removePermissionRequest: (sessionId, toolCallId) =>
    get().updateSessionState(sessionId, (s) => ({
      permissionRequests: s.permissionRequests.filter((r) => r.toolCall.toolCallId !== toolCallId),
    })),

  // ==========================================================================
  // Terminal log mutators
  // ==========================================================================
  appendTerminalLog: (terminalId, chunk) =>
    set((state) => ({
      terminalLogs: {
        ...state.terminalLogs,
        [terminalId]: (state.terminalLogs[terminalId] || "") + chunk,
      },
    })),
  setTerminalLog: (terminalId, fullLog) =>
    set((state) => ({
      terminalLogs: {
        ...state.terminalLogs,
        [terminalId]: fullLog,
      },
    })),

  // ==========================================================================
  // Global mutators
  // ==========================================================================
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setConfiguredAgents: (agents) => set({ configuredAgents: agents }),
  setTheme: (theme) => set({ theme }),
  setI18n: (i18n) => set({ i18n }),
  setWebUIStatus: (status) => set({ webUIStatus: status }),
  setIsFullScreen: (v) => set({ isFullScreen: v }),
  pushGlobalErrorMessage: (message) =>
    set((state) => ({ globalErrorMessages: [...state.globalErrorMessages, message] })),
  shiftGlobalErrorMessage: () =>
    set((state) => ({ globalErrorMessages: state.globalErrorMessages.slice(1) })),
  clearGlobalErrors: () => set({ globalErrorMessages: [] }),
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
