import type {
  SessionNotification,
  InitializeResponse,
  ContentBlock,
  Usage,
  UsageUpdate,
  AvailableCommand,
} from "@agentclientprotocol/sdk";

export type SubagentStatus = "pending" | "in_progress" | "completed" | "failed";
export type SubagentUpdate = {
  sessionId: string;
  name?: string;
  prompt?: string;
  status?: SubagentStatus;
};

export type AddonSessionUpdate = SubagentUpdate & { sessionUpdate: "subagent_update" };

/**
 * 扩展 SessionNotification 结构
 * 包含 Fello 注入的元数据，用于前后端消息去重、时间戳等功能
 */
export interface SessionNotificationFelloExt extends SessionNotification {
  update: SessionNotification["update"] & {
    /** ACP 原始元数据的扩展槽位 */
    _meta?: SessionNotification["update"]["_meta"] & {
      fello?: {
        /** 前端接收该消息的本地时间戳（毫秒） */
        receivedAt: number;
        /** 前端用于渲染与去重的稳定显示 ID */
        displayId: string;
        /** 只有 sessionUpdate=session_info_update 才有，属于自定义事件 */
        update?: AddonSessionUpdate;
      };
    };
  };
}

/**
 * 持久化的一次 Prompt token 用量记录。
 * 由 API Agent 在 prompt 完成后写入 token-usage.jsonl，并通过 IPC 返回给前端。
 */
export interface SessionTokenUsage {
  timestamp: number;
  usage: SessionTokenUsageData;
}

/** ACP Usage 的 Fello 扩展，包含本地计算的 token breakdown。 */
export type SessionTokenUsageData = Omit<Usage, "_meta"> & {
  _meta?: {
    [key: string]: unknown;
    fello?: {
      tokenBreakdown?: SessionTokenBreakdown;
    };
  } | null;
};

export interface SessionTokenBreakdown {
  stepCount: number;
  inputComposition: SessionTokenInputComposition;
  steps: SessionTokenStep[];
  performance: SessionTokenPerformance;
}

export interface SessionTokenInputComposition {
  systemPrompt: number;
  toolsDefinition: SessionTokenToolsDefinition;
  history: number;
  userMessage: number;
  /** 本轮用户消息的文本内容（序列化后），用于展示与排查。 */
  userMessageText: string;
  estimatedTotal: number;
  delta: number;
}

export interface SessionTokenToolsDefinition {
  total: number;
  perTool: SessionTokenToolDefinition[];
}

export interface SessionTokenToolDefinition {
  name: string;
  tokens: number;
}

export interface SessionTokenStep {
  stepNumber: number;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  inputDetails: SessionTokenInputDetails;
  outputDetails: SessionTokenOutputDetails;
  toolCalls: SessionTokenToolCall[];
  performance: SessionTokenStepPerformance;
}

export interface SessionTokenInputDetails {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  noCacheTokens?: number;
}

export interface SessionTokenOutputDetails {
  textTokens?: number;
  reasoningTokens?: number;
}

export interface SessionTokenToolCall {
  toolName: string;
  /** 工具调用参数（序列化后的 JSON 字符串），用于展示与排查。 */
  args: string;
  argumentsOutputTokens: number;
  resultInputTokens: number;
  executionMs?: number;
}

export interface SessionTokenStepPerformance {
  stepTimeMs: number;
  responseTimeMs: number;
  timeToFirstOutputMs?: number;
  outputTokensPerSecond?: number;
}

export interface SessionTokenPerformance {
  totalTimeMs: number;
  effectiveOutputTokensPerSecond: number;
}

export interface ModelInfo {
  /**
   * Optional description of the model.
   */
  description?: string | null;
  /**
   * Unique identifier for the model.
   */
  modelId: string;
  /**
   * Human-readable name of the model.
   */
  name: string;
}

export interface SessionModelState {
  /**
   * The set of models that the Agent can use
   */
  availableModels: ModelInfo[];
  /**
   * The current model the Agent is in.
   */
  currentModelId: string;
}

export interface ModeInfo {
  description?: string | null;
  id: string;
  name: string;
}

export interface SessionModeState {
  /**
   * The set of modes that the Agent can operate in
   */
  availableModes: ModeInfo[];
  /**
   * The current mode the Agent is in.
   */
  currentModeId: string;
}

export interface ThoughtLevelInfo {
  description?: string | null;
  id: string;
  name: string;
}

export interface SessionThoughtLevelState {
  availableThoughtLevels: ThoughtLevelInfo[];
  currentThoughtLevelId: string;
}

/**
 * 代理（Agent）的配置信息
 * 描述了如何启动或连接到一个特定的代理
 */
export interface BaseAgentInfo {
  /**
   * 代理的唯一标识符
   * 数据来源：用户在全局设置（Settings -> Agents）中手动输入（例如："kiro"）。
   */
  id: string;
  /** 是否停用代理 */
  disabled: boolean;
}

