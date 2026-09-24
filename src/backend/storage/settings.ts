import { join } from "path";
import { writeFileSync, readFileSync, existsSync } from "fs";

import { FELLO_DIR } from "./constant";

import type {
  PeripheralSettingInfo,
  SettingProxyInfo,
  ShortcutSettings,
  SnippetInfo,
  SettingsInfo,
} from "../../shared/schema";

interface BaseAgentMeta {
  disabled: boolean;
  order: number;
}

interface StdioAgentMeta extends BaseAgentMeta {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface ApiAgentMeta extends BaseAgentMeta {
  type: "api";
  provider: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  contextWindowTokens?: number;
  modelIdTemplate?: string;
  models?: string[];
}

interface BaseMcpServerMeta {
  disabled: boolean;
  order: number;
}

interface StdioMcpServerMeta extends BaseMcpServerMeta {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface HttpMcpServerMeta extends BaseMcpServerMeta {
  type: "http";
  url: string;
  headers: Record<string, string>;
}

interface SseMcpServerMeta extends BaseMcpServerMeta {
  type: "sse";
  url: string;
  headers: Record<string, string>;
}

type McpServerMeta = StdioMcpServerMeta | HttpMcpServerMeta | SseMcpServerMeta;

type AgentMeta = StdioAgentMeta | ApiAgentMeta;

interface ImageGenerationProviderMeta {
  id: string;
  name: string;
  provider: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  model: string;
  active: boolean;
}

/**
 * 语音 Provider 的持久化形态：识别（STT）与合成（TTS）合并为一条记录。
 *
 * 两侧凭证同源，方向相关字段分开存放：识别用 `asrModel` / `asrResourceId`，
 * 合成用 `ttsModel` / `voice`；`sttEnabled` / `ttsEnabled` 各自独立开关。
 */
interface SpeechProviderMeta {
  id: string;
  name: string;
  provider: "volcengine" | "dashscope" | "openai" | "iflytek";
  apiKey: string;
  appId?: string;
  apiSecret?: string;
  baseUrl?: string;
  workspaceId?: string;
  region?: "cn-beijing" | "ap-southeast-1";
  workspace?: string;
  language?: string;
  asrModel?: string;
  asrResourceId?: string;
  ttsModel?: string;
  voice?: string;
  sttEnabled: boolean;
  ttsEnabled: boolean;
}

interface SettingsMeta {
  agents: {
    [id: string]: AgentMeta;
  };
  mcpServers: {
    [id: string]: McpServerMeta;
  };
  theme: {
    theme_mode: "light" | "dark" | "system";
  };
  i18n: {
    language: string;
  };
  fileWatcher: {
    enabled: boolean;
  };
  ilink: {
    useOriginalImage: boolean;
  };
  editor: {
    name: string;
  };
  sound: {
    volume: number;
    muted: boolean;
    theme: "soft" | "crisp";
  };
  voiceInput: {
    altDoublePress: boolean;
  };
  shortcuts: ShortcutSettings;
  proxy?: SettingProxyInfo;
  snippets?: SnippetInfo[];
  imageGeneration?: ImageGenerationProviderMeta[];
  speechProviders?: SpeechProviderMeta[];
  /** 外设「生效」开关；列表本身来自 src/shared/peripherals.ts 的内置枚举 */
  peripherals?: PeripheralSettingInfo[];
}

const DEFAULT_SETTINGS: SettingsMeta = {
  agents: {},
  theme: { theme_mode: "system" },
  i18n: {
    language: "en",
  },
  mcpServers: {},
  fileWatcher: {
    enabled: true,
  },
  ilink: {
    useOriginalImage: false,
  },
  editor: {
    name: "code",
  },
  sound: {
    volume: 50,
    muted: false,
    theme: "soft",
  },
  voiceInput: {
    altDoublePress: true,
  },
  shortcuts: {},
  proxy: {
    mode: "off",
  },
  peripherals: [],
};

function settingsPath() {
  return join(FELLO_DIR, "settings.json");
}

function readSettings(): SettingsMeta {
  try {
    if (!existsSync(settingsPath())) return DEFAULT_SETTINGS;
    const raw: unknown = JSON.parse(readFileSync(settingsPath(), "utf-8"));

    const isObject = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);

    const rawObj = isObject(raw) ? raw : null;
    const shortcuts: ShortcutSettings = (() => {
      const rawShortcuts = rawObj && isObject(rawObj.shortcuts) ? rawObj.shortcuts : null;
      if (!rawShortcuts) return {};
      const next: ShortcutSettings = {};
      for (const [commandId, value] of Object.entries(rawShortcuts)) {
        if (Array.isArray(value)) {
          next[commandId] = value
            .filter((shortcut): shortcut is string => typeof shortcut === "string")
            .map((shortcut) => shortcut.trim())
            .filter(Boolean);
        }
      }
      return next;
    })();
    const rawAgents = rawObj && isObject(rawObj.agents) ? rawObj.agents : null;

    const agents: SettingsMeta["agents"] = (() => {
      if (!rawAgents) return DEFAULT_SETTINGS.agents;
      const next: SettingsMeta["agents"] = {};
      for (const [id, value] of Object.entries(rawAgents)) {
        const cfg = isObject(value) ? value : null;
        const disabled = typeof cfg?.disabled === "boolean" ? cfg.disabled : false;
        const order = typeof cfg?.order === "number" ? cfg.order : 0;
        const type = cfg?.type ?? "stdio";

        if (type === "stdio") {
          const command = typeof cfg?.command === "string" ? cfg.command : "";
          const args = Array.isArray(cfg?.args)
            ? cfg.args.filter((v) => typeof v === "string")
            : [];
          const env = (() => {
            if (!isObject(cfg?.env)) return {};
            const nextEnv: Record<string, string> = {};
            for (const [k, v] of Object.entries(cfg.env)) {
              nextEnv[k] = String(v);
            }
            return nextEnv;
          })();
          next[id] = { type, command, args, env, disabled, order };
        } else if (type === "api") {
          const provider = typeof cfg?.provider === "string" ? cfg.provider : "openai-compatible";
          const baseUrl = typeof cfg?.baseUrl === "string" ? cfg.baseUrl : "";
          const apiKey = typeof cfg?.apiKey === "string" ? cfg.apiKey : "";
          const headers = (() => {
            if (!isObject(cfg?.headers)) return {};
            const nextHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(cfg.headers)) {
              nextHeaders[k] = String(v);
            }
            return nextHeaders;
          })();
          const contextWindowTokens =
            typeof cfg?.contextWindowTokens === "number" ? cfg.contextWindowTokens : undefined;
          const modelIdTemplate =
            typeof cfg?.modelIdTemplate === "string" && cfg.modelIdTemplate.trim()
              ? cfg.modelIdTemplate.trim()
              : undefined;
          const models =
            Array.isArray(cfg?.models) && cfg.models.every((v: unknown) => typeof v === "string")
              ? (cfg.models as string[]).filter((s: string) => s.trim().length > 0)
              : undefined;
          next[id] = {
            type,
            provider,
            baseUrl,
            apiKey,
            headers,
            disabled,
            order,
            contextWindowTokens,
            modelIdTemplate,
            models: models && models.length > 0 ? models : undefined,
          };
        }
      }
      return next;
    })();

