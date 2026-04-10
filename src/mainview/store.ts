import { create } from "zustand";
import type { SessionInfo, ProjectInfo, SettingsInfo } from "../shared/schema";
import type { ChatMessage, ChatRole, ToolCallMessage } from "./chat-message";
import type {
  ContentBlock,
  ToolCallStatus,
  ToolKind,
  ToolCallLocation,
  ToolCallContent,
} from "@agentclientprotocol/sdk";

export type { SessionInfo, ProjectInfo, ChatMessage };

export interface SessionUsage {
  /** Total context window size in tokens */
  size: number;
  /** Tokens currently in context */
  used: number;
  /** Cumulative session cost (optional) */
  cost?: { amount: number; currency: string } | null;
}

export interface ModelOption {
  modelId: string;
  name: string;
  description?: string | null;
}

export interface ModeOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface PermissionRequest {
  toolCall: { title?: string | null | undefined; toolCallId: string };
  options: Array<{ optionId: string; name: string; kind: string }>;
}

interface ActiveToolCall {
  title: string;
  status: ToolCallStatus;
  content?: Array<ToolCallContent> | null;
  kind?: ToolKind | null;
  terminalId?: string | null;
  rawInput?: unknown;
  locations?: Array<ToolCallLocation> | null;
}

// Per-session state bucket
export interface SessionState {
  messages: ChatMessage[];
  usage: SessionUsage | null;
  isStreaming: boolean;
  permissionRequests: PermissionRequest[];
  activeToolCalls: Map<string, ActiveToolCall>;
}

const emptySessionState = (): SessionState => ({
  messages: [],
  usage: null,
  isStreaming: false,
  permissionRequests: [],
  activeToolCalls: new Map(),
});

interface AppState {
  projects: ProjectInfo[];
  sessions: SessionInfo[];
  activeSessionId: string | null;
  sessionStates: Map<string, SessionState>;

  // Global (not per-session)
  isConnecting: boolean;
  sidebarOpen: boolean;
  configuredAgents: SettingsInfo["agents"];
  theme: SettingsInfo["theme"];
  i18n: SettingsInfo["i18n"];
  availableModels: ModelOption[];
  currentModelId: string | null;
  availableModes: ModeOption[];
  currentModeId: string | null;
  globalErrorMessages: string[];
  terminalLogs: Record<string, string>;
  webUIStatus: { enabled: boolean; url: string | null };

  // Selectors
  getSessionState: (id?: string) => SessionState;

  // Modifiers
  updateSessionState: (id: string, updater: (state: SessionState) => Partial<SessionState>) => void;
  setProjects: (projects: ProjectInfo[]) => void;
  setSessions: (sessions: SessionInfo[]) => void;
  setActiveSessionId: (id: string | null) => void;

  // Per-session mutators
  resetSessionState: (sessionId: string) => void;
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  setUsage: (sessionId: string, usage: SessionUsage | null) => void;
  setIsStreaming: (sessionId: string, v: boolean) => void;
  appendToLastMessage: (sessionId: string, role: ChatRole, block: ContentBlock) => void;
  finalizeStreamingMessages: (sessionId: string) => void;
  setPermissionRequest: (sessionId: string, req: PermissionRequest | null) => void;
  addPermissionRequest: (sessionId: string, req: PermissionRequest) => void;
  removePermissionRequest: (sessionId: string, toolCallId: string) => void;
  updateToolCall: (sessionId: string, id: string, data: Partial<ActiveToolCall>) => void;
  clearToolCalls: (sessionId: string) => void;

  // Terminal log mutators
  appendTerminalLog: (terminalId: string, chunk: string) => void;
  setTerminalLog: (terminalId: string, fullLog: string) => void;

  // Global mutators
  setIsConnecting: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setConfiguredAgents: (agents: SettingsInfo["agents"]) => void;
  setTheme: (theme: SettingsInfo["theme"]) => void;
  setI18n: (i18n: SettingsInfo["i18n"]) => void;
  setAvailableModels: (models: ModelOption[]) => void;
  setCurrentModelId: (id: string | null) => void;
  setAvailableModes: (modes: ModeOption[]) => void;
  setCurrentModeId: (id: string | null) => void;
  setWebUIStatus: (status: { enabled: boolean; url: string | null }) => void;
  pushGlobalErrorMessage: (message: string) => void;
  shiftGlobalErrorMessage: () => void;
  clearGlobalErrors: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  sessions: [],
  activeSessionId: null,
  sessionStates: new Map(),

  isConnecting: false,
  sidebarOpen: true,
  configuredAgents: [],
  theme: { themeMode: "system" },
  i18n: { language: "en" },
  availableModels: [],
  currentModelId: null,
  availableModes: [],
  currentModeId: null,
  globalErrorMessages: [],
  terminalLogs: {},
  webUIStatus: { enabled: false, url: null },