export interface StdioAgentInfo extends BaseAgentInfo {
  /** 通过本地命令行进程启动代理 */
  type: "stdio";
  /** 启动该代理的命令（例如：'kiro-cli' 等命令行工具，或 'node', 'python' 等执行器） */
  command: string;
  /** 传递给启动命令的参数列表（例如：['acp'] 或 ['--port', '8080'] 等） */
  args: string[];
  /** 运行该代理时需要的环境变量字典 */
  env: Record<string, string>;
}

export interface ApiAgentInfo extends BaseAgentInfo {
  /** 通过远程 HTTP API 连接代理 */
  type: "api";
  /** API 兼容层提供商标识（可扩展） */
  provider: "openai-compatible" | (string & {});
  /** API 服务基础地址 */
  baseUrl: string;
  /** API 鉴权密钥 */
  apiKey: string;
  /** 可选的额外请求头（如组织 ID、自定义鉴权等） */
  headers?: Record<string, string>;
  /**
   * 模型上下文窗口大小（token 数），如 128000、200000 等。
   * 用于 usage_update 通知中的 context window 展示。
   * 如果留空，则使用默认值 128000。
   */
  contextWindowTokens?: number;
  /**
   * 自定义模型 ID 模版，使用 {} 引用 API 返回的字段。
   * 例如："{owned_by}/{id}" 会生成 "openai/gpt-4"。
   * 如果设置且非空，则使用模版拼接 modelId；否则直接使用 API 返回的 id。
   */
  modelIdTemplate?: string;
  /**
   * 用户手动指定的模型列表（每行一个模型 ID）。
   * 如果填写则直接使用该列表，不再调用 /models 接口。
   * 如果为空则回退到 /models 接口自动获取。
   */
  models?: string[];
}

/** 代理配置联合类型：本地 stdio / 远程 api */
export type AgentInfo = StdioAgentInfo | ApiAgentInfo;

/**
 * 通用 askUser 请求中的选项
 */
export interface AskUserRequestOption {
  value: string;
  label: string;
  priority: "high" | "medium" | "low";
  danger?: boolean;
}

/**
 * 通用 askUser 请求：后端发送给前端的事件载荷
 * 包含 `askUserId`，前端据此将用户响应关联到具体请求。
 */
export interface AskUserRequest {
  sessionId: string;
  /** 请求的唯一标识，由后端自动生成 */
  askUserId: string;
  title: string;
  description: string;
  options: AskUserRequestOption[];
  /** 是否允许用户输入自定义回复（显示 "其他" 按钮），默认 true */
  allowCustomInput?: boolean;
  /** 请求的超时时间戳（毫秒）。超时后后端自动以 timeout 结束请求；前端可用于倒计时展示 */
  timeoutAt?: number;
}

/**
 * 通用 askUser 响应：后端发送给前端的事件载荷（用于移除队列中的请求）
 */
export interface AskUserResponse {
  sessionId: string;
  askUserId: string;
  value: string | null;
  reason: string | null;
}

/**
 * MCP 服务器的通用配置信息
 */
export interface BaseMcpServerInfo {
  /** MCP 服务器的唯一标识符 */
  id: string;
  /** 是否停用该 MCP 服务器 */
  disabled: boolean;
}

export interface StdioMcpServerInfo extends BaseMcpServerInfo {
  /** 通过本地命令行进程启动 MCP Server */
  type: "stdio";
  /** 启动 MCP Server 的命令 */
  command: string;
  /** 传递给命令的参数列表 */
  args: string[];
  /** 启动进程时附加的环境变量 */
  env: Record<string, string>;
}

export interface HttpMcpServerInfo extends BaseMcpServerInfo {
  /** 通过 HTTP(S) 连接 MCP Server */
  type: "http";
  /** MCP Server 的 HTTP 地址 */
  url: string;
  /** 请求 MCP Server 时附加的请求头 */
  headers: Record<string, string>;
}

export interface SseMcpServerInfo extends BaseMcpServerInfo {
  /** 通过 SSE 连接 MCP Server */
  type: "sse";
  /** MCP Server 的 SSE 端点地址 */
  url: string;
  /** 建立 SSE 连接时附加的请求头 */
  headers: Record<string, string>;
}

/** MCP Server 配置联合类型：stdio / http / sse */
export type McpServerInfo = StdioMcpServerInfo | HttpMcpServerInfo | SseMcpServerInfo;

/** 会话级别的 feature 枚举 */
export type Feature =
  | "skills"
  | "ask_user"
  | "share_to_user"
  | "search"
  | "memory"
  | "image_generation";

/**
 * 应用的主题配置信息
 */
export interface SettingThemeInfo {
  /** 主题模式：'light'（浅色）、'dark'（深色）或 'system'（跟随系统） */
  themeMode: "light" | "dark" | "system";
}

/**
 * 应用的国际化（i18n）配置信息
 */
export interface SettingI18nInfo {
  /** 当前使用的语言代码（例如：'en', 'zh-CN'） */
  language: string;
}

/**
 * 文件监听配置信息
 */
export interface SettingFileWatcherInfo {
  /** 是否启用自动监听项目文件变更 */
  enabled: boolean;
}

