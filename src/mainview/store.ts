import { create } from "zustand";

export interface ChatMessage {
  id?: number;
  role: "user" | "assistant" | "tool" | "system" | "thinking";
  content: string;
  messageId?: string | null;
  toolCallId?: string | null;
  toolTitle?: string | null;
  toolStatus?: string | null;
  toolKind?: string | null;
  rawInput?: unknown;
  locations?: Array<{ path: string; line?: number | null }> | null;
  createdAt?: number;
  /** True while this message is still being streamed */
  streaming?: boolean;
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

export interface ProjectInfo {
  id: string;
  title: string;
  cwd: string;
  created_at: number;
}

export interface SessionUsage {
  /** Total context window size in tokens */
  size: number;
  /** Tokens currently in context */
  used: number;
  /** Cumulative session cost (optional) */
  cost?: { amount: number; currency: string } | null;
  /** Input tokens */
  inputTokens?: number;
  /** Output tokens */
  outputTokens?: number;
  /** Total tokens */
  totalTokens?: number;
  /** Thinking/reasoning tokens */
  thoughtTokens?: number;
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
  toolCall: { title: string; toolCallId: string };
  options: Array<{ optionId: string; name: string; kind: string }>;
}

interface ActiveToolCall {
  title: string;
  status: string;
  content: string;
  kind?: string | null;
  rawInput?: unknown;
  locations?: Array<{ path: string; line?: number | null }> | null;
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

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface AppState {
  projects: ProjectInfo[];
  sessions: SessionInfo[];
  activeSessionId: string | null;
  sessionStates: Map<string, SessionState>;

  // Global (not per-session)
  isConnecting: boolean;
  sidebarOpen: boolean;
  configuredAgents: AgentConfig[];
  availableModels: ModelOption[];
  currentModelId: string | null;
  availableModes: ModeOption[];
  currentModeId: string | null;
  globalErrorMessages: string[];

  // Helpers to get/update the active session's state
  getSessionState: (id?: string | null) => SessionState;
  updateSessionState: (id: string, updater: (s: SessionState) => Partial<SessionState>) => void;

  setSessions: (sessions: SessionInfo[]) => void;
  setProjects: (projects: ProjectInfo[]) => void;
  setActiveSessionId: (id: string | null) => void;

  // Per-session mutators (sessionId required)
  resetSessionState: (sessionId: string) => void;
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  setUsage: (sessionId: string, usage: SessionUsage | null) => void;
  setIsStreaming: (sessionId: string, v: boolean) => void;
  appendToLastMessage: (sessionId: string, role: "assistant" | "thinking", chunk: string) => void;
  finalizeStreamingMessages: (sessionId: string) => void;
  setPermissionRequest: (sessionId: string, req: PermissionRequest | null) => void;
  addPermissionRequest: (sessionId: string, req: PermissionRequest) => void;
  removePermissionRequest: (sessionId: string, toolCallId: string) => void;
  updateToolCall: (sessionId: string, id: string, data: Partial<ActiveToolCall>) => void;
  clearToolCalls: (sessionId: string) => void;

  // Global mutators
  setIsConnecting: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setConfiguredAgents: (agents: AgentConfig[]) => void;
  setAvailableModels: (models: ModelOption[]) => void;
  setCurrentModelId: (id: string | null) => void;
  setAvailableModes: (modes: ModeOption[]) => void;
  setCurrentModeId: (id: string | null) => void;
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
  availableModels: [],
  currentModelId: null,
  availableModes: [],
  currentModeId: null,
  globalErrorMessages: [],

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
  appendToLastMessage: (sessionId, role, chunk) =>
    get().updateSessionState(sessionId, (s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === role && last.streaming) {
        msgs[msgs.length - 1] = { ...last, content: last.content + chunk };
      } else {
        // Finalize any prior streaming messages when starting a new one
        for (let i = 0; i < msgs.length; i++) {
          if (msgs[i].streaming) {
            msgs[i] = { ...msgs[i], streaming: false };
          }
        }
        msgs.push({ role, content: chunk, streaming: true });
      }
      return { messages: msgs };
    }),
  finalizeStreamingMessages: (sessionId) =>
    get().updateSessionState(sessionId, (s) => ({
      messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
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
      newMap.set(id, { title: "", status: "pending", content: "", ...existing, ...filtered });

      // Also upsert into messages so tools appear interleaved with other roles
      const msgs = [...s.messages];
      const idx = msgs.findIndex((m) => m.toolCallId === id);
      const merged = { ...newMap.get(id)! };
      const toolMsg: import("./store").ChatMessage = {
        role: "tool",
        content: merged.content,
        toolCallId: id,
        toolTitle: merged.title,
        toolStatus: merged.status,
        toolKind: merged.kind,
        rawInput: merged.rawInput,
        locations: merged.locations,
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

  // Global mutators
  setIsConnecting: (v) => set({ isConnecting: v }),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setConfiguredAgents: (agents) => set({ configuredAgents: agents }),
  setAvailableModels: (models) => set({ availableModels: models }),
  setCurrentModelId: (id) => set({ currentModelId: id }),
  setAvailableModes: (modes) => set({ availableModes: modes }),
  setCurrentModeId: (id) => set({ currentModeId: id }),
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
