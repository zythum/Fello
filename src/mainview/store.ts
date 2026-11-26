import { enableArrayMethods, enableMapSet, enablePatches } from "immer";
import { create } from "zustand";
import { useState } from "react";
import type {
  AssistantConfig,
  AssistantStatus,
  SessionInfo,
  ProjectInfo,
  SettingsInfo,
  SettingEditorInfo,
  SettingSoundInfo,
  SessionNotificationFelloExt,
  AskUserRequest,
} from "../shared/schema";
import type {
  ChatMessage,
  ToolCallMessage,
  SubagentMessage,
  CompactionMessage,
} from "./lib/chat-message";
import type { UpdaterEvent } from "../electron/updater";
import { ALL_FEATURES } from "../shared/constants";

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

export interface SessionHistorySegment {
  segmentId: number;
  messages: SessionNotificationFelloExt[];
}

// Per-session state bucket
export interface SessionState {
  messages: ChatMessage[];
  isLoading: boolean;
  terminalLogs: Record<string, string>;
  askUserRequests: AskUserRequest[];
  activeToolCalls: Map<string, ToolCallMessage>;
  activeSubagents: Map<string, SubagentMessage>;
  activeCompactions: Map<string, CompactionMessage>;
  pendingNotifications: SessionNotificationFelloExt[];
  /** 已加载的历史分段，按 segmentId 升序保存原始通知以便加载更早记录后重放。 */
  historySegments: SessionHistorySegment[];
  /** 最新历史 segment 快照之后收到的实时通知。 */
  liveHistoryNotifications: SessionNotificationFelloExt[];
  /** 当前已加载历史之前的最近一个 segment；缺失即无更早历史。 */
  previousHistorySegmentId?: number;
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
  activeCompactions: new Map(),
  pendingNotifications: [],
  historySegments: [],
  liveHistoryNotifications: [],
  previousHistorySegmentId: undefined,
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
  /** 右侧 session 面板（文件/终端）是否展开；与 sidebarOpen 一样是全局 UI 状态。 */
  panelOpen: boolean;
  configuredAgents: SettingsInfo["agents"];
  configuredMcpServers: SettingsInfo["mcpServers"];
  features: SettingsInfo["features"];
  theme: SettingsInfo["theme"];
  i18n: SettingsInfo["i18n"];
  fileWatcher: SettingsInfo["fileWatcher"];
  proxy: SettingsInfo["proxy"];
  ilink: SettingsInfo["ilink"];
  assistant: SettingsInfo["assistant"];
  /** All personal assistants (configs), oldest first. */
  assistants: AssistantConfig[];
  /** False until the first listAssistants() response has been applied. */
  assistantsReady: boolean;
  /** Runtime status per assistant, for sidebar row indicators. */
  assistantStatuses: Map<string, AssistantStatus>;
  editor: SettingEditorInfo;
  sound: SettingSoundInfo;
  voiceInput: SettingsInfo["voiceInput"];
  notification: SettingsInfo["notification"];
  snippets: SettingsInfo["snippets"];
  imageGeneration: SettingsInfo["imageGeneration"];
  speechProviders: SettingsInfo["speechProviders"];
  shortcuts: SettingsInfo["shortcuts"];
  /** 外设「生效」开关（列表本身来自 src/shared/peripherals.ts 的内置枚举） */
  peripherals: SettingsInfo["peripherals"];
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
  /**
   * 自动更新的最新状态。由 App.tsx 的统一事件订阅写入，侧边栏升级卡片消费。
   * null 表示当前没有可展示的更新（检查中 / 已是最新 / 出错）。
   */
  updaterEvent: UpdaterEvent | null;

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
  setPanelOpen: (v: boolean) => void;
  setConfiguredAgents: (agents: SettingsInfo["agents"]) => void;
  setConfiguredMcpServers: (mcpServers: SettingsInfo["mcpServers"]) => void;
  setFeatures: (features: SettingsInfo["features"]) => void;
  setTheme: (theme: SettingsInfo["theme"]) => void;
  setI18n: (i18n: SettingsInfo["i18n"]) => void;
  setFileWatcher: (fileWatcher: SettingsInfo["fileWatcher"]) => void;
  setProxy: (proxy: SettingsInfo["proxy"]) => void;
  setIlink: (ilink: SettingsInfo["ilink"]) => void;
  setAssistant: (assistant: SettingsInfo["assistant"]) => void;
  setAssistants: (assistants: AssistantConfig[]) => void;
  setAssistantStatus: (assistantId: string, status: AssistantStatus) => void;
  setEditor: (editor: SettingEditorInfo) => void;
  setSound: (sound: SettingSoundInfo) => void;
  setVoiceInput: (voiceInput: SettingsInfo["voiceInput"]) => void;
  setNotification: (notification: SettingsInfo["notification"]) => void;
  setSnippets: (snippets: SettingsInfo["snippets"]) => void;
  setImageGeneration: (imageGeneration: SettingsInfo["imageGeneration"]) => void;
  setSpeechProviders: (speechProviders: SettingsInfo["speechProviders"]) => void;
  setShortcuts: (shortcuts: SettingsInfo["shortcuts"]) => void;
  setPeripherals: (peripherals: SettingsInfo["peripherals"]) => void;
  setUpdaterEvent: (event: UpdaterEvent | null) => void;
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

type LiveSessionSource = Pick<AppState, "sessions" | "assistants">;

/**
 * 会话桶的存活 id：项目会话 + 个人助理（伪会话）。
 *
 * 助理不在 `sessions` 里，但同样拥有 `sessionStates` 桶；判定存活 / 清理桶时必须一起算，
 * 否则助理的流式通知会被当成「已删除会话」丢弃，历史也写不进去。
 */
export function isLiveSessionId(state: LiveSessionSource, id: string): boolean {
  return (
    state.sessions.some((session) => session.id === id) ||
    state.assistants.some((assistant) => assistant.id === id)
  );
}

/** 同上，集合形式；用于批处理 / 清理时的 O(1) 判断。 */
export function liveSessionIds(state: LiveSessionSource): Set<string> {
  const ids = new Set(state.sessions.map((session) => session.id));
  for (const assistant of state.assistants) ids.add(assistant.id);
  return ids;
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
  panelOpen: true,
  configuredAgents: [],
  configuredMcpServers: [],
  features: [...ALL_FEATURES],
  theme: { themeMode: "system" },
  i18n: { language: "en" },
  fileWatcher: { enabled: true },
  proxy: { mode: "off" },
  ilink: { useOriginalImage: false },
  assistant: { enabled: false, workerTypes: [] },
  assistants: [],
  assistantsReady: false,
  assistantStatuses: new Map(),
  editor: { name: "code" },
  sound: { volume: 50, muted: false, theme: "soft" },
  voiceInput: { altDoublePress: true },
  notification: { askUser: true, reminder: true },
  snippets: [],
  imageGeneration: [],
  speechProviders: [],
  shortcuts: {},
  peripherals: [],
  webUIStatus: { enabled: false, url: null },
  ilinkStatus: { connected: false },
  activeIlinkSessionId: null,
  isMacApp: window.fello?.isMacApp ?? false,
  isWinApp: window.fello?.isWinApp ?? false,
  isFullScreen: false,

  // ==========================================================================
  // 5. Global Caches & Ephemeral State
  // ==========================================================================
  updaterEvent: null,

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
      // 未知 / 已删除 id 不建桶（避免复活旧会话）；会话与个人助理都算存活。
      if (!current && !isLiveSessionId(state, id)) return state;
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
      // 草稿是用户尚未提交的输入，不属于可丢弃的会话运行态：个人助理页面每次挂载都会
      // reset（重新拉取历史），若连草稿一起清空，输入框的暂存就失效了。
      const previous = state.sessionStates.get(sessionId);
      map.set(sessionId, {
        ...emptySessionState(),
        draftInput: previous?.draftInput ?? "",
        draftAttachments: previous?.draftAttachments ?? [],
      });
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
  setPanelOpen: (v) => set({ panelOpen: v }),
  setConfiguredAgents: (agents) => set({ configuredAgents: agents }),
  setConfiguredMcpServers: (mcpServers) => set({ configuredMcpServers: mcpServers }),
  setFeatures: (features) => set({ features }),
  setTheme: (theme) => set({ theme }),
  setI18n: (i18n) => set({ i18n }),
  setFileWatcher: (fileWatcher) => set({ fileWatcher }),
  setProxy: (proxy) => set({ proxy }),
  setIlink: (ilink) => set({ ilink }),
  setAssistant: (assistant) =>
    set({
      assistant: {
        enabled: assistant.enabled ?? false,
        workerTypes: (assistant.workerTypes ?? []).map((type) => ({
          ...type,
          features: type.features ?? [],
          mcpServers: type.mcpServers ?? [],
          instructions: type.instructions ?? "",
          enabled: type.enabled ?? true,
          permissionMode: type.permissionMode ?? "ask",
        })),
      },
    }),
  setAssistants: (assistants) => set({ assistants, assistantsReady: true }),
  setAssistantStatus: (assistantId, status) =>
    set((state) => {
      const map = new Map(state.assistantStatuses);
      map.set(assistantId, status);
      return { assistantStatuses: map };
    }),
  setEditor: (editor) => set({ editor }),
  setSound: (sound) => set({ sound }),
  setVoiceInput: (voiceInput) => set({ voiceInput }),
  setNotification: (notification) => set({ notification }),
  setSnippets: (snippets) => set({ snippets }),
  setImageGeneration: (imageGeneration) => set({ imageGeneration }),
  setSpeechProviders: (speechProviders) => set({ speechProviders }),
  setShortcuts: (shortcuts) => set({ shortcuts }),
  setPeripherals: (peripherals) => set({ peripherals }),
  setUpdaterEvent: (event) => set({ updaterEvent: event }),
  setWebUIStatus: (status) => set({ webUIStatus: status }),
  setIlinkStatus: (status) => set({ ilinkStatus: status }),
  setActiveIlinkSessionId: (sessionId) => set({ activeIlinkSessionId: sessionId }),
  setIsFullScreen: (v) => set({ isFullScreen: v }),
}));

// Selector: derive current session's state for use in components
export function useSessionState(sessionId: string | null) {
  // 惰性初始化出稳定的空状态兜底对象（每个组件实例只创建一次，selector 需要稳定引用）
  const [fallback] = useState(emptySessionState);
  return useAppStore((s) => (sessionId ? s.sessionStates.get(sessionId) : undefined) ?? fallback);
}

export function useProjectState(projectId: string | null) {
  // 惰性初始化出稳定的空状态兜底对象（每个组件实例只创建一次，selector 需要稳定引用）
  const [fallback] = useState(emptyProjectState);
  return useAppStore((s) => (projectId ? s.projectStates.get(projectId) : undefined) ?? fallback);
}