export interface SettingILinkInfo {
  /** 是否使用原图（默认 false，使用缩略图以节省 token） */
  useOriginalImage: boolean;
}

/**
 * 编辑器配置信息
 */
export interface SettingEditorInfo {
  /** 编辑器标识（传给 launch-editor 的值），如 'code', 'cursor', 'code-insiders', 'zed', 'webstorm' 等 */
  name: string;
}

/**
 * 音效配置信息
 */
export interface SettingSoundInfo {
  /** 音量 0-100 */
  volume: number;
  /** 是否静音 */
  muted: boolean;
  /** 音效风格 */
  theme: "soft" | "crisp";
}

/**
 * 网络代理配置信息
 */
export interface SettingProxyInfo {
  /**
   * 代理模式：
   * - 'off'：直连，不使用代理
   * - 'manual'：手动指定代理服务器
   * - 'system'：跟随系统代理（macOS/Windows 系统设置，或环境变量）
   */
  mode: "off" | "manual" | "system";
  /** HTTP 代理地址，如 http://127.0.0.1:7890（仅 manual 模式使用） */
  httpProxy?: string;
  /** HTTPS 代理地址，如 http://127.0.0.1:7890（仅 manual 模式使用，缺省时回退到 httpProxy） */
  httpsProxy?: string;
  /** 不走代理的地址列表，逗号分隔（如 localhost,127.0.0.1,*.internal） */
  noProxy?: string;
  /** 代理认证用户名（可选） */
  username?: string;
  /** 代理认证密码（可选） */
  password?: string;
}

/**
 * Snippet 配置信息
 */
export interface SnippetInfo {
  /** Snippet 唯一标识符 */
  id: string;
  /** Snippet 标题 */
  title: string;
  /** Snippet 内容 */
  content: string;
}

/**
 * 图片生成 Provider 配置信息
 */
export interface ImageGenerationProviderInfo {
  /** Provider 唯一标识符 */
  id: string;
  /** 用户自定义名称，如 "OpenAI GPT-Image" */
  name: string;
  /** Provider 类型，目前只支持 openai-compatible */
  provider: "openai-compatible";
  /** API 基础地址，如 https://api.openai.com/v1 */
  baseUrl: string;
  /** API 鉴权密钥 */
  apiKey: string;
  /** 可选的额外请求头（如组织 ID、自定义鉴权等） */
  headers?: Record<string, string>;
  /** 可选的额外请求体参数（如 quality、watermark_enabled 等厂商特有参数） */
  extraBody?: Record<string, unknown>;
  /** 模型标识，如 gpt-image-2 */
  model: string;
  /** 是否激活 */
  active: boolean;
}

/**
 * 实时语音识别 Provider 配置。凭据只在主进程中使用，渲染层仅通过 IPC 读取设置。
 */
export interface SpeechToTextProviderInfo {
  id: string;
  name: string;
  provider: "volcengine" | "dashscope" | "openai" | "iflytek";
  apiKey: string;
  appId?: string;
  apiSecret?: string;
  resourceId?: string;
  model?: string;
  baseUrl?: string;
  workspaceId?: string;
  region?: "cn-beijing" | "ap-southeast-1";
  workspace?: string;
  language?: string;
  active: boolean;
}

/**
 * 应用的全局设置信息
 */
export interface SettingsInfo {
  /** 已配置的代理列表 */
  agents: AgentInfo[];
  /** MCP 服务器配置 */
  mcpServers: McpServerInfo[];
  /** 主题设置 */
  theme: SettingThemeInfo;
  /** 国际化（语言）设置 */
  i18n: SettingI18nInfo;
  /** 文件监听开关：是否自动监听项目文件变更 */
  fileWatcher: SettingFileWatcherInfo;
  /** iLink 相关设置 */
  ilink: SettingILinkInfo;
  /** 编辑器设置 */
  editor: SettingEditorInfo;
  /** 音效设置 */
  sound: SettingSoundInfo;
  /** 网络代理设置 */
  proxy: SettingProxyInfo;
  /** Snippets 列表 */
  snippets: SnippetInfo[];
  /** 图片生成 Provider 列表 */
  imageGeneration: ImageGenerationProviderInfo[];
  /** 实时语音识别 Provider 列表 */
  speechToText: SpeechToTextProviderInfo[];
}

/**
 * 项目信息
 * 代表用户在应用中管理的一个代码项目或工作区
 */
export interface ProjectInfo {
  /**
   * 项目的唯一标识符
   * 数据来源：项目工作目录的 SHA1 哈希值（`createHash("sha1").update(cwd).digest("hex")`）
   */
  id: string;
  /** 项目的显示名称（默认取 cwd 的 basename） */
  title: string;
  /** 项目的当前工作目录（绝对路径） */
  cwd: string;
  /** 项目的创建时间（毫秒级时间戳，如 Date.now()） */
  createdAt: number;
}

/**
 * 会话信息
 * 代表用户与代理之间的一次交互会话
 */
