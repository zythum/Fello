export interface AgentConfig {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ThemeConfig {
  theme_mode: "light" | "dark" | "system";
}

export interface SettingsMeta {
  agents: AgentConfig[];
  theme?: ThemeConfig;
  language?: string;
}

export const DEFAULT_SETTINGS: SettingsMeta = {
  agents: [],
  theme: { theme_mode: "system" },
  language: "en",
};
