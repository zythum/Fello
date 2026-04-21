import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { SettingsInfo } from "../../../shared/schema";
import { useAppStore } from "../../store";
import { request } from "../../backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, Pencil } from "lucide-react";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SettingsInfo["mcpServers"][number] | null>(null);

  const [envRaw, setEnvRaw] = useState<string>("");
  const [argsRaw, setArgsRaw] = useState<string>("");

  // Sync when mounted
  useEffect(() => {
    setMcpServers(configuredMcpServers);
    setEditingId(null);
    setEditForm(null);
    setEnvRaw("");
    setArgsRaw("");
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

  const handleAdd = () => {
    const internalEditingId = `__new_mcp_${Date.now()}_${Math.floor(Math.random() * 1000)}__`;

    const newMcp = { id: "", command: "", args: [], env: {} };
    setMcpServers([...mcpServers, { ...newMcp, id: internalEditingId }]);
    setEditingId(internalEditingId);
    setEditForm(newMcp);
    setEnvRaw("");
    setArgsRaw("");
  };

  const handleEdit = (mcp: SettingsInfo["mcpServers"][number]) => {
    setEditingId(mcp.id);
    setEditForm({ ...mcp });
    setEnvRaw(Object.keys(mcp.env || {}).length > 0 ? JSON.stringify(mcp.env) : "");
    setArgsRaw(mcp.args?.join(" ") || "");
  };

  const handleDelete = async (id: string) => {
    const updated = mcpServers.filter((a) => a.id !== id);
    setMcpServers(updated);
    if (editingId === id) {
      setEditingId(null);
      setEditForm(null);
    }
    await handleSave(updated);
  };

  const handleSaveEdit = async () => {
    if (!editForm) return;
    if (!editForm.id.trim() || !editForm.command.trim()) {
      toast.error(t("settings.mcp.errorIdCommand", "ID and Command are required."));
      return;
    }

    if (
      mcpServers.some(
        (a) => a.id === editForm.id && a.id !== editingId && !a.id.startsWith("__new_mcp_"),
      )
    ) {
      toast.error(t("settings.mcp.errorDuplicateId", "A server with this ID already exists."));
      return;
    }

    const nextEnv = parseEnvJson(envRaw);
    if (!nextEnv) {
      toast.error(t("settings.mcp.errorEnvJson", "Env must be a valid JSON object."));
      return;
    }

    const nextArgs = argsRaw.split(/\s+/).filter(Boolean);
    const nextEditForm = { ...editForm, env: nextEnv, args: nextArgs };
    const updated = mcpServers.map((a) => (a.id === editingId ? nextEditForm : a));
    setMcpServers(updated);
    setEditingId(null);
    setEditForm(null);
    await handleSave(updated);
  };

  const handleCancelEdit = () => {
    if (editingId && editingId.startsWith("__new_mcp_")) {
      setMcpServers(mcpServers.filter((a) => a.id !== editingId));
    }
    setEditingId(null);
    setEditForm(null);
  };

  const content = (
    <div className="space-y-2 mb-2 pt-2">
      <div className="flex items-center justify-between p-1">
        <h3 className="text-xs text-foreground/50">
          {t("settings.mcp.description", "Configure MCP Servers")}
        </h3>
        <Button
          variant="outline"
          size="xs"
          onClick={handleAdd}
          className="h-7 text-xs text-foreground/70"
        >
          <Plus className="mr-1 size-3" />
          {t("settings.mcp.addMcp", "Add MCP Server")}
        </Button>
      </div>

      <div className="border-t border-border -mx-4">
        <div className="space-y-1.5 m-3 pb-6">
          {mcpServers.map((mcp) => (
            <div
              key={mcp.id}
              className="flex items-center justify-between rounded-lg border p-1.5 text-sm bg-secondary/50"
            >
              {editingId === mcp.id && editForm ? (
                <div className="flex w-full flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`mcp-id-${mcp.id}`}
                      className="text-[11px] text-muted-foreground"
                    >
                      {t("settings.mcp.mcpId", "MCP Server ID")}
                    </label>
                    <Input
                      id={`mcp-id-${mcp.id}`}
                      placeholder={t("settings.mcp.mcpId", "MCP Server ID")}
                      value={editForm.id}
                      onChange={(e) => setEditForm({ ...editForm, id: e.target.value })}
                      className="h-8 text-xs! text-foreground/70 focus-visible:ring-0.5"
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex flex-1 flex-col gap-1">
                      <label
                        htmlFor={`mcp-command-${mcp.id}`}
                        className="text-[11px] text-muted-foreground"
                      >
                        {t("settings.mcp.command", "Command")}
                      </label>
                      <Input
                        id={`mcp-command-${mcp.id}`}
                        placeholder={t("settings.mcp.command", "Command")}
                        value={editForm.command}
                        onChange={(e) => setEditForm({ ...editForm, command: e.target.value })}
                        className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1">
                      <label
                        htmlFor={`mcp-args-${mcp.id}`}
                        className="text-[11px] text-muted-foreground"
                      >
                        {t("settings.mcp.args", "Arguments")}
                      </label>
                      <Input
                        id={`mcp-args-${mcp.id}`}
                        placeholder={t("settings.mcp.args", "Arguments")}
                        value={argsRaw}
                        onChange={(e) => setArgsRaw(e.target.value)}
                        className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`mcp-env-${mcp.id}`}
                      className="text-[11px] text-muted-foreground"
                    >
                      {t("settings.mcp.envVars", "Environment Variables (JSON)")}
                    </label>
                    <Textarea
                      id={`mcp-env-${mcp.id}`}
                      placeholder={t("settings.mcp.envJson", "Environment Variables (JSON)")}
                      value={envRaw}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEnvRaw(val);
                        const nextEnv = parseEnvJson(val);
                        if (nextEnv) {
                          setEditForm({ ...editForm, env: nextEnv });
                        }
                      }}
                      className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                    />
                  </div>
                  <div className="flex justify-end gap-2 mt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancelEdit}
                      className="h-7 text-xs"
                    >
                      {t("settings.mcp.cancel", "Cancel")}
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit} className="h-7 text-xs">
                      {t("settings.mcp.save", "Save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex w-full flex-row items-center gap-2">
                  <div className="flex min-w-8 truncate">
                    <span className="font-bold text-xs ml-1 truncate max-w-24 select-none">
                      {mcp.id}
                    </span>
                  </div>
                  <div className="text-[10px] flex-1 text-muted-foreground font-mono truncate">
                    {[mcp.command, ...(mcp.args || [])].join(" ")}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-50">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-6 text-foreground/80"
                      onClick={() => handleEdit(mcp)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-6 text-destructive/80 hover:text-destructive"
                      onClick={() => handleDelete(mcp.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {mcpServers.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t("settings.mcp.noMcpServers", "No MCP servers configured")}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">{t("settings.mcp.title", "MCP Servers")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.mcp.desc", "Manage MCP server configurations and startup commands.")}
        </p>
      </div>
      {content}
    </div>
  );
}