export interface SessionInfo {
  /**
   * 会话的唯一标识符
   * 数据来源：`${agentId}:${resumeId}`
   * 主要用于前端 UI 路由和列表区分
   */
  id: string;
  /** 会话的显示标题（默认：'New Chat'） */
  title: string;
  /** 会话当前的工作目录 */
  cwd: string;
  /** 关联的项目 ID（对应 ProjectInfo.id） */
  projectId: string;
  /** 关联的项目名称 */
  projectTitle: string;
  /**
   * 该会话使用的代理 ID
   * 数据来源：来自 settings.json 中用户配置的 SettingAgentInfo.id
   */
  agentId: string;
  /**
   * 用于恢复历史会话的 ID
   * 数据来源：来自底层的 ACP 服务进程，由 `newSession` 接口返回。
   * ⚠️ 关键警告：在与底层 ACP 服务（Agent 进程）交互时，必须传入此 `resumeId`！
   * 因为 ACP 接口声明中的参数通常命名为 `sessionId`，很容易与 Fello 自身的 `session.id` 混淆。
   * 切记：ACP 侧的 sessionId === Fello 侧的 session.resumeId
   */
  resumeId: string;
  /** 会话的创建时间（毫秒级时间戳，如 Date.now()） */
  createdAt: number;
  /** 会话的最后更新时间（毫秒级时间戳，如 Date.now()） */
  updatedAt: number;
  /**
   * 当前会话使用的 MCP 服务器 ID 列表
   */
  mcpServers: string[];
  /** 当前会话启用的 feature 列表（如 "ask_user"） */
  features: Feature[];
  /** 权限策略：每次询问（ask）或默认全部允许（allow-all） */
  permissionMode: "ask" | "allow-all";
  /** 缓存的 Model 配置状态，用于离线降级恢复 */
  models: SessionModelState | null;
  /** 缓存的 Mode 配置状态，用于离线降级恢复 */
  modes: SessionModeState | null;
  /** 缓存的 ThoughtLevel 配置状态 */
  thoughtLevels: SessionThoughtLevelState | null;
  /** 缓存的代理初始化信息 */
  initializeInfo: InitializeResponse | null;
  /** 当前 Agent 为该会话提供的命令；仅在运行时缓存，不持久化。 */
  availableCommands: AvailableCommand[];
  /** 当前上下文窗口用量；仅在运行时缓存，不持久化。 */
  usage: UsageUpdate | null;
  /** 最近一次完成请求的 token 用量；仅在运行时缓存，不持久化。 */
  lastTurnUsage: Usage | null;
  /** 是否在输出中 */
  isStreaming: boolean;
  /** 后端 agent-bridge 连接状态 */
  connectionStatus: "disconnected" | "connecting" | "connected";
}

/**
 * Web UI 的运行状态
 */
export interface WebUIStatus {
  /** Web UI 服务是否已启用/正在运行 */
  enabled: boolean;
  /** Web UI 的访问地址（如果已启动） */
  url: string | null;
}

/**
 * ILink 的运行状态
 */
export interface ILinkStatus {
  /** iLink 当前是否已完成连接 */
  connected: boolean;
  /** 当前连接用户 ID（已登录时提供） */
  userId?: string;
  /** 当前连接账号 ID（已登录时提供） */
  accountId?: string;
  /** 登录二维码地址（待登录/重连时可能提供） */
  qrcodeUrl?: string;
  /** 最近一次连接错误信息 */
  error?: string;
}

/** iLink 二维码状态机 */
export type IlinkQrcodeState = "wait" | "scaned" | "confirmed" | "expired";

/** Prompt 结束原因 */
export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

/**
 * Skill 的基本信息
 */
export interface SkillInfo {
  /** Skill 作用域来源 */
  scope: "agents" | "claude" | "fello";
  /** 安装级别：用户级 / 项目级 */
  level: "user" | "project";
  /** Skill 显示名称 */
  name: string;
  /** Skill 描述信息 */
  description: string;
  /** Skill 唯一标识符 */
  id: string;
}

// ── Automation Types ─────────────────────────────────────────────────

/**
 * 调度（Schedule）：一个自动化的配置项，包含 cron/once 触发规则和 agent prompt
 */
export interface Schedule {
  /** 调度的唯一标识符 */
  id: string;
  /** 调度显示名称 */
  name: string;
  /** 使用的 Agent ID */
  agentId: string;
  /** 使用的模型 ID（可选，留空则使用 Agent 默认模型） */
  modelId?: string;
  /** Agent 执行的 Prompt 内容 */
  prompt: string;
  /** 调度配置 */
  cron: {
    /** 调度类型：cron 定时 or once 单次 */
    type: "cron" | "manual";
    /** 5 段式 cron 表达式（分 时 日 月 周），仅在 type='cron' 时有效 */
    expr?: string;
  };
  /** 创建时间（毫秒时间戳） */
  createdAt: number;
  /** 更新时间（毫秒时间戳） */
  updatedAt: number;
  /** 上次执行时间（毫秒时间戳） */
  lastRunAt: number | null;
  /** 下次执行时间（运行时计算，不持久化） */
  nextRunAt?: number | null;
  /** 启用的 feature 列表（ask_user 在 automation 中始终为 false） */
  features: Feature[];
  /** 使用的 MCP 服务器 ID 列表 */
  mcpServers: string[];
}

