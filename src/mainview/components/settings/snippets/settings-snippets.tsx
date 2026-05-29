import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { request } from "../../../backend";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { extractErrorMessage } from "@/lib/utils";
import { generateUUID } from "@/lib/utils";
import { useMessage } from "../../providers/message";
import type { SnippetInfo } from "../../../../shared/schema";
import { SettingsSnippetDialog } from "./settings-snippet-dialog";

export function SettingsSnippets() {
  const { t } = useTranslation();
  const { snippets, setSnippets } = useAppStore();
  const { toast, confirm } = useMessage();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogItem, setDialogItem] = useState<SnippetInfo | null>(null);

  const handleSave = async (updated: SnippetInfo[]) => {
    setSnippets(updated);
    try {
      await request.updateSettings({ snippets: updated });
    } catch (err) {
      toast.error(
        extractErrorMessage(err) || t("settings.snippets.saveFailed", "Failed to save snippets."),
      );
    }
  };

  const openAddDialog = () => {
    setDialogItem({ id: "", title: "", content: "" });
    setDialogOpen(true);
  };

  const openEditDialog = (s: SnippetInfo) => {
    setDialogItem({ ...s });
    setDialogOpen(true);
  };

  const handleDialogSave = async (snippet: SnippetInfo) => {
    const isNew = !snippet.id;
    const updated = isNew
      ? [...snippets, { ...snippet, id: generateUUID() }]
      : snippets.map((s) => (s.id === snippet.id ? snippet : s));
    setDialogOpen(false);
    setDialogItem(null);
    await handleSave(updated);
  };

  const handleDelete = async (id: string) => {
    const result = await confirm({
      title: t("settings.snippets.confirmDeleteTitle", "Delete Snippet"),
      content: t(
        "settings.snippets.confirmDeleteDesc",
        "Are you sure you want to delete this snippet? This action cannot be undone.",
      ),
    });
    if (!result) return;
    await handleSave(snippets.filter((s) => s.id !== id));
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-5 py-4 w-full max-w-4xl mx-auto">
        <h3 className="text-lg font-medium">{t("settings.snippets.title", "Snippets")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.snippets.desc", "Manage reusable text snippets for quick insertion.")}
        </p>
      </div>

      <div className="space-y-2 px-4 w-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between p-1">
          <h3 className="text-xs text-foreground/50">
            {t("settings.snippets.description", "Configure Snippets")}
          </h3>
          <Button
            variant="outline"
            size="xs"
            onClick={openAddDialog}
            className="h-7 text-xs text-foreground/70"
          >
            <Plus className="mr-1 size-3" />
            {t("settings.snippets.add", "Add Snippet")}
          </Button>
        </div>
        <div className="border-t border-border -mx-4"></div>
      </div>

      <ScrollArea className="flex-1 w-full overflow-hidden">
        <div className="w-full max-w-4xl mx-auto">
          <div className="space-y-3 m-5 pb-6">
            {snippets.map((s) => (
              <ContextMenu key={s.id}>
                <ContextMenuTrigger>
                  <div className="flex items-center gap-2 rounded-lg border p-1.5 min-h-10 text-sm bg-secondary/50 cursor-default select-none overflow-hidden">
                    <span className="font-bold text-xs ml-1 truncate shrink-0 max-w-32 select-none">
                      {s.title}
                    </span>
                    <span className="text-[10px] flex-1 w-0 text-muted-foreground font-mono truncate">
                      {s.content}
                    </span>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-32">
                  <ContextMenuItem onClick={() => openEditDialog(s)}>
                    <Pencil className="size-3" />
                    {t("settings.snippets.edit", "Edit")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={() => handleDelete(s.id)}>
                    <Trash2 className="size-3" />
                    {t("settings.snippets.delete", "Delete")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
            {snippets.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("settings.snippets.empty", "No snippets configured")}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <SettingsSnippetDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setDialogItem(null);
          }
        }}
        initialSnippet={dialogItem}
        onSave={handleDialogSave}
      />
    </div>
  );
}
