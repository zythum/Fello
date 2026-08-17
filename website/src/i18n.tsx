import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "en" | "zh";

const STORAGE_KEY = "fello-site-lang";

export const en = {
  meta: {
    title: "Fello — Your AI Desktop Companion",
    description:
      "Fello is a desktop AI workspace built on the open Agent Client Protocol (ACP). Talk to your codebase and let AI handle the heavy lifting.",
  },
  nav: {
    features: "Features",
    integrations: "Integrations",
    connect: "Connect",
    server: "Server",
    download: "Download",
  },
  hero: {
    badge: "Built on the open Agent Client Protocol (ACP)",
    title1: "Talk to your codebase.",
    title2: "Let AI handle the heavy lifting.",
    subtitle:
      "Fello is a desktop AI workspace that's not tied to any single vendor — connect local agents via ACP or any OpenAI-compatible API, and bring chat, files, terminal, diffs, project memory and MCP tools together in one native app.",
    ctaDownload: "Download Fello",
    ctaGithub: "View on GitHub",
    screenshotAlt: "Fello desktop screenshot",
    stats: [
      { value: "macOS · Windows · Linux", label: "Cross-platform desktop app" },
      { value: "Local-first", label: "Your code and data stay on your machine" },
      { value: "GPL-3.0", label: "Open source" },
    ],
  },
  features: {
    label: "Why Fello",
    title: "Everything you need, nothing you don't",
    subtitle:
      "Fello is an agent-neutral client that puts you back in control of your AI workflow.",
    items: [
      {
        title: "No Vendor Lock-in",
        desc: "Connect any ACP-compatible agent or any OpenAI-compatible API, and switch freely between them per session. Your tools, your choice.",
      },
      {
        title: "Local-First & Private",
        desc: "Run agents locally and keep your code and data on your machine. Nothing leaves your computer unless you choose a cloud API.",
      },
      {
        title: "All-in-One Workspace",
        desc: "Browse, edit, preview files, view diffs and run terminals side by side with your AI chat. One panel, fully synced.",
      },
      {
        title: "Persistent Project Memory",
        desc: "Project conventions, preferences, decisions and corrections survive across sessions, with focused retrieval and transactional updates.",
      },
      {
        title: "Granular Permission Control",
        desc: "Approve every tool call or use \"Always Allow\" memory. Stay in control without repetitive confirmations.",
      },
      {
        title: "Remote Access & Self-Hosting",
        desc: "Access Fello from any browser on your LAN, or deploy its headless server on your own machine. Full functionality, zero compromise.",
      },
      {
        title: "Automation",
        desc: "Schedule AI tasks with cron expressions. Daily reports, periodic checks, or any recurring workflow — on autopilot.",
      },
      {
        title: "WeChat ClawBot",
        desc: "Bridge Fello to WeChat. Receive messages and reply right from your desktop.",
      },
      {
        title: "Beautiful & Modern UI",
        desc: "Dark/light themes, tabbed panels, and smooth streaming chat.",
      },
    ],
  },
  integrations: {
    label: "Deep Integrations",
    title: "Purpose-built for your favorite agents",
    subtitle:
      "Fello ships purpose-built optimizations for Kiro and CodeBuddy, so you get a smoother experience out of the box.",
    kiro: {
      name: "Kiro",
      tagline: "Smoother out-of-the-box experience",
      items: [
        "Live context usage — see how much of your context window is in use in real time.",
        "Slash commands — Kiro's commands are detected and surfaced right in the chat UI.",
        "Sub-agent status — Kiro's subagents appear as live sub-tasks with up-to-date status.",
      ],
    },
    codebuddy: {
      name: "CodeBuddy",
      tagline: "Multi-agent collaboration made visible",
      items: [
        "Agent Teams — multi-agent collaboration with live member and sub-task status.",
        "Turn replay filtering — CodeBuddy's re-broadcasts are filtered automatically so your history stays clean.",
        "Auto environment setup — recommended runtime environment variables are injected automatically.",
      ],
    },
  },
  connect: {
    label: "Connect Anywhere",
    title: "Reach your agents from anywhere",
    subtitle:
      "Fello isn't just a desktop app — reach your agents from WeChat or any browser on your network.",
    ilink: {
      title: "WeChat ClawBot",
      desc: "Bridge Fello to WeChat: receive messages and reply right from your desktop, wherever you are.",
      steps: [
        "Open Fello → Settings → WeChat iLink",
        "Click Connect and scan the QR code with WeChat",
        "Right-click a session in the sidebar → Set as WeChat Active",
      ],
      note: "WeChat messages are routed into that session automatically, and the agent's replies are sent back to WeChat.",
    },
    webui: {
      title: "WebUI Remote Access",
      desc: "Use the full Fello interface from any browser on your LAN — no installation needed on the client device.",
      steps: [
        "Open Fello → Settings → WebUI",
        "Toggle Enable WebUI, then set a port and a token",
        "Open the displayed access URL in a browser on the same network",
      ],
      note: "Full functionality, zero compromise.",
    },
  },
  server: {
    label: "Headless Server",
    title: "Deploy Fello as a web service",
    subtitle:
      "Run Fello as a pure Node.js service — serving only the WebUI, no Electron needed, accessible directly from your browser.",
    runNpx: {
      title: "Run directly with npx",
      desc: "No installation required — start the server in a single command.",
      commands: ["npx @zythum02/fello-server --port 9090 --token mysecret"],
    },
    runGlobal: {
      title: "Or install globally",
      desc: "Install the package once, then run fello-server anywhere.",
      commands: ["npm install -g @zythum02/fello-server", "fello-server -p 9090 -t mysecret"],
    },
    paramsTitle: "Command line options",
    params: [
      { flag: "--port / -p", desc: "Listening port (auto-assigned by default)" },
      { flag: "--token / -t", desc: "Access token (a random value is generated if not set)" },
    ],
    accessTitle: "Access from a browser",
    accessDesc: "Open the URL on any device in the same network:",
    accessUrl: "http://<local-ip>:<port>/?token=<your-token>",
  },
  platforms: {
    label: "Platform Support",
    title: "Runs where you work",
    headers: { platform: "Platform", desktop: "Desktop App", webui: "WebUI Remote Access" },
    rows: [
      { name: "macOS", desktop: true, webui: true },
      { name: "Windows", desktop: true, webui: true },
      { name: "Linux", desktop: true, webui: true },
      { name: "@zythum02/fello-server", desktop: false, webui: true },
    ],
  },
  download: {
    label: "Get Started",
    title: "Download Fello",
    subtitle: "Free and open source. Available for macOS, Windows and Linux.",
    steps: [
      { title: "Download", desc: "Get Fello for macOS / Windows / Linux from GitHub Releases." },
      { title: "Add an Agent", desc: "A local Stdio agent (via ACP) or an OpenAI-compatible API." },
      { title: "Start Chatting", desc: "Create a project, open a session, and let AI handle the heavy lifting." },
    ],
    cta: "Download Fello",
    ctaHint: "Latest release on GitHub",
    manual: "Read the User Manual",
  },
  footer: {
    tagline: "An agent-neutral desktop AI workspace built on the open ACP protocol.",
    resources: "Resources",
    manual: "User Manual",
    developer: "Developer Guide",
    license: "GPL-3.0-or-later",
    community: "Community",
    issues: "Issues",
    built: "Built with ❤ by Zythum",
  },
  langSwitch: "中文",
};