/**
 * 任务（Task）：调度每次触发产生的一次执行记录
 */
export interface Task {
  /** 任务的唯一标识（基于时间戳） */
  id: string;
  /** 所属调度 ID */
  scheduleId: string;
  /** 任务开始时间（毫秒时间戳） */
  startedAt: number;
  /** 任务完成时间（毫秒时间戳） */
  completedAt: number | null;
  /** 任务状态 */
  status: "running" | "success" | "error";
  /** 错误信息（可选） */
  error?: string;
}

/**
 * 进程间通信（IPC）的请求定义
 * 包含从前端（Renderer/Web）发送到后端（Main）的所有方法及其参数和返回值类型
 */
export type FelloIPCRequests = {
  /** 获取全局设置 */
  getSettings: { params: void; response: SettingsInfo };
  /** 更新全局设置 */
  updateSettings: { params: Partial<SettingsInfo>; response: void };

  /** 启动 Web UI 服务 */
  startWebUIServer: { params: { port?: number; token?: string }; response: WebUIStatus };
  /** 停止 Web UI 服务 */
  stopWebUIServer: { params: void; response: WebUIStatus };
  /** 获取当前 Web UI 服务的状态 */
  getWebUIStatus: { params: void; response: WebUIStatus };

  /** 获取所有已安装的 Skills */
  getSkillsCatalog: {
    params: { all?: boolean; projectId?: string };
    response: SkillInfo[];
  };
  /** 读取 Skill 文件内容 */
  readSkillFile: { params: { skillId: string; projectId?: string }; response: string };
  /** 获取 Skill 的本地文件系统路径 */
  getSkillFileSystemFilePath: { params: { skillId: string; projectId?: string }; response: string };
  /** 卸载 Skill */
  uninstallSkill: { params: { skillId: string; projectId?: string }; response: void };
  /** 搜索在线 Skills */
  searchSkillsFromSkillsSh: {
    params: { query: string };
    response: Array<{ name: string; source: string; installs: number; skillId: string }>;
  };
  /** 下载并安装 Skill */
  installSkillFromSkillsSh: { params: { source: string; slug: string }; response: void };

  /** 获取所有会话列表 */
  listSessions: { params: void; response: SessionInfo[] };
  /** 获取所有项目列表 */
  listProjects: { params: void; response: ProjectInfo[] };
  /** 添加新项目（通常通过选择目录） */
  addProject: { params: string; response: ProjectInfo };
  /** 重命名项目 */
  renameProject: { params: { projectId: string; title: string }; response: void };
  /** 删除项目 */
  deleteProject: { params: string; response: void };

  /** 创建新会话 */
  newSession: {
    params: {
      projectId: string;
      agentId: string;
      mcpServers?: string[];
      features?: Feature[];
      permissionMode?: "ask" | "allow-all";
    };
    response: {
      /** Fello 侧的会话唯一标识 */
      sessionId: string;
      /** 代理的初始化信息（如支持的能力、名称、版本等） */
      initializeInfo: InitializeResponse | null;
      /** 该会话当前可用的模型状态（列表及选中项） */
      models: SessionModelState | null;
      /** 该会话当前可用的模式状态（列表及选中项） */
      modes: SessionModeState | null;
      /** 该会话当前可用的思考级别状态 */
      thoughtLevels: SessionThoughtLevelState | null;
    };
  };
  /** 加载已有会话 */
  loadSession: {
    params: { sessionId: string; force?: boolean };
    response: {
      /** Fello 侧的会话唯一标识 */
      sessionId: string;
      /** 代理的初始化信息（如支持的能力、名称、版本等） */
      initializeInfo: InitializeResponse | null;
      /** 该会话当前可用的模型状态（列表及选中项） */
      models: SessionModelState | null;
      /** 该会话当前可用的模式状态（列表及选中项） */
      modes: SessionModeState | null;
      /** 该会话当前可用的思考级别状态 */
      thoughtLevels: SessionThoughtLevelState | null;
    };
  };
  /** 获取会话历史记录 */
  getSessionHistory: {
    params: { sessionId: string };
    response: {
      messages: SessionNotificationFelloExt[];
    };
  };
  /** 获取会话 token 使用记录 */
  getSessionTokenUsage: {
    params: { sessionId: string };
    response: {
      records: SessionTokenUsage[];
    };
  };
  /** 向会话发送用户 Prompt */
  sendPrompt: {
    params: {
      sessionId: string;
      contents: ContentBlock[];
    };
    response: { stopReason: string; usage?: Usage | null | undefined };
  };
  /** 取消当前正在生成的回答/任务 */
  cancelPrompt: { params: { sessionId: string }; response: void };

  /** 开始一次实时语音识别会话 */
  startRealtimeAsr: {
    params: { clientId: string; asrSessionId: string };
    response: { ok: boolean };
  };
  /** 发送一帧 Base64 编码的 16-bit PCM 音频 */
  sendRealtimeAsrFrame: {
    params: { clientId: string; asrSessionId: string; audioB64: string };
    response: void;
  };
  /** 停止一次实时语音识别会话 */
  stopRealtimeAsr: {
    params: { clientId: string; asrSessionId: string };
    response: void;
  };

  /** 响应通用 askUser 请求（支持自定义选项） */
  respondAskUser: {
    params: { sessionId: string; askUserId: string; value: string | null; reason?: string };
    response: void;
  };
  /** 获取指定 session 中所有 pending 的 askUser 请求（用于窗口重连后恢复） */
  getPendingAskUserRequests: {
    params: { sessionId: string };
    response: AskUserRequest[];
  };
  /** 更新会话属性（title / mcpServers / features 等） */
  updateSession: {
    params: { sessionId: string } & Partial<Pick<SessionInfo, "title" | "mcpServers" | "features">>;
    response: void;
  };
  /** 更改会话的工作目录 */
  changeWorkDir: {
    params: { sessionId: string };
    response: { ok: boolean; cwd: string | null };
  };
  /** 将文件复制到当前会话的工作目录 */
  copyFileToWorkspace: {
    params: { projectId: string; sourcePath: string; destDir?: string };
    response: { success: boolean; destPath: string };
  };
  /** 读取 URL (本地文件或 http 链接) 并转换为 Base64 (Data URL) */
  readUrlAsDataUrl: {
    params: { url: string; mimeType?: string };
    response: string;
  };
  /** 关闭会话及其 Agent bridge，但保留本地会话和历史记录 */
  closeSession: { params: { sessionId: string }; response: void };
  /** 删除会话 */
  deleteSession: { params: string; response: void };
  /** 获取会话存储目录的绝对路径 */
  getSessionDataSystemPath: { params: { sessionId: string }; response: string | null };
  /** 重置 Agent：关闭其所有会话并清理 bridge，不删除持久化数据 */
  resetAgent: { params: { agentId: string }; response: void };
  /** 清理 Agent 的所有会话（关闭 bridge 会话 + 删除本地数据 + 停 socket 服务），不删除 Agent 配置 */
  clearAgentSessions: { params: { agentId: string }; response: { deletedSessionIds: string[] } };
  /**
   * 获取系统文件路径
   * 该接口专门用于获取底层操作系统真实的路径（包含原生路径分隔符如 `\` 或 `/`）。
   * 其他涉及项目内文件的相对路径接口（如 searchFiles, readDir 等）均统一返回 POSIX 风格路径（`/`）。
   */
  getSystemFilePath: {
    params: { projectId: string; path: string; isAbsolute?: boolean };
    response: string;
  };

  /** 获取当前会话可用的模型状态 */
  getModels: {
    params: { sessionId: string };
    response: SessionModelState | null;
  };
  /** 设置当前会话使用的模型 */
  setModel: { params: { sessionId: string; modelId: string }; response: void };

  /** 获取当前会话可用的模式状态 */
  getModes: {
    params: { sessionId: string };
    response: SessionModeState | null;
  };
  /** 设置当前会话使用的工作模式 */
  setMode: { params: { sessionId: string; modeId: string }; response: void };

  /** 获取当前会话可用的思考级别状态 */
  getThoughtLevels: {
    params: { sessionId: string };
    response: SessionThoughtLevelState | null;
  };
  /** 设置当前会话使用的思考级别 */
  setThoughtLevel: { params: { sessionId: string; thoughtLevelId: string }; response: void };

  /**
   * 搜索项目中的文件
   * 注意：为了保证跨平台的稳定匹配，前端发送的 `query` 在底层会被标准化为 POSIX 路径（`/` 分隔）。
   * 返回的 `id` 统一为 POSIX 相对路径，用于组件间传递及 API 调用。
   * 返回的 `filename` 保持原生操作系统的相对路径分隔符，专门用于 UI 展示。
   */
  searchFiles: {
    params: { projectId: string; query?: string };
    response: Array<{ id: string; filename: string; isFolder: boolean }>;
  };
  /**
   * 读取目录内容
   * 返回的节点 `id` 统一为 POSIX 风格的相对路径，用于保证多平台的一致性。
   * 每个节点带 `ignored` 标记：被 .gitignore 排除时为 true（前端用于置灰展示）。
   */
  readDir: {
    params: { projectId: string; relativePath?: string };
    response: { id: string; name: string; isFolder: boolean; ignored: boolean }[];
  };
  /** 创建新文件或文件夹 */
  createFile: {
    params: { projectId: string; relativePath: string; isFolder: boolean };
    response: void;
  };
  /** 删除文件或文件夹 */
  deleteFile: { params: { projectId: string; relativePath: string }; response: void };
  /** 获取当前操作系统平台（如 'win32', 'darwin', 'linux'） */
  getPlatform: { params: void; response: string };
  /** 重命名文件或文件夹 */
  renameFile: {
    params: { projectId: string; oldRelativePath: string; newRelativePath: string };
    response: void;
  };
  /** 移动文件或文件夹 */
  moveFile: {
    params: { projectId: string; oldRelativePath: string; newRelativePath: string };
    response: void;
  };
  /** 读取文件内容 */
  readFile: {
    params: { projectId: string; relativePath: string; encoding?: "utf8" | "base64" };
    response: string;
  };
  /** 写入文件内容（UTF-8 文本） */
  writeFile: {
    params: { projectId: string; relativePath: string; content: string };
    response: void;
  };
  /** 获取文件元信息（大小、是否为文件、是否为二进制等） */
  getFileInfo: {
    params: { projectId: string; relativePath: string };
    response: { size: number; isFile: boolean; isBinary: boolean } | null;
  };
  /** 写入外部文件到项目中 */
  writeExternalFile: {
    params: { projectId: string; fileName: string; base64: string; destRelativeDir?: string };
    response: void;
  };

  /** 注册客户端 */
  registerClient: { params: { clientId: string }; response: void };

  /** 创建终端实例 */
  createTerminal: {
    params: { projectId: string; cwd?: string; cols?: number; rows?: number; clientId?: string };
    response: { terminalId: string };
  };
  /** 向终端写入数据（如用户输入） */
  writeTerminal: {
    params: { terminalId: string; data: string };
    response: { ok: boolean };
  };
  /** 根据客户端 ID 批量销毁其创建的所有终端 */
  killTerminalsByClient: {
    params: { clientId: string };
    response: { terminalIds: string[] };
  };
  /** 终止并销毁终端 */
  killTerminal: {
    params: { terminalId: string };
    response: { terminalId?: string };
  };
  /** 调整终端尺寸 */
  resizeTerminal: {
    params: { terminalId: string; cols: number; rows: number };
    response: { ok: boolean };
  };
  /** 获取代理专属终端的输出内容 */
  getAgentTerminalOutput: { params: { sessionId: string; terminalId: string }; response: string };
  /** 终止指定的代理专属终端（SIGTERM），用于停止卡住的 Shell 工具调用 */
  killAgentTerminal: { params: { sessionId: string; terminalId: string }; response: void };

  /**
   * 获取项目目录下的 Git 状态（当前分支、文件变更等）
   * 返回的 `files` 对象的 key 均为统一转换为 POSIX 风格的相对路径。
   */
  getGitStatus: {
    params: { projectId: string; cwd?: string };
    response: { branch: string; files: Record<string, string> } | null;
  };
  /** 读取 Git HEAD 指针下的文件内容（用于对比差异） */
  readGitHeadFile: {
    params: { projectId: string; relativePath: string; encoding?: "utf8" | "base64" };
    response: string;
  };

  /** iLink: 获取连接状态 */
  getIlinkStatus: {
    params: void;
    response: {
      connected: boolean;
      userId?: string;
      accountId?: string;
      qrcodeUrl?: string;
      error?: string;
    };
  };
  /** iLink: 开始登录流程，返回二维码 */
  startIlinkLogin: {
    params: void;
    response: { qrcode: string; qrcodeImgUrl: string };
  };
  /** iLink: 轮询扫码状态 */
  pollIlinkQrcode: {
    params: { qrcode: string };
    response: { status: IlinkQrcodeState };
  };
  /** iLink: 断开连接 */
  stopIlink: {
    params: { logout: boolean };
    response: void;
  };
  /** iLink: 设置活跃 session（传空字符串清除） */
  setActiveIlinkSession: {
    params: { sessionId: string };
    response: void;
  };
  /** iLink: 获取当前活跃 session ID */
  getActiveIlinkSession: {
    params: void;
    response: { sessionId: string | null };
  };

  // ── Automation IPC ────────────────────────────────────────────────

  /** 获取服务端时区 */
  getServerTimezone: {
    params: void;
    response: string;
  };
  /** 获取所有调度列表 */
  listSchedules: {
    params: void;
    response: Schedule[];
  };
  /** 创建调度 */
  createSchedule: {
    params: {
      name: string;
      agentId: string;
      modelId?: string;
      prompt: string;
      cron: { type: "cron" | "manual"; expr?: string };
      features?: Feature[];
      mcpServers?: string[];
    };
    response: Schedule;
  };
  /** 更新调度 */
  updateSchedule: {
    params: { scheduleId: string; updates: Partial<Omit<Schedule, "id" | "createdAt">> };
    response: Schedule;
  };
  /** 删除调度 */
  deleteSchedule: {
    params: { scheduleId: string };
    response: void;
  };
  /** 手动立即触发调度 */
  triggerSchedule: {
    params: { scheduleId: string };
    response: Task;
  };
  /** 获取调度的任务历史 */
  getTasks: {
    params: { scheduleId: string };
    response: Task[];
  };
  /** 获取调度某次任务生成的文件列表 */
  getTaskFiles: {
    params: { scheduleId: string; taskId: string };
    response: string[];
  };
  /** 读取调度某次任务生成的文件内容 */
  readTaskFile: {
    params: { scheduleId: string; taskId: string; filePath: string; encoding?: "base64" };
    response: string;
  };
  /** 删除调度某次任务及其文件 */
  deleteTask: {
    params: { scheduleId: string; taskId: string };
    response: void;
  };
  /** 获取调度某次任务文件的系统绝对路径 */
  getTaskFileSystemPath: {
    params: { scheduleId: string; taskId: string; filePath: string };
    response: string;
  };

  /** 获取 shareToUser 文件的系统绝对路径 */
  getShareFileSystemPath: {
    params: { sessionId: string; sharePath: string };
    response: string;
  };

  // ── Memory ─────────────────────────────────────────────────────────
  /** 获取指定项目的记忆条目 */
  getMemory: {
    params: { projectId: string };
    response: {
      version: number;
      entries: Array<{ id: string; weight: number; text: string; date: string; tags: string[] }>;
    } | null;
  };
  /** 删除指定项目的单条记忆条目（按运行时派生的条目 ID） */
  deleteMemoryEntry: {
    params: { projectId: string; entryId: string };
    response: boolean;
  };
  /** 清除指定项目的记忆（删除 memory.json） */
  clearMemory: {
    params: { projectId: string };
    response: void;
  };
  /** 获取指定项目 memory.json 的系统文件路径 */
  getMemorySystemFilePath: {
    params: { projectId: string };
    response: string | null;
  };
};

