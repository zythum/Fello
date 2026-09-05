import type { CommandDefinition } from "./command-catalog";

export type ShortcutOverrides = Record<string, string[]>;

const MODIFIER_ORDER = ["Mod", "Ctrl", "Alt", "Shift", "Meta"] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  alt: "Alt",
  control: "Ctrl",
  ctrl: "Ctrl",
  meta: "Meta",
  cmd: "Mod",
  command: "Mod",
  mod: "Mod",
  option: "Alt",
  shift: "Shift",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  "page-up": "PageUp",
  pagedown: "PageDown",
  "page-down": "PageDown",
  plus: "Plus",
  "+": "Plus",
  minus: "Minus",
  "-": "Minus",
};

const KEY_TOKENS_BY_CODE: Record<string, string> = {
  Minus: "Minus",
};

function normalizeKey(key: string) {
  const trimmed = key.trim();
  const alias = KEY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (/^key[a-z]$/i.test(trimmed)) return trimmed.slice(3).toUpperCase();
  if (/^digit\d$/i.test(trimmed)) return trimmed.slice(5);
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
}

export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const keyPart = parts.pop();
  if (!keyPart) return "";

  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) modifiers.add(modifier);
  }

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers, normalizeKey(keyPart)].join("+");
}

function keyFromKeyboardEvent(event: KeyboardEvent) {
  if (/^Key[A-Z]$/i.test(event.code)) return event.code.slice(3).toUpperCase();
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5);
  if (/^F\d{1,2}$/.test(event.code)) return event.code.toUpperCase();
  if (event.key === " ") return "Space";
  if (event.key === "+") return "Plus";
  if (event.key === "-") return "Minus";
  return KEY_TOKENS_BY_CODE[event.code] ?? normalizeKey(event.key);
}

function shortcutModifiersFromEvent(event: KeyboardEvent, isMac: boolean) {
  const modifiers: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) modifiers.push("Mod");
  if (isMac ? event.ctrlKey : event.metaKey) modifiers.push(isMac ? "Ctrl" : "Meta");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return modifiers;
}

export function shortcutPreviewFromKeyboardEvent(
  event: KeyboardEvent,
  isMac: boolean,
): string | null {
  if (event.key === "=") return null;

  const modifiers = shortcutModifiersFromEvent(event, isMac);
  const isModifierKey = ["Control", "Meta", "Alt", "Shift"].includes(event.key);
  const key = isModifierKey ? null : keyFromKeyboardEvent(event);

  if (modifiers.length === 0) return null;
  return normalizeShortcut([...modifiers, ...(key ? [key] : [])].join("+"));
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent, isMac: boolean): string | null {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return null;
  if (shortcutModifiersFromEvent(event, isMac).length === 0) return null;
  return shortcutPreviewFromKeyboardEvent(event, isMac);
}

export function getCommandShortcuts(
  command: CommandDefinition,
  overrides: Readonly<Record<string, readonly string[]>>,
): string[] {
  const override = overrides[command.id];
  return (override ?? command.defaultShortcuts).map(normalizeShortcut).filter(Boolean);
}

export interface ShortcutConflict {
  shortcut: string;
  commandIds: string[];
}

export function findShortcutConflicts(
  commands: readonly CommandDefinition[],
  overrides: Readonly<Record<string, readonly string[]>>,
): ShortcutConflict[] {
  const commandsByShortcut = new Map<string, string[]>();
  for (const command of commands) {
    for (const shortcut of getCommandShortcuts(command, overrides)) {
      const commandIds = commandsByShortcut.get(shortcut) ?? [];
      commandIds.push(command.id);
      commandsByShortcut.set(shortcut, commandIds);
    }
  }

  return [...commandsByShortcut.entries()]
    .filter(([, commandIds]) => commandIds.length > 1)
    .map(([shortcut, commandIds]) => ({ shortcut, commandIds }));
}
