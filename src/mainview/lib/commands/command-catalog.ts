export type CommandCategory = "navigation";

export interface CommandDefinition {
  id: string;
  category: CommandCategory;
  titleKey: string;
  descriptionKey: string;
  defaultShortcuts: readonly string[];
  ignoreInputs?: boolean;
  focusTargets?: readonly string[];
}

export const COMMAND_DEFINITIONS = [
  {
    id: "focus.chatInput",
    category: "navigation",
    titleKey: "commands.focusChatInput.title",
    descriptionKey: "commands.focusChatInput.description",
    defaultShortcuts: ["Mod+Shift+I"],
    ignoreInputs: false,
    focusTargets: ["chat-input", "ask-user-dialog"],
  },
  {
    id: "focus.chatArea",
    category: "navigation",
    titleKey: "commands.focusChatArea.title",
    descriptionKey: "commands.focusChatArea.description",
    defaultShortcuts: ["Mod+Shift+M"],
    ignoreInputs: false,
    focusTargets: ["chat-area"],
  },
  {
    id: "focus.fileTree",
    category: "navigation",
    titleKey: "commands.focusFileTree.title",
    descriptionKey: "commands.focusFileTree.description",
    defaultShortcuts: ["Mod+Shift+D"],
    ignoreInputs: false,
    focusTargets: ["file-tree"],
  },
  {
    id: "focus.terminalList",
    category: "navigation",
    titleKey: "commands.focusTerminalList.title",
    descriptionKey: "commands.focusTerminalList.description",
    defaultShortcuts: ["Mod+Shift+T"],
    ignoreInputs: false,
    focusTargets: ["terminal-list"],
  },
  {
    id: "focus.sidebarSessions",
    category: "navigation",
    titleKey: "commands.focusSidebarSessions.title",
    descriptionKey: "commands.focusSidebarSessions.description",
    defaultShortcuts: ["Mod+Shift+E"],
    ignoreInputs: false,
    focusTargets: ["sidebar-sessions"],
  },
] as const satisfies readonly CommandDefinition[];

export type CommandId = (typeof COMMAND_DEFINITIONS)[number]["id"];

export interface Command extends CommandDefinition {
  execute: () => void;
}

export function createAppCommands(focus: (target: string) => boolean): Command[] {
  return COMMAND_DEFINITIONS.map((definition) => ({
    ...definition,
    execute: () => {
      for (const target of definition.focusTargets ?? []) {
        if (focus(target)) break;
      }
    },
  }));
}
