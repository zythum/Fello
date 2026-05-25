import type {
  SessionNotification,
  InitializeResponse,
  SessionModeState,
  SessionModelState,
  ContentBlock,
  Usage,
} from "@agentclientprotocol/sdk";

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
      };
    };
  };
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

/** MCP Server 配置联合类型：stdio / http */
export type McpServerInfo = StdioMcpServerInfo | HttpMcpServerInfo;

/** 会话级别的 feature 枚举 */
export type Feature = "skills" | "ask_user";

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
  /** 缓存的代理初始化信息 */
  initializeInfo: InitializeResponse | null;
  /** 是否在输出中 */
  isStreaming: boolean;
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
    };
  };
  /** 加载已有会话 */
  loadSession: {
    params: { sessionId: string };
    response: {
      /** Fello 侧的会话唯一标识 */
      sessionId: string;
      /** 代理的初始化信息（如支持的能力、名称、版本等） */
      initializeInfo: InitializeResponse | null;
      /** 该会话当前可用的模型状态（列表及选中项） */
      models: SessionModelState | null;
      /** 该会话当前可用的模式状态（列表及选中项） */
      modes: SessionModeState | null;
    };
  };
  /** 获取会话历史记录 */
  getSessionHistory: {
    params: { sessionId: string };
    response: {
      messages: SessionNotificationFelloExt[];
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
  /** 删除会话 */
  deleteSession: { params: string; response: void };

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
   */
  readDir: {
    params: { projectId: string; relativePath?: string };
    response: { id: string; name: string; isFolder: boolean }[];
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
    params: void;
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
   */
  "fs-changed": { projectId: string; changes: string[] };
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