export type Dict = typeof en;

export const zh: Dict = {
  meta: {
    title: "Fello — 你的 AI 桌面伴侣",
    description:
      "Fello 是基于开放的 Agent Client Protocol（ACP）协议的桌面 AI 工作台。与你的代码库对话，让 AI 处理繁重工作。",
  },
  nav: {
    features: "功能",
    integrations: "深度集成",
    connect: "随处连接",
    server: "服务器",
    download: "下载",
  },
  hero: {
    badge: "基于开放的 Agent Client Protocol（ACP）协议",
    title1: "与你的代码库对话。",
    title2: "让 AI 处理繁重工作。",
    subtitle:
      "Fello 是一个不绑定任何厂商的桌面 AI 工作台——通过 ACP 接入本地智能体，或接入任意 OpenAI 兼容 API，将聊天、文件、终端、diff、项目记忆与 MCP 工具汇聚于一个原生应用。",
    ctaDownload: "下载 Fello",
    ctaGithub: "查看 GitHub",
    screenshotAlt: "Fello 桌面端截图",
    stats: [
      { value: "macOS · Windows · Linux", label: "跨平台桌面应用" },
      { value: "本地优先", label: "代码与数据保留在你的设备上" },
      { value: "GPL-3.0", label: "开源" },
    ],
  },
  features: {
    label: "为什么选择 Fello",
    title: "你需要的一切，不多不少",
    subtitle: "Fello 是智能体中立客户端，把 AI 工作流的控制权交还给你。",
    items: [
      {
        title: "无厂商锁定",
        desc: "接入任意 ACP 兼容智能体或 OpenAI 兼容 API，按会话自由切换。工具由你决定。",
      },
      {
        title: "本地优先、保护隐私",
        desc: "在本地运行智能体，代码与数据保留在你的设备上。除非你选择云端 API，否则数据不会离开电脑。",
      },
      {
        title: "一体化工作区",
        desc: "与 AI 对话的同时浏览、编辑、预览文件、查看 diff、运行终端。单一面板，完全同步。",
      },
      {
        title: "持久项目记忆",
        desc: "项目约定、偏好、决策与修正跨会话保留，支持精准检索与事务性更新。",
      },
      {
        title: "细粒度权限控制",
        desc: "每次工具调用都可审批，或使用“始终允许”记忆。无需重复确认，始终掌控。",
      },
      {
        title: "远程访问与自托管",
        desc: "通过局域网任意浏览器访问 Fello，或在你自己的机器上部署无头服务器。功能完整，不打折扣。",
      },
      {
        title: "自动化",
        desc: "用 cron 表达式定时调度 AI 任务。日报、定期检查或任何周期性工作流——全自动运行。",
      },
      {
        title: "微信 ClawBot",
        desc: "将 Fello 接入微信，在桌面直接接收消息并回复。",
      },
      {
        title: "美观现代的界面",
        desc: "深色/浅色主题、标签式面板与流畅的流式对话。",
      },
    ],
  },
  integrations: {
    label: "深度集成",
    title: "为你常用的智能体量身优化",
    subtitle: "Fello 为 Kiro 与 CodeBuddy 内置针对性优化，开箱即得更顺畅的体验。",
    kiro: {
      name: "Kiro",
      tagline: "开箱即用的顺畅体验",
      items: [
        "实时上下文用量——实时查看上下文窗口的使用情况。",
        "斜杠命令——Kiro 的命令会在聊天界面中自动识别并展示。",
        "子智能体状态——Kiro 的子智能体以实时子任务形式呈现，状态即时更新。",
      ],
    },
    codebuddy: {
      name: "CodeBuddy",
      tagline: "让多智能体协作清晰可见",
      items: [
        "智能体团队——多智能体协作，成员与子任务状态实时可见。",
        "回合重播过滤——自动过滤 CodeBuddy 的重播内容，保持历史记录干净。",
        "自动环境配置——自动注入推荐的运行时环境变量。",
      ],
    },
  },
  connect: {
    label: "随处连接",
    title: "随时随地触达你的智能体",
    subtitle: "Fello 不只是一款桌面应用——通过微信或局域网浏览器即可触达你的智能体。",
    ilink: {
      title: "微信 ClawBot",
      desc: "将 Fello 接入微信：无论身在何处，都可在桌面接收消息并回复。",
      steps: [
        "打开 Fello → 设置 → 微信 iLink",
        "点击「连接」并用微信扫描二维码",
        "在侧边栏右键点击会话 → 设为微信活跃会话",
      ],
      note: "微信消息会自动路由到该会话，智能体的回复也会自动发送回微信。",
    },
    webui: {
      title: "WebUI 远程访问",
      desc: "在局域网任意浏览器中使用完整的 Fello 界面——客户端无需安装。",
      steps: [
        "打开 Fello → 设置 → WebUI",
        "开启 WebUI，设置端口与访问令牌",
        "在同一网络的浏览器中打开显示的访问地址",
      ],
      note: "功能完整，不打折扣。",
    },
  },
  server: {
    label: "无头服务器",
    title: "将 Fello 部署为 Web 服务",
    subtitle:
      "以纯 Node.js 服务方式运行 Fello——仅启动 WebUI，无需 Electron，直接在浏览器中访问。",
    runNpx: {
      title: "通过 npx 直接运行",
      desc: "无需安装，一条命令即可启动服务器。",
      commands: ["npx @zythum02/fello-server --port 9090 --token mysecret"],
    },
    runGlobal: {
      title: "或全局安装后运行",
      desc: "安装一次，即可在任何地方运行 fello-server。",
      commands: ["npm install -g @zythum02/fello-server", "fello-server -p 9090 -t mysecret"],
    },
    paramsTitle: "命令行参数",
    params: [
      { flag: "--port / -p", desc: "监听端口（默认自动分配）" },
      { flag: "--token / -t", desc: "访问令牌（未设置时自动生成随机值）" },
    ],
    accessTitle: "在浏览器中访问",
    accessDesc: "在同一网络的任意设备浏览器中打开：",
    accessUrl: "http://<本机IP>:<端口>/?token=<你的令牌>",
  },
  platforms: {
    label: "平台支持",
    title: "在你工作的地方运行",
    headers: { platform: "平台", desktop: "桌面应用", webui: "WebUI 远程访问" },
    rows: [
      { name: "macOS", desktop: true, webui: true },
      { name: "Windows", desktop: true, webui: true },
      { name: "Linux", desktop: true, webui: true },
      { name: "@zythum02/fello-server", desktop: false, webui: true },
    ],
  },
  download: {
    label: "快速开始",
    title: "下载 Fello",
    subtitle: "免费开源，支持 macOS、Windows 与 Linux。",
    steps: [
      { title: "下载", desc: "从 GitHub Releases 获取 macOS / Windows / Linux 版本。" },
      { title: "添加智能体", desc: "本地 Stdio 智能体（通过 ACP）或 OpenAI 兼容 API。" },
      { title: "开始对话", desc: "创建项目、打开会话，让 AI 处理繁重工作。" },
    ],
    cta: "下载 Fello",
    ctaHint: "GitHub 最新 Release",
    manual: "阅读用户手册",
  },
  footer: {
    tagline: "基于开放 ACP 协议的智能体中立桌面 AI 工作台。",
    resources: "资源",
    manual: "用户手册",
    developer: "开发者指南",
    license: "GPL-3.0-or-later",
    community: "社区",
    issues: "Issues",
    built: "Zythum 用心打造 ❤",
  },
  langSwitch: "EN",
};

const LangContext = createContext<{
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Dict;
} | null>(null);

function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    // ignore
  }
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh")) {
    return "zh";
  }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);
  const t = lang === "zh" ? zh : en;

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.meta.title;
  }, [lang, t]);

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LangContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