    const theme =
      rawObj && isObject(rawObj.theme) && rawObj.theme.theme_mode
        ? {
            theme_mode:
              rawObj.theme.theme_mode === "light" ||
              rawObj.theme.theme_mode === "dark" ||
              rawObj.theme.theme_mode === "system"
                ? rawObj.theme.theme_mode
                : DEFAULT_SETTINGS.theme.theme_mode,
          }
        : DEFAULT_SETTINGS.theme;

    const i18n =
      rawObj && isObject(rawObj.i18n) && typeof rawObj.i18n.language === "string"
        ? { language: rawObj.i18n.language }
        : DEFAULT_SETTINGS.i18n;

    const rawMcpServers = rawObj && isObject(rawObj.mcpServers) ? rawObj.mcpServers : null;
    const mcpServers: SettingsMeta["mcpServers"] = (() => {
      if (!rawMcpServers) return DEFAULT_SETTINGS.mcpServers;
      const next: SettingsMeta["mcpServers"] = {};
      for (const [id, value] of Object.entries(rawMcpServers)) {
        const cfg = isObject(value) ? value : null;
        const type = cfg?.type ?? "stdio";

        if (type === "stdio") {
          const command = typeof cfg?.command === "string" ? cfg.command : "";
          const args = Array.isArray(cfg?.args)
            ? cfg.args.filter((v) => typeof v === "string")
            : [];
          const env = (() => {
            if (!isObject(cfg?.env)) return {};
            const nextEnv: Record<string, string> = {};
            for (const [k, v] of Object.entries(cfg.env)) {
              nextEnv[k] = String(v);
            }
            return nextEnv;
          })();
          const disabled = typeof cfg?.disabled === "boolean" ? cfg.disabled : false;
          const order = typeof cfg?.order === "number" ? cfg.order : 0;
          next[id] = { type, command, args, env, disabled, order };
        } else if (type === "http") {
          const url = typeof cfg?.url === "string" ? cfg.url : "";
          const headers = (() => {
            if (!isObject(cfg?.headers)) return {};
            const nextHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(cfg.headers)) {
              nextHeaders[k] = String(v);
            }
            return nextHeaders;
          })();
          const disabled = typeof cfg?.disabled === "boolean" ? cfg.disabled : false;
          const order = typeof cfg?.order === "number" ? cfg.order : 0;
          next[id] = { type, url, headers, disabled, order };
        } else if (type === "sse") {
          const url = typeof cfg?.url === "string" ? cfg.url : "";
          const headers = (() => {
            if (!isObject(cfg?.headers)) return {};
            const nextHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(cfg.headers)) {
              nextHeaders[k] = String(v);
            }
            return nextHeaders;
          })();
          const disabled = typeof cfg?.disabled === "boolean" ? cfg.disabled : false;
          const order = typeof cfg?.order === "number" ? cfg.order : 0;
          next[id] = { type, url, headers, disabled, order };
        }
      }
      return next;
    })();

    const fileWatcher: SettingsMeta["fileWatcher"] =
      rawObj && isObject(rawObj.fileWatcher) && typeof rawObj.fileWatcher.enabled === "boolean"
        ? { enabled: rawObj.fileWatcher.enabled }
        : DEFAULT_SETTINGS.fileWatcher;

    const ilink: SettingsMeta["ilink"] =
      rawObj && isObject(rawObj.ilink)
        ? {
            useOriginalImage:
              typeof rawObj.ilink.useOriginalImage === "boolean"
                ? rawObj.ilink.useOriginalImage
                : DEFAULT_SETTINGS.ilink.useOriginalImage,
          }
        : DEFAULT_SETTINGS.ilink;

    const sound: SettingsMeta["sound"] = (() => {
      const raw = rawObj && isObject(rawObj.sound) ? rawObj.sound : null;
      if (!raw) return DEFAULT_SETTINGS.sound;
      return {
        volume:
          typeof raw.volume === "number" && raw.volume >= 0 && raw.volume <= 100
            ? raw.volume
            : DEFAULT_SETTINGS.sound.volume,
        muted: typeof raw.muted === "boolean" ? raw.muted : DEFAULT_SETTINGS.sound.muted,
        theme:
          raw.theme === "soft" || raw.theme === "crisp" ? raw.theme : DEFAULT_SETTINGS.sound.theme,
      };
    })();

    const voiceInput: SettingsMeta["voiceInput"] = (() => {
      const raw = rawObj && isObject(rawObj.voiceInput) ? rawObj.voiceInput : null;
      return {
        altDoublePress:
          typeof raw?.altDoublePress === "boolean"
            ? raw.altDoublePress
            : DEFAULT_SETTINGS.voiceInput.altDoublePress,
      };
    })();

    const proxy: SettingProxyInfo = (() => {
      const raw = rawObj && isObject(rawObj.proxy) ? rawObj.proxy : null;
      if (!raw) return DEFAULT_SETTINGS.proxy!;
      const mode =
        raw.mode === "off" || raw.mode === "manual" || raw.mode === "system"
          ? raw.mode
          : DEFAULT_SETTINGS.proxy!.mode;
      const str = (value: unknown): string | undefined =>
        typeof value === "string" && value.trim() ? value.trim() : undefined;
      return {
        mode,
        httpProxy: str(raw.httpProxy),
        httpsProxy: str(raw.httpsProxy),
        noProxy: str(raw.noProxy),
        username: str(raw.username),
        password: str(raw.password),
      };
    })();

    const snippets: SnippetInfo[] = Array.isArray(rawObj?.snippets)
      ? (rawObj.snippets as unknown[]).filter(
          (s): s is SnippetInfo =>
            isObject(s) &&
            typeof s.id === "string" &&
            typeof s.title === "string" &&
            typeof s.content === "string",
        )
      : [];

    const imageGeneration: ImageGenerationProviderMeta[] = Array.isArray(rawObj?.imageGeneration)
      ? (rawObj.imageGeneration as unknown[])
          .filter(
            (p): p is ImageGenerationProviderMeta =>
              isObject(p) &&
              typeof p.id === "string" &&
              typeof p.name === "string" &&
              typeof p.baseUrl === "string" &&
              typeof p.apiKey === "string" &&
              typeof p.model === "string",
          )
          .map((p) => ({
            id: p.id,
            name: p.name,
            provider: "openai-compatible" as const,
            baseUrl: p.baseUrl,
            apiKey: p.apiKey,
            headers: (() => {
              const raw = (p as any).headers;
              if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
              const h: Record<string, string> = {};
              for (const [k, v] of Object.entries(raw)) h[k] = String(v);
              return h;
            })(),
            extraBody: (() => {
              const raw = (p as any).extraBody;
              if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
              return raw as Record<string, unknown>;
            })(),
            model: p.model,
            active: typeof p.active === "boolean" ? p.active : false,
          }))
      : [];

    const speechProviders: SpeechProviderMeta[] = (() => {
      const isSpeechProvider = (value: Record<string, unknown>): boolean => {
        const provider = value.provider;
        return (
          typeof value.id === "string" &&
          typeof value.name === "string" &&
          typeof value.apiKey === "string" &&
          (provider === "volcengine" ||
            provider === "dashscope" ||
            provider === "openai" ||
            provider === "iflytek")
        );
      };

      const parseShared = (
        value: Record<string, unknown>,
      ): Omit<
        SpeechProviderMeta,
        "asrModel" | "asrResourceId" | "ttsModel" | "voice" | "sttEnabled" | "ttsEnabled"
      > => ({
        id: value.id as string,
        name: value.name as string,
        provider: value.provider as SpeechProviderMeta["provider"],
        apiKey: value.apiKey as string,
        appId: typeof value.appId === "string" ? value.appId : undefined,
        apiSecret: typeof value.apiSecret === "string" ? value.apiSecret : undefined,
        baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : undefined,
        workspaceId: typeof value.workspaceId === "string" ? value.workspaceId : undefined,
        region:
          value.region === "cn-beijing" || value.region === "ap-southeast-1"
            ? value.region
            : undefined,
        workspace: typeof value.workspace === "string" ? value.workspace : undefined,
        language: typeof value.language === "string" ? value.language : undefined,
      });

      const rows = (input: unknown): Record<string, unknown>[] =>
        Array.isArray(input)
          ? input
              .filter((value): value is Record<string, unknown> => isObject(value))
              .filter(isSpeechProvider)
          : [];

      // 合并后的格式：单一 speechProviders 列表（推荐路径）
      if (Array.isArray(rawObj?.speechProviders)) {
        return rows(rawObj.speechProviders).map((value) => ({
          ...parseShared(value),
          asrModel: typeof value.asrModel === "string" ? value.asrModel : undefined,
          asrResourceId: typeof value.asrResourceId === "string" ? value.asrResourceId : undefined,
          ttsModel: typeof value.ttsModel === "string" ? value.ttsModel : undefined,
          voice: typeof value.voice === "string" ? value.voice : undefined,
          sttEnabled: typeof value.sttEnabled === "boolean" ? value.sttEnabled : false,
          ttsEnabled: typeof value.ttsEnabled === "boolean" ? value.ttsEnabled : false,
        }));
      }

      // 旧格式迁移：`speechToText`（识别列表）→ 单一列表，识别条目原样保留（识别是主路径）。
      // 旧记录的 `model` / `resourceId` / `active` 分别落到 asrModel / asrResourceId /
      // sttEnabled；合成字段留空，由用户在「设置 → 语音」里补全。
      return rows(rawObj?.speechToText).map((value) => ({
        ...parseShared(value),
        asrModel: typeof value.model === "string" ? value.model : undefined,
        asrResourceId: typeof value.resourceId === "string" ? value.resourceId : undefined,
        ttsModel: undefined,
        voice: undefined,
        sttEnabled: typeof value.active === "boolean" ? value.active : false,
        ttsEnabled: false,
      }));
    })();

    // 外设开关：只保留 id + enabled，未知 id 由上层（内置枚举）决定是否展示。
    const peripherals: PeripheralSettingInfo[] = Array.isArray(rawObj?.peripherals)
      ? (rawObj.peripherals as unknown[])
          .filter(
            (value): value is Record<string, unknown> =>
              typeof value === "object" && value !== null && !Array.isArray(value),
          )
          .filter((value) => typeof value.id === "string")
          .map((value) => ({
            id: value.id as string,
            enabled: typeof value.enabled === "boolean" ? value.enabled : false,
          }))
      : [];

    const editor: SettingsMeta["editor"] = (() => {
      const raw = rawObj && isObject(rawObj.editor) ? rawObj.editor : null;
      if (raw && typeof raw.name === "string" && raw.name.trim()) {
        return { name: raw.name.trim() };
      }
      return DEFAULT_SETTINGS.editor;
    })();

    return {
      agents,
      theme,
      i18n,
      mcpServers,
      fileWatcher,
      ilink,
      editor,
      sound,
      voiceInput,
      shortcuts,
      proxy,
      snippets,
      imageGeneration,
      speechProviders,
      peripherals,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(meta: SettingsMeta) {
  writeFileSync(settingsPath(), JSON.stringify(meta, null, 2));
}

export function getSettings(): SettingsInfo {
  const meta = readSettings();
  return {
    agents: Object.entries(meta.agents)
      .map(([id, agentMeta]) => {
        if (agentMeta.type === "stdio") {
          return {
            id,
            type: agentMeta.type,
            command: agentMeta.command,
            args: agentMeta.args.slice(),
            env: Object.assign({}, agentMeta.env),
            disabled: agentMeta.disabled,
          };
        }
        if (agentMeta.type === "api") {
          return {
            id,
            type: agentMeta.type,
            provider: agentMeta.provider,
            baseUrl: agentMeta.baseUrl,
            apiKey: agentMeta.apiKey,
            headers: Object.assign({}, agentMeta.headers),
            disabled: agentMeta.disabled,
            contextWindowTokens: agentMeta.contextWindowTokens,
            modelIdTemplate: agentMeta.modelIdTemplate,
            models: agentMeta.models,
          };
        }
        throw new Error("Invalid agent type.");
      })
      .sort((a, b) => meta.agents[a.id].order - meta.agents[b.id].order),
    mcpServers: Object.entries(meta.mcpServers)
      .map(([id, srvMeta]) => {
        if (srvMeta.type === "stdio") {
          return {
            id,
            type: srvMeta.type,
            command: srvMeta.command,
            args: srvMeta.args.slice(),
            env: Object.assign({}, srvMeta.env),
            disabled: srvMeta.disabled,
          };
        }
        if (srvMeta.type === "http") {
          return {
            id,
            type: srvMeta.type,
            url: srvMeta.url,
            headers: Object.assign({}, srvMeta.headers),
            disabled: srvMeta.disabled,
          };
        }
        if (srvMeta.type === "sse") {
          return {
            id,
            type: srvMeta.type,
            url: srvMeta.url,
            headers: Object.assign({}, srvMeta.headers),
            disabled: srvMeta.disabled,
          };
        }
        throw new Error(`Invalid mcpServer type ${(srvMeta as any).type}.`);
      })
      .sort((a, b) => meta.mcpServers[a.id].order - meta.mcpServers[b.id].order),
    i18n: {
      language: meta.i18n.language,
    },
    theme: {
      themeMode: meta.theme.theme_mode,
    },
    fileWatcher: {
      enabled: meta.fileWatcher.enabled,
    },
    ilink: {
      useOriginalImage: meta.ilink.useOriginalImage,
    },
    editor: {
      name: meta.editor.name,
    },
    sound: {
      volume: meta.sound.volume,
      muted: meta.sound.muted,
      theme: meta.sound.theme,
    },
    voiceInput: {
      altDoublePress: meta.voiceInput.altDoublePress,
    },
    shortcuts: Object.fromEntries(
      Object.entries(meta.shortcuts).map(([commandId, shortcuts]) => [
        commandId,
        shortcuts.slice(),
      ]),
    ),
    proxy: meta.proxy ?? DEFAULT_SETTINGS.proxy!,
    snippets: meta.snippets ?? [],
    imageGeneration: (meta.imageGeneration ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      headers: Object.assign({}, p.headers || {}),
      extraBody: p.extraBody ?? undefined,
      model: p.model,
      active: p.active,
    })),
    speechProviders: (meta.speechProviders ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      apiKey: p.apiKey,
      appId: p.appId,
      apiSecret: p.apiSecret,
      baseUrl: p.baseUrl,
      workspaceId: p.workspaceId,
      region: p.region,
      workspace: p.workspace,
      language: p.language,
      asrModel: p.asrModel,
      asrResourceId: p.asrResourceId,
      ttsModel: p.ttsModel,
      voice: p.voice,
      sttEnabled: p.sttEnabled,
      ttsEnabled: p.ttsEnabled,
    })),
    peripherals: (meta.peripherals ?? []).map((p) => ({
      id: p.id,
      enabled: p.enabled,
    })),
  };
}