/**
 * 进程间通信（IPC）的事件定义
 * 包含从后端（Main）推送到前端（Renderer/Web）的所有事件及其载荷类型
 */
export type FelloIPCEvents = {
  /** 单个会话配置或元数据发生变更时触发（如改名、切换模型），用于前端进行原子级 UI 更新 */
  "session-changed": { session: SessionInfo };
  /** 会话状态更新的事件（如消息流、状态变更等） */
  "session-update": { sessionId: string; notification: SessionNotificationFelloExt };
  /** 通用 askUser 请求事件（替换 permission-request） */
  "ask-user-request": AskUserRequest;
  /** 通用 askUser 响应事件（替换 permission-resolved） */
  "ask-user-response": AskUserResponse;
  /** 终端输出数据的事件 */
  "terminal-output": { terminalId: string; data: string };
  /** 终端退出的事件 */
  "terminal-exit": { terminalId: string; exitCode: number | null };
  /** 代理专属终端输出数据的事件 */
  "agent-terminal-output": { sessionId: string; terminalId: string; data: string };
  /** Web UI 服务状态变更的事件 */
  "webui-status-changed": { status: WebUIStatus };
  /** iLink 连接状态变更的事件 */
  "ilink-status-changed": { status: ILinkStatus };
  /** iLink 活跃 session 变更的事件 */
  "ilink-active-session-changed": { sessionId: string | null };
  /**
   * 项目列表发生变更的事件（新增/删除/重命名等）
   * 用于让所有客户端（包含 WebUI）刷新 `listProjects()` 的结果。
   */
  "projects-changed": void;
  /**
   * 会话列表发生变更的事件（新增/删除/重命名等）
   * 用于让所有客户端（包含 WebUI）刷新 `listSessions()` 的结果。
   */
  "sessions-changed": void;
  /**
   * 文件系统发生变更的事件（如文件被增删改）
   * 载荷中的 `changes` 列表，在从后端发送到前端前，已被统一转换为 POSIX 风格的相对路径。
   * `selfChanges` 为可选字段：由应用自身写入（如编辑器保存）触发的变更子集，前端可按需忽略。
   */
  "fs-changed": { projectId: string; changes: string[]; selfChanges?: string[] };
  /** Prompt 开始处理 */
  "prompt-start": { sessionId: string };
  /** Prompt 处理结束 */
  "prompt-end": { sessionId: string; stopReason?: StopReason; error?: string };

  // ── Automation Events ─────────────────────────────────────────────

  /** 调度列表发生变更（新增/删除/更新） */
  "schedules-changed": void;
  /** 任务状态更新 */
  "task-update": { scheduleId: string; task: Task };
  /** 实时 ASR 的 partial/final 结果 */
  "asr-transcript": {
    clientId: string;
    asrSessionId: string;
    text: string;
    isFinal: boolean;
    id?: string;
    index?: number;
    speaker?: string;
  };
  /** 实时 ASR 错误 */
  "asr-error": { clientId: string; asrSessionId: string; message: string };
  /** 实时 ASR 连接关闭 */
  "asr-closed": {
    clientId: string;
    asrSessionId: string;
    code?: number;
    reason?: string;
  };
};

/**
 * 完整的 Fello IPC 协议 Schema
 * 组合了所有的请求和事件定义，用于前后端类型约束和接口生成
 */
export type FelloIPCSchema = {
  /** 所有的请求-响应定义 */
  requests: FelloIPCRequests;
  /** 所有的推送事件定义 */
  events: FelloIPCEvents;
};
