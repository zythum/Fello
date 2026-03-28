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

interface AppState {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  usage: SessionUsage | null;

  isConnecting: boolean;
  isStreaming: boolean;
  streamingContent: string;
  thinkingContent: string;
  sidebarOpen: boolean;
  permissionRequests: PermissionRequest[];
  availableModels: ModelOption[];
  currentModelId: string | null;
  activeToolCalls: Map<string, ActiveToolCall>;

  setSessions: (sessions: SessionInfo[]) => void;
  setActiveSessionId: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setUsage: (usage: SessionUsage | null) => void;
  setIsConnecting: (v: boolean) => void;
  setIsStreaming: (v: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  setThinkingContent: (content: string) => void;
  appendThinkingContent: (chunk: string) => void;
  setSidebarOpen: (v: boolean) => void;
  setPermissionRequest: (req: PermissionRequest | null) => void;
  addPermissionRequest: (req: PermissionRequest) => void;
  removePermissionRequest: (toolCallId: string) => void;
  setAvailableModels: (models: ModelOption[]) => void;
  setCurrentModelId: (id: string | null) => void;
  updateToolCall: (id: string, data: Partial<ActiveToolCall>) => void;
  clearToolCalls: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  usage: null,
  isConnecting: false,
  isStreaming: false,
  streamingContent: "",
  thinkingContent: "",
  sidebarOpen: true,
  permissionRequests: [],
  availableModels: [],
  currentModelId: null,
  activeToolCalls: new Map(),

  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setUsage: (usage) => set({ usage }),
  setIsConnecting: (v) => set({ isConnecting: v }),
  setIsStreaming: (v) => set({ isStreaming: v }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  appendStreamingContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),
  setThinkingContent: (content) => set({ thinkingContent: content }),
  appendThinkingContent: (chunk) =>
    set((state) => ({ thinkingContent: state.thinkingContent + chunk })),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setPermissionRequest: (req) => set({ permissionRequests: req ? [req] : [] }),
  addPermissionRequest: (req) =>
    set((state) => ({ permissionRequests: [...state.permissionRequests, req] })),
  removePermissionRequest: (toolCallId) =>
    set((state) => ({
      permissionRequests: state.permissionRequests.filter(
        (r) => r.toolCall.toolCallId !== toolCallId,
      ),
    })),
  setAvailableModels: (models) => set({ availableModels: models }),
  setCurrentModelId: (id) => set({ currentModelId: id }),
  updateToolCall: (id, data) =>
    set((state) => {
      const newMap = new Map(state.activeToolCalls);
      const existing = newMap.get(id);
      // Only merge non-null/undefined values
      const filtered = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v != null && v !== ""),
      );
      newMap.set(id, { title: "", status: "pending", content: "", ...existing, ...filtered });
      return { activeToolCalls: newMap };
    }),
  clearToolCalls: () => set({ activeToolCalls: new Map() }),
}));
