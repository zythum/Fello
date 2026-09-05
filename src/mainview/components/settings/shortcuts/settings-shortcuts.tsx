import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import { extractErrorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  COMMAND_DEFINITIONS,
  type CommandId,
} from "../../../lib/commands/command-catalog";
import {
  findShortcutConflicts,
  getCommandShortcuts,
  shortcutFromKeyboardEvent,
  shortcutPreviewFromKeyboardEvent,
} from "../../../lib/commands/shortcut-utils";
import { ShortcutKeys } from "./shortcut-keys";
import { useMessage } from "../../providers/message";

interface ShortcutCaptureProps {
  shortcut: string | null;
  isMac: boolean;
  onCancel: () => void;
  onChange: (shortcut: string) => void;
}

function ShortcutCapture({ shortcut, isMac, onCancel, onChange }: ShortcutCaptureProps) {
  const { t } = useTranslation();
  const captureRef = useRef<HTMLButtonElement>(null);
  const [previewShortcut, setPreviewShortcut] = useState(shortcut);

  useEffect(() => {
    setPreviewShortcut(shortcut);
    window.requestAnimationFrame(() => captureRef.current?.focus());
  }, [shortcut]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      onCancel();
      return;
    }

    const preview = shortcutPreviewFromKeyboardEvent(event.nativeEvent, isMac);
    if (preview) setPreviewShortcut(preview);

    const nextShortcut = shortcutFromKeyboardEvent(event.nativeEvent, isMac);
    if (nextShortcut) onChange(nextShortcut);
  };

  return (
    <button
      ref={captureRef}
      type="button"
      className="flex min-h-16 w-full items-center justify-center rounded-lg border border-dashed border-ring bg-background px-4 py-3 text-xs transition-colors focus-visible:ring-1 focus-visible:ring-ring/50"
      onKeyDown={handleKeyDown}
      aria-label={t("settings.shortcuts.recording", "Press a shortcut")}
    >
      {previewShortcut ? (
        <ShortcutKeys shortcut={previewShortcut} isMac={isMac} />
      ) : (
        <span className="text-muted-foreground">
          {t("settings.shortcuts.recording", "Press a shortcut")}
        </span>
      )}
    </button>
  );
}

function sameShortcuts(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((shortcut, index) => shortcut === right[index]);
}

type AppCommandDefinition = (typeof COMMAND_DEFINITIONS)[number];

