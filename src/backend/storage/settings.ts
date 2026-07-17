import { join } from "path";
import { writeFileSync, readFileSync, existsSync } from "fs";

import { FELLO_DIR } from "./constant";

import type { SnippetInfo, SettingsInfo } from "../../shared/schema";

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
  snippets?: SnippetInfo[];
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

    const snippets: SnippetInfo[] = Array.isArray(rawObj?.snippets)
      ? (rawObj.snippets as unknown[]).filter(
          (s): s is SnippetInfo =>
            isObject(s) &&
            typeof s.id === "string" &&
            typeof s.title === "string" &&
            typeof s.content === "string",
        )
      : [];

    const editor: SettingsMeta["editor"] = (() => {
      const raw = rawObj && isObject(rawObj.editor) ? rawObj.editor : null;
      if (raw && typeof raw.name === "string" && raw.name.trim()) {
        return { name: raw.name.trim() };
      }
      return DEFAULT_SETTINGS.editor;
    })();

    return { agents, theme, i18n, mcpServers, fileWatcher, ilink, editor, sound, snippets };
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
    snippets: meta.snippets ?? [],
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
    snippets: settings.snippets ?? prevMeta.snippets,
  };
  writeSettings(meta);
}
