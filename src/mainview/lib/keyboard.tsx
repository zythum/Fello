import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode, RefObject } from "react";

export type FocusTargetId = string;
export type FocusTargetHandler = () => boolean | void;

interface FocusTargetContextValue {
  register: (id: FocusTargetId, handler: FocusTargetHandler) => () => void;
  focus: (id: FocusTargetId) => boolean;
}

const FocusTargetContext = createContext<FocusTargetContextValue | null>(null);

export function FocusTargetProvider({ children }: { children: ReactNode }) {
  const targetsRef = useRef(new Map<FocusTargetId, FocusTargetHandler>());

  const register = useCallback((id: FocusTargetId, handler: FocusTargetHandler) => {
    targetsRef.current.set(id, handler);

    return () => {
      if (targetsRef.current.get(id) === handler) {
        targetsRef.current.delete(id);
      }
    };
  }, []);

  const focus = useCallback((id: FocusTargetId) => {
    const handler = targetsRef.current.get(id);
    if (!handler) return false;

    return handler() !== false;
  }, []);

  const value = useMemo(() => ({ register, focus }), [focus, register]);

  return <FocusTargetContext.Provider value={value}>{children}</FocusTargetContext.Provider>;
}

function useFocusTargetContext() {
  const context = useContext(FocusTargetContext);
  if (!context) {
    throw new Error("Focus target hooks must be used within FocusTargetProvider");
  }
  return context;
}

export function useFocusTarget(id: FocusTargetId, handler: FocusTargetHandler, enabled = true) {
  const { register } = useFocusTargetContext();
  const handlerRef = useRef(handler);
  const enabledRef = useRef(enabled);
  handlerRef.current = handler;
  enabledRef.current = enabled;

  useEffect(() => {
    const registeredHandler = () => {
      if (!enabledRef.current) return false;
      return handlerRef.current();
    };

    return register(id, registeredHandler);
  }, [id, register]);
}

export function useFocusTargetRegistry() {
  return useFocusTargetContext();
}

type ShortcutKey = "Alt" | "Control" | "Ctrl" | "Meta" | "Cmd" | "Mod" | "Shift" | string;

export interface KeyboardShortcut {
  shortcut: string;
  handler: (event: KeyboardEvent) => void;
  enabled?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  ignoreInputs?: boolean;
}

interface ParsedShortcut {
  key: string;
  codes: readonly string[] | null;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  mod: boolean;
}

interface KeyboardShortcutOptions {
  scopeRef?: RefObject<HTMLElement | null>;
  capture?: boolean;
}

const keyCodeMap: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  plus: "Equal",
  minus: "Minus",
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
};

const keyCodeAliases: Record<string, readonly string[]> = {
  plus: ["Equal", "NumpadAdd"],
  minus: ["Minus", "NumpadSubtract"],
};

function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const keyPart = parts.pop()?.toLowerCase() ?? "";
  const modifiers = new Set<ShortcutKey>(parts as ShortcutKey[]);
  const normalizedKey = keyPart.length === 1 ? keyPart : (keyCodeMap[keyPart] ?? keyPart);
  const code = /^\d$/.test(keyPart)
    ? `Digit${keyPart}`
    : /^[fF]\d{1,2}$/.test(keyPart)
      ? keyPart.toUpperCase()
      : (keyCodeMap[keyPart] ?? null);
  const codes = keyCodeAliases[keyPart] ?? (code ? [code] : null);

  return {
    key: normalizedKey,
    codes,
    alt: modifiers.has("Alt"),
    ctrl: modifiers.has("Control") || modifiers.has("Ctrl"),
    meta: modifiers.has("Meta") || modifiers.has("Cmd"),
    shift: modifiers.has("Shift"),
    mod: modifiers.has("Mod"),
  };
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

function isShortcutCaptureTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && target.closest("[data-shortcut-capture]") !== null;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function matchesShortcut(event: KeyboardEvent, shortcut: ParsedShortcut) {
  const isMac = isMacPlatform();
  const expectedCtrl = shortcut.ctrl || (shortcut.mod && !isMac);
  const expectedMeta = shortcut.meta || (shortcut.mod && isMac);

  if (event.altKey !== shortcut.alt) return false;
  if (event.ctrlKey !== expectedCtrl) return false;
  if (event.metaKey !== expectedMeta) return false;
  if (event.shiftKey !== shortcut.shift) return false;

  if (shortcut.codes) return shortcut.codes.includes(event.code);
  return event.key.toLowerCase() === shortcut.key.toLowerCase();
}

export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  { scopeRef, capture = true }: KeyboardShortcutOptions = {},
) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      if (scopeRef) {
        const eventTarget = event.target;
        if (!(eventTarget instanceof Node) || !scopeRef.current?.contains(eventTarget)) return;
      }

      if (isShortcutCaptureTarget(event.target)) return;

      for (const shortcut of shortcutsRef.current) {
        if (shortcut.enabled === false) continue;
        if (shortcut.ignoreInputs !== false && isEditableTarget(event.target)) continue;

        const parsedShortcut = parseShortcut(shortcut.shortcut);
        if (!matchesShortcut(event, parsedShortcut)) continue;

        if (shortcut.preventDefault !== false) event.preventDefault();
        if (shortcut.stopPropagation !== false) event.stopPropagation();
        shortcut.handler(event);
        break;
      }
    };

    window.addEventListener("keydown", handleKeyDown, capture);
    return () => window.removeEventListener("keydown", handleKeyDown, capture);
  }, [capture, scopeRef]);
}
