import { create } from "zustand";

export interface ChatMessage {
  id?: number;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  messageId?: string | null;
  toolCallId?: string | null;
  toolTitle?: string | null;
  toolStatus?: string | null;
  toolKind?: string | null;
  rawInput?: unknown;
  locations?: Array<{ path: string; line?: number | null }> | null;
  createdAt?: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  agent_command: string;
  created_at: number;
  updated_at: number;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  thoughtTokens?: number | null;
  cachedReadTokens?: number | null;
  cachedWriteTokens?: number | null;
}

export interface ModelOption {
  modelId: string;
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
  streamingContent: string;
  thinkingContent: string;
  permissionRequests: PermissionRequest[];
  activeToolCalls: Map<string, ActiveToolCall>;
}

const emptySessionState = (): SessionState => ({
  messages: [],
  usage: null,
  isStreaming: false,
  streamingContent: "",
  thinkingContent: "",
  permissionRequests: [],
  activeToolCalls: new Map(),
});

interface AppState {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  sessionStates: Map<string, SessionState>;

  // Global (not per-session)
  isConnecting: boolean;
  sidebarOpen: boolean;
  availableModels: ModelOption[];
  currentModelId: string | null;

  // Helpers to get/update the active session's state
  getSessionState: (id?: string | null) => SessionState;
  updateSessionState: (id: string, updater: (s: SessionState) => Partial<SessionState>) => void;

  setSessions: (sessions: SessionInfo[]) => void;
  setActiveSessionId: (id: string | null) => void;

  // Per-session mutators (sessionId required)
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  setUsage: (sessionId: string, usage: SessionUsage | null) => void;
  setIsStreaming: (sessionId: string, v: boolean) => void;
  setStreamingContent: (sessionId: string, content: string) => void;
  appendStreamingContent: (sessionId: string, chunk: string) => void;
  setThinkingContent: (sessionId: string, content: string) => void;
  appendThinkingContent: (sessionId: string, chunk: string) => void;
  setPermissionRequest: (sessionId: string, req: PermissionRequest | null) => void;
  addPermissionRequest: (sessionId: string, req: PermissionRequest) => void;
  removePermissionRequest: (sessionId: string, toolCallId: string) => void;
  updateToolCall: (sessionId: string, id: string, data: Partial<ActiveToolCall>) => void;
  clearToolCalls: (sessionId: string) => void;

  // Global mutators
  setIsConnecting: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setAvailableModels: (models: ModelOption[]) => void;
  setCurrentModelId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  sessionStates: new Map(),

  isConnecting: false,
  sidebarOpen: true,
  availableModels: [],
  currentModelId: null,

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

  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),

  // Per-session mutators
  setMessages: (sessionId, messages) => get().updateSessionState(sessionId, () => ({ messages })),
  addMessage: (sessionId, message) =>
    get().updateSessionState(sessionId, (s) => ({ messages: [...s.messages, message] })),
  setUsage: (sessionId, usage) => get().updateSessionState(sessionId, () => ({ usage })),
  setIsStreaming: (sessionId, v) => get().updateSessionState(sessionId, () => ({ isStreaming: v })),
  setStreamingContent: (sessionId, content) =>
    get().updateSessionState(sessionId, () => ({ streamingContent: content })),
  appendStreamingContent: (sessionId, chunk) =>
    get().updateSessionState(sessionId, (s) => ({
      streamingContent: s.streamingContent + chunk,
    })),
  setThinkingContent: (sessionId, content) =>
    get().updateSessionState(sessionId, () => ({ thinkingContent: content })),
  appendThinkingContent: (sessionId, chunk) =>
    get().updateSessionState(sessionId, (s) => ({
      thinkingContent: s.thinkingContent + chunk,
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
      return { activeToolCalls: newMap };
    }),
  clearToolCalls: (sessionId) =>
    get().updateSessionState(sessionId, () => ({ activeToolCalls: new Map() })),

  // Global mutators
  setIsConnecting: (v) => set({ isConnecting: v }),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setAvailableModels: (models) => set({ availableModels: models }),
  setCurrentModelId: (id) => set({ currentModelId: id }),
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
