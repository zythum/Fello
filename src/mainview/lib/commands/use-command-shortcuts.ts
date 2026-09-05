import { useMemo } from "react";
import { useKeyboardShortcuts } from "../keyboard";
import { getCommandShortcuts, type ShortcutOverrides } from "./shortcut-utils";
import type { Command } from "./command-catalog";

export function useCommandShortcuts(
  commands: readonly Command[],
  overrides: Readonly<ShortcutOverrides>,
) {
  const shortcuts = useMemo(
    () =>
      commands.flatMap((command) =>
        getCommandShortcuts(command, overrides).map((shortcut) => ({
          shortcut,
          handler: command.execute,
          ignoreInputs: command.ignoreInputs,
        })),
      ),
    [commands, overrides],
  );

  useKeyboardShortcuts(shortcuts);
}
