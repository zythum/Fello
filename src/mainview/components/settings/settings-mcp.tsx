import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { SettingsInfo } from "../../../shared/schema";
import { useAppStore } from "../../store";
import { request } from "../../backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { extractErrorMessage } from "@/lib/utils";
import { useMessage } from "../providers/message";

function parseEnvJson(raw: string): Record<string, string> | null {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") return null;
    env[k] = v;
  }
  return env;
}

export function SettingsMcp() {
  const { t } = useTranslation();
  const { configuredMcpServers, setConfiguredMcpServers } = useAppStore();
  const { toast } = useMessage();
  const [mcpServers, setMcpServers] = useState<SettingsInfo["mcpServers"]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogItem, setDialogItem] = useState<SettingsInfo["mcpServers"][number] | null>(null);
  const [dialogOriginalId, setDialogOriginalId] = useState<string | null>(null);
  const [dialogEnvRaw, setDialogEnvRaw] = useState("");
  const [dialogArgsRaw, setDialogArgsRaw] = useState("");

  // Sync when mounted
  useEffect(() => {
    setMcpServers(configuredMcpServers);
  }, [configuredMcpServers]);

  const handleSave = async (updatedMcpServers: SettingsInfo["mcpServers"]) => {
    try {
      await request.updateSettings({ mcpServers: updatedMcpServers });
      setConfiguredMcpServers(updatedMcpServers);
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.mcp.updateFailed", "Failed to update configuration."),
      );
    }
  };

  const openAddDialog = () => {
    const newMcp: SettingsInfo["mcpServers"][number] = {
      id: "",
      command: "",
      args: [],
      env: {},
      disabled: false,
    };
    setDialogItem(newMcp);
    setDialogOriginalId(null);
    setDialogEnvRaw("");
    setDialogArgsRaw("");
    setDialogOpen(true);
  };

  const openEditDialog = (mcp: SettingsInfo["mcpServers"][number]) => {
    setDialogItem({ ...mcp });
    setDialogOriginalId(mcp.id);
    setDialogEnvRaw(Object.keys(mcp.env || {}).length > 0 ? JSON.stringify(mcp.env) : "");
    setDialogArgsRaw(mcp.args?.join(" ") || "");
    setDialogOpen(true);
  };

  const handleDialogSave = async () => {
    if (!dialogItem) return;
    if (!dialogItem.id.trim() || !dialogItem.command.trim()) {
      toast.error(t("settings.mcp.errorIdCommand", "ID and Command are required."));
      return;
    }

    const isNew = dialogOriginalId === null;
    const duplicate = mcpServers.some(
      (a) => a.id === dialogItem.id && a.id !== dialogOriginalId && !a.id.startsWith("__new_mcp_"),
    );
    if (duplicate) {
      toast.error(t("settings.mcp.errorDuplicateId", "A server with this ID already exists."));
      return;
    }

    const nextEnv = parseEnvJson(dialogEnvRaw);
    if (!nextEnv) {
      toast.error(t("settings.mcp.errorEnvJson", "Env must be a valid JSON object."));
      return;
    }

    const nextArgs = dialogArgsRaw.split(/\s+/).filter(Boolean);
    const finalItem = { ...dialogItem, env: nextEnv, args: nextArgs };

    let updated: SettingsInfo["mcpServers"];
    if (isNew) {
      updated = [...mcpServers, finalItem];
    } else {
      updated = mcpServers.map((a) => (a.id === dialogOriginalId ? finalItem : a));
    }

    setMcpServers(updated);
    setDialogOpen(false);
    setDialogItem(null);
    setDialogOriginalId(null);
    await handleSave(updated);
  };

  const handleDialogCancel = () => {
    setDialogOpen(false);
    setDialogItem(null);
    setDialogOriginalId(null);
  };

  const handleDelete = async (id: string) => {
    const updated = mcpServers.filter((a) => a.id !== id);
    setMcpServers(updated);
    await handleSave(updated);
  };

  const handleToggleDisabled = async (id: string, disabled: boolean) => {
    const updated = mcpServers.map((a) => (a.id === id ? { ...a, disabled } : a));
    setMcpServers(updated);
    await handleSave(updated);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-5 py-4 w-full max-w-4xl mx-auto">
        <h3 className="text-lg font-medium">{t("settings.mcp.title", "MCP Servers")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.mcp.desc", "Manage MCP server configurations and startup commands.")}
        </p>
      </div>

      <div className="space-y-2 px-5 w-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between p-1">
          <h3 className="text-xs text-foreground/50">
            {t("settings.mcp.description", "Configure MCP Servers")}
          </h3>
          <Button
            variant="outline"
            size="xs"
            onClick={openAddDialog}
            className="h-7 text-xs text-foreground/70"
          >
            <Plus className="mr-1 size-3" />
            {t("settings.mcp.addMcp", "Add MCP Server")}
          </Button>
        </div>
        <div className="border-t border-border -mx-4"></div>
      </div>

      <ScrollArea className="flex-1 w-full overflow-hidden">
        <div className="w-full max-w-4xl mx-auto">
          <div className="space-y-3 m-3 pb-6">
            {mcpServers.map((mcp) => (
              <ContextMenu key={mcp.id}>
                <ContextMenuTrigger>
                  <div className="flex items-center justify-between rounded-lg border p-1.5 h-10 text-sm bg-secondary/50 cursor-default select-none">
                    <div className="flex w-full flex-row items-center gap-2">
                      <div className="flex min-w-8 truncate">
                        <span
                          className={`font-bold text-xs ml-1 truncate max-w-24 select-none ${mcp.disabled ? "text-muted-foreground/50 line-through" : ""}`}
                        >
                          {mcp.id}
                        </span>
                      </div>
                      <div className="text-[10px] flex-1 text-muted-foreground font-mono truncate">
                        {[mcp.command, ...(mcp.args || [])].join(" ")}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          size="sm"
                          checked={!mcp.disabled}
                          onCheckedChange={(checked) => handleToggleDisabled(mcp.id, !checked)}
                        />
                      </div>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-32">
                  <ContextMenuItem onClick={() => openEditDialog(mcp)}>
                    <Pencil className="size-3" />
                    {t("common.edit", "Edit")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={() => handleDelete(mcp.id)}>
                    <Trash2 className="size-3" />
                    {t("common.delete", "Delete")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
            {mcpServers.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("settings.mcp.noMcpServers", "No MCP servers configured")}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialogOriginalId
                ? t("settings.mcp.editMcp", "Edit MCP Server")
                : t("settings.mcp.addMcp", "Add MCP Server")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "settings.mcp.dialogDesc",
                "Configure the MCP server ID, command, arguments and environment variables.",
              )}
            </DialogDescription>
          </DialogHeader>

          {dialogItem && (
            <div className="flex flex-col gap-3 py-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">
                  {t("settings.mcp.mcpId", "MCP Server ID")}
                </label>
                <Input
                  placeholder={t("settings.mcp.mcpId", "MCP Server ID")}
                  value={dialogItem.id}
                  onChange={(e) => setDialogItem({ ...dialogItem, id: e.target.value })}
                  className="h-8 text-xs! text-foreground/70 focus-visible:ring-0.5"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-[11px] text-muted-foreground">
                    {t("settings.mcp.command", "Command")}
                  </label>
                  <Input
                    placeholder={t("settings.mcp.command", "Command")}
                    value={dialogItem.command}
                    onChange={(e) => setDialogItem({ ...dialogItem, command: e.target.value })}
                    className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-[11px] text-muted-foreground">
                    {t("settings.mcp.args", "Arguments")}
                  </label>
                  <Input
                    placeholder={t("settings.mcp.args", "Arguments")}
                    value={dialogArgsRaw}
                    onChange={(e) => setDialogArgsRaw(e.target.value)}
                    className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">
                  {t("settings.mcp.envVars", "Environment Variables (JSON)")}
                </label>
                <Textarea
                  placeholder={t("settings.mcp.envJson", "Environment Variables (JSON)")}
                  value={dialogEnvRaw}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDialogEnvRaw(val);
                    const nextEnv = parseEnvJson(val);
                    if (nextEnv) {
                      setDialogItem({ ...dialogItem, env: nextEnv });
                    }
                  }}
                  className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDialogCancel}
              className="h-7 text-xs"
            >
              {t("settings.mcp.cancel", "Cancel")}
            </Button>
            <Button size="sm" onClick={handleDialogSave} className="h-7 text-xs">
              {t("settings.mcp.save", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