  getSessionState: (id) => {
    const sid = id ?? get().activeSessionId;
    if (!sid) return emptySessionState();
    return get().sessionStates.get(sid) ?? emptySessionState();
  },

  updateSessionState: (id, updater) => {
    set((state) => {
      const map = new Map(state.sessionStates);
      const current = map.get(id) ?? emptySessionState();
      map.set(id, { ...current, ...updater(current) });
      return { sessionStates: map };
    });
  },

  setProjects: (projects) => set({ projects }),
  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),

  // Per-session mutators
  resetSessionState: (sessionId) =>
    set((state) => {
      const map = new Map(state.sessionStates);
      map.set(sessionId, emptySessionState());
      return { sessionStates: map };
    }),
  setMessages: (sessionId, messages) => get().updateSessionState(sessionId, () => ({ messages })),
  addMessage: (sessionId, message) =>
    get().updateSessionState(sessionId, (s) => ({ messages: [...s.messages, message] })),
  setUsage: (sessionId, usage) => get().updateSessionState(sessionId, () => ({ usage })),
  setIsStreaming: (sessionId, v) => get().updateSessionState(sessionId, () => ({ isStreaming: v })),
  appendToLastMessage: (sessionId, role, block) =>
    get().updateSessionState(sessionId, (s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1] as any;
      if (last && last.role === role && last.streaming) {
        const oldContents = last.contents || [];
        const lastBlock = oldContents[oldContents.length - 1];

        if (lastBlock && lastBlock.type === "text" && block.type === "text") {
          const newContents = [...oldContents];
          newContents[newContents.length - 1] = {
            ...lastBlock,
            text: lastBlock.text + block.text,
          };
          msgs[msgs.length - 1] = { ...last, contents: newContents };
        } else {
          msgs[msgs.length - 1] = { ...last, contents: [...oldContents, block] };
        }
      } else {
        // Finalize any prior streaming messages when starting a new one
        for (let i = 0; i < msgs.length; i++) {
          const m = msgs[i] as any;
          if (m.streaming) {
            msgs[i] = { ...m, streaming: false };
          }
        }
        msgs.push({ role, contents: [block], streaming: true } as any);
      }
      return { messages: msgs };
    }),
  finalizeStreamingMessages: (sessionId) =>
    get().updateSessionState(sessionId, (s) => ({
      messages: s.messages.map((m: any) => (m.streaming ? { ...m, streaming: false } : m)),
    })),
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
  updateToolCall: (sessionId, id, data) =>
    get().updateSessionState(sessionId, (s) => {
      const newMap = new Map(s.activeToolCalls);
      const existing = newMap.get(id);
      const filtered = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v != null && v !== ""),
      );
      const merged = { title: "", status: "completed" as ToolCallStatus, ...existing, ...filtered };
      newMap.set(id, merged);

      // Also upsert into messages so tools appear interleaved with other roles
      const msgs = [...s.messages];
      const idx = msgs.findIndex(
        (m) => m.role === "tool_call" && (m as ToolCallMessage).toolCallId === id,
      );
      const toolMsg: ToolCallMessage = {
        role: "tool_call",
        toolCallId: id,
        title: merged.title,
        status: merged.status,
        content: merged.content || [],
        kind: merged.kind || undefined,
        terminalId: merged.terminalId,
        rawInput: merged.rawInput,
        locations: merged.locations || [],
      };
      if (idx !== -1) {
        msgs[idx] = toolMsg;
      } else {
        msgs.push(toolMsg);
      }

      return { activeToolCalls: newMap, messages: msgs };
    }),
  clearToolCalls: (sessionId) =>
    get().updateSessionState(sessionId, () => ({ activeToolCalls: new Map() })),

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

  // Global mutators
  setIsConnecting: (v) => set({ isConnecting: v }),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setConfiguredAgents: (agents) => set({ configuredAgents: agents }),
  setTheme: (theme) => set({ theme }),
  setI18n: (i18n) => set({ i18n }),
  setAvailableModels: (models) => set({ availableModels: models }),
  setCurrentModelId: (id) => set({ currentModelId: id }),
  setAvailableModes: (modes) => set({ availableModes: modes }),
  setCurrentModeId: (id) => set({ currentModeId: id }),
  setWebUIStatus: (status) => set({ webUIStatus: status }),
  pushGlobalErrorMessage: (message) =>
    set((state) => ({ globalErrorMessages: [...state.globalErrorMessages, message] })),
  shiftGlobalErrorMessage: () =>
    set((state) => ({ globalErrorMessages: state.globalErrorMessages.slice(1) })),
  clearGlobalErrors: () => set({ globalErrorMessages: [] }),
}));

// Selector: derive current session's state for use in components
export function useActiveSessionState() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionStates = useAppStore((s) => s.sessionStates);
  if (!activeSessionId) {
    return emptySessionState();
  }
  return sessionStates.get(activeSessionId) ?? emptySessionState();
}