export function SettingsShortcuts() {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const shortcuts = useAppStore((state) => state.shortcuts);
  const setShortcuts = useAppStore((state) => state.setShortcuts);
  const isMacApp = useAppStore((state) => state.isMacApp);
  const [dialogCommandId, setDialogCommandId] = useState<CommandId | null>(null);
  const [dialogShortcut, setDialogShortcut] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    commandId: CommandId;
    shortcut: string;
    conflictingCommandId: string;
  } | null>(null);

  const isMac = useMemo(
    () =>
      isMacApp ||
      (typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform)),
    [isMacApp],
  );

  const categoryCommands = useMemo(
    () =>
      COMMAND_DEFINITIONS.filter((command) => command.category === "navigation"),
    [],
  );

  const persistShortcuts = async (nextShortcuts: Record<string, string[]>) => {
    const previousShortcuts = shortcuts;
    setShortcuts(nextShortcuts);
    try {
      await request.updateSettings({ shortcuts: nextShortcuts });
      return true;
    } catch (error) {
      setShortcuts(previousShortcuts);
      toast.error(
        extractErrorMessage(error) ||
          t("settings.shortcuts.saveFailed", "Failed to save shortcuts."),
      );
      return false;
    }
  };

  const updateShortcut = async (command: AppCommandDefinition, shortcut: string) => {
    const nextShortcuts = { ...shortcuts };
    const nextValue = [shortcut];

    if (sameShortcuts(nextValue, command.defaultShortcuts)) {
      delete nextShortcuts[command.id];
    } else {
      nextShortcuts[command.id] = nextValue;
    }

    const nextConflict = findShortcutConflicts(COMMAND_DEFINITIONS, nextShortcuts).find((item) =>
      item.commandIds.includes(command.id),
    );
    if (nextConflict) {
      const conflictingCommandId = nextConflict.commandIds.find((id) => id !== command.id);
      if (conflictingCommandId) {
        setConflict({
          commandId: command.id,
          shortcut: nextConflict.shortcut,
          conflictingCommandId,
        });
      }
      return false;
    }

    setConflict(null);
    return persistShortcuts(nextShortcuts);
  };

  const clearShortcut = async (command: AppCommandDefinition) => {
    const nextShortcuts = { ...shortcuts, [command.id]: [] };
    setConflict(null);
    await persistShortcuts(nextShortcuts);
  };

  const resetShortcut = async (command: AppCommandDefinition) => {
    const nextShortcuts = { ...shortcuts };
    delete nextShortcuts[command.id];
    setConflict(null);
    await persistShortcuts(nextShortcuts);
  };

  const dialogCommand = dialogCommandId
    ? COMMAND_DEFINITIONS.find((command) => command.id === dialogCommandId)
    : undefined;

  const openShortcutDialog = (command: AppCommandDefinition) => {
    setConflict(null);
    setDialogCommandId(command.id);
    setDialogShortcut(getCommandShortcuts(command, shortcuts)[0] ?? null);
  };

  const closeShortcutDialog = () => {
    setDialogCommandId(null);
    setDialogShortcut(null);
    setConflict(null);
  };

  const confirmShortcutDialog = async () => {
    if (!dialogCommand || !dialogShortcut) return;
    const saved = await updateShortcut(dialogCommand, dialogShortcut);
    if (saved) closeShortcutDialog();
  };

  const dialogConflict =
    dialogCommandId && conflict?.commandId === dialogCommandId ? conflict : null;
  const dialogConflictingCommand = dialogConflict
    ? COMMAND_DEFINITIONS.find((command) => command.id === dialogConflict.conflictingCommandId)
    : undefined;

  return (
    <div className="flex h-full flex-1 flex-col">
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="w-full max-w-4xl space-y-6 px-5 py-4 mx-auto">
          <div>
            <h3 className="text-lg font-medium">{t("settings.shortcuts.title", "Shortcuts")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("settings.shortcuts.desc", "Customize keyboard shortcuts for common actions.")}
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.shortcuts.navigation", "Navigation")}
            </h4>
            <div className="divide-y divide-border border-y border-border">
              {categoryCommands.map((command) => {
                const shortcut = getCommandShortcuts(command, shortcuts)[0] ?? null;
                const hasOverride = Object.prototype.hasOwnProperty.call(shortcuts, command.id);
                return (
                  <div key={command.id} className="flex items-center justify-between gap-6 py-3">
                    <div className="min-w-0 flex-4">
                      <div className="text-sm font-medium">
                        {t(command.titleKey, command.id)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground/90">
                        {t(command.descriptionKey, "Focus this area")}
                      </div>
                    </div>
                    <div className="flex flex-1 shrink-0 items-center gap-1.5">
                      {shortcut ? (
                        <ShortcutKeys shortcut={shortcut} isMac={isMac} />
                      ) : (
                        <span className="min-w-24 text-center text-xs text-muted-foreground">
                          {t("settings.shortcuts.unassigned", "Unassigned")}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => openShortcutDialog(command)}
                      >
                        {t("settings.shortcuts.set", "Set")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        disabled={!shortcut}
                        onClick={() => void clearShortcut(command)}
                      >
                        {t("settings.shortcuts.delete", "Delete")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        disabled={!hasOverride}
                        onClick={() => void resetShortcut(command)}
                      >
                        {t("settings.shortcuts.restore", "Restore")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </ScrollArea>

      <Dialog
        open={Boolean(dialogCommandId)}
        onOpenChange={(open) => {
          if (!open) closeShortcutDialog();
        }}
      >
        <DialogContent showCloseButton={false} data-shortcut-capture="true">
          <DialogHeader>
            <DialogTitle>{t("settings.shortcuts.setTitle", "Set shortcut")}</DialogTitle>
          </DialogHeader>

          <p className="-mb-2 text-xs text-muted-foreground">
            {dialogCommand
                ? t(dialogCommand.titleKey, dialogCommand.id)
                : t("settings.shortcuts.setDesc", "Press the shortcut you want to use.")}
          </p>
          <ShortcutCapture
            shortcut={dialogShortcut}
            isMac={isMac}
            onCancel={closeShortcutDialog}
            onChange={setDialogShortcut}
          />

          {dialogConflict && (
            <p className="text-xs text-destructive -my-2">
              {t("settings.shortcuts.conflict", "Already used by {{command}}.", {
                command: dialogConflictingCommand
                  ? t(dialogConflictingCommand.titleKey, dialogConflictingCommand.id)
                  : dialogConflict.conflictingCommandId,
              })}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeShortcutDialog}>
              {t("settings.shortcuts.cancel", "Cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void confirmShortcutDialog()}
              disabled={!dialogShortcut}
            >
              {t("settings.shortcuts.confirm", "Confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