export function updateSettings(settings: Partial<SettingsInfo>): void {
  const prevMeta = readSettings();
  const meta: SettingsMeta = {
    agents: (() => {
      if (!settings.agents) {
        return prevMeta.agents;
      }
      const nextAgents: SettingsMeta["agents"] = {};
      settings.agents.forEach((agent, idx) => {
        if (agent.type === "stdio") {
          nextAgents[agent.id] = {
            type: agent.type,
            command: agent.command,
            args: agent.args.slice(),
            env: Object.assign({}, agent.env),
            disabled: agent.disabled,
            order: idx,
          };
        } else if (agent.type === "api") {
          nextAgents[agent.id] = {
            type: agent.type,
            provider: agent.provider,
            baseUrl: agent.baseUrl,
            apiKey: agent.apiKey,
            headers: Object.assign({}, agent.headers || {}),
            disabled: agent.disabled,
            order: idx,
            contextWindowTokens:
              agent.contextWindowTokens !== undefined
                ? Number.isInteger(agent.contextWindowTokens) && agent.contextWindowTokens > 0
                  ? agent.contextWindowTokens
                  : undefined
                : undefined,
            modelIdTemplate:
              typeof agent.modelIdTemplate === "string" && agent.modelIdTemplate.trim()
                ? agent.modelIdTemplate.trim()
                : undefined,
            models: (() => {
              if (!Array.isArray(agent.models)) return undefined;
              const cleaned = agent.models.map((s) => s.trim()).filter(Boolean);
              return cleaned.length > 0 ? cleaned : undefined;
            })(),
          };
        } else {
          throw new Error("Invalid agent type.");
        }
      });
      return nextAgents;
    })(),
    i18n: (() => {
      if (!settings.i18n) {
        return prevMeta.i18n;
      }
      return {
        language: settings.i18n.language,
      };
    })(),
    theme: (() => {
      if (!settings.theme) {
        return prevMeta.theme;
      }
      return {
        theme_mode: settings.theme.themeMode,
      };
    })(),
    mcpServers: (() => {
      if (!settings.mcpServers) {
        return prevMeta.mcpServers;
      }
      const nextMcpServers: SettingsMeta["mcpServers"] = {};
      settings.mcpServers.forEach((srv, idx) => {
        if (srv.type === "stdio") {
          nextMcpServers[srv.id] = {
            type: srv.type,
            command: srv.command,
            args: srv.args.slice(),
            env: Object.assign({}, srv.env),
            disabled: srv.disabled,
            order: idx,
          };
        } else if (srv.type === "http") {
          nextMcpServers[srv.id] = {
            type: srv.type,
            url: srv.url,
            headers: Object.assign({}, srv.headers),
            disabled: srv.disabled,
            order: idx,
          };
        } else if (srv.type === "sse") {
          nextMcpServers[srv.id] = {
            type: srv.type,
            url: srv.url,
            headers: Object.assign({}, srv.headers),
            disabled: srv.disabled,
            order: idx,
          };
        }
      });
      return nextMcpServers;
    })(),
    fileWatcher: (() => {
      if (!settings.fileWatcher) {
        return prevMeta.fileWatcher;
      }
      return {
        enabled: settings.fileWatcher.enabled,
      };
    })(),
    ilink: (() => {
      if (!settings.ilink) {
        return prevMeta.ilink;
      }
      return {
        useOriginalImage: settings.ilink.useOriginalImage,
      };
    })(),
    editor: (() => {
      if (!settings.editor) {
        return prevMeta.editor;
      }
      return {
        name: settings.editor.name,
      };
    })(),
    sound: (() => {
      if (!settings.sound) {
        return prevMeta.sound;
      }
      return {
        volume:
          typeof settings.sound.volume === "number" &&
          settings.sound.volume >= 0 &&
          settings.sound.volume <= 100
            ? settings.sound.volume
            : prevMeta.sound.volume,
        muted:
          typeof settings.sound.muted === "boolean" ? settings.sound.muted : prevMeta.sound.muted,
        theme:
          settings.sound.theme === "soft" || settings.sound.theme === "crisp"
            ? settings.sound.theme
            : prevMeta.sound.theme,
      };
    })(),
    voiceInput: (() => {
      if (!settings.voiceInput) {
        return prevMeta.voiceInput;
      }
      return {
        altDoublePress:
          typeof settings.voiceInput.altDoublePress === "boolean"
            ? settings.voiceInput.altDoublePress
            : prevMeta.voiceInput.altDoublePress,
      };
    })(),
    shortcuts: settings.shortcuts
      ? Object.fromEntries(
          Object.entries(settings.shortcuts).map(([commandId, shortcuts]) => [
            commandId,
            shortcuts.map((shortcut) => shortcut.trim()).filter(Boolean),
          ]),
        )
      : prevMeta.shortcuts,
    proxy: (() => {
      if (!settings.proxy) {
        return prevMeta.proxy;
      }
      const mode =
        settings.proxy.mode === "off" ||
        settings.proxy.mode === "manual" ||
        settings.proxy.mode === "system"
          ? settings.proxy.mode
          : (prevMeta.proxy?.mode ?? DEFAULT_SETTINGS.proxy!.mode);
      const str = (value: string | undefined): string | undefined =>
        typeof value === "string" && value.trim() ? value.trim() : undefined;
      return {
        mode,
        httpProxy: str(settings.proxy.httpProxy),
        httpsProxy: str(settings.proxy.httpsProxy),
        noProxy: str(settings.proxy.noProxy),
        username: str(settings.proxy.username),
        password: str(settings.proxy.password),
      };
    })(),
    snippets: settings.snippets ?? prevMeta.snippets,
    imageGeneration: settings.imageGeneration
      ? settings.imageGeneration.map((p) => ({
          id: p.id,
          name: p.name,
          provider: p.provider,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          headers: Object.assign({}, p.headers || {}),
          extraBody: p.extraBody ?? undefined,
          model: p.model,
          active: p.active,
        }))
      : prevMeta.imageGeneration,
    speechProviders: settings.speechProviders
      ? settings.speechProviders.map((p) => ({
          id: p.id,
          name: p.name,
          provider: p.provider,
          apiKey: p.apiKey,
          appId: p.appId?.trim() || undefined,
          apiSecret: p.apiSecret?.trim() || undefined,
          baseUrl: p.baseUrl?.trim() || undefined,
          workspaceId: p.workspaceId?.trim() || undefined,
          region: p.region,
          workspace: p.workspace?.trim() || undefined,
          language: p.language?.trim() || undefined,
          asrModel: p.asrModel?.trim() || undefined,
          asrResourceId: p.asrResourceId?.trim() || undefined,
          ttsModel: p.ttsModel?.trim() || undefined,
          voice: p.voice?.trim() || undefined,
          sttEnabled: p.sttEnabled,
          ttsEnabled: p.ttsEnabled,
        }))
      : (prevMeta.speechProviders ?? []),
    peripherals: settings.peripherals
      ? settings.peripherals.map((p) => ({
          id: p.id,
          enabled: p.enabled,
        }))
      : (prevMeta.peripherals ?? []),
  };
  writeSettings(meta);
}
