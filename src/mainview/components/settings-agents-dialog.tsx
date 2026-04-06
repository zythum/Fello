import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { request } from "../backend";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Plus, Pencil } from "lucide-react";
import type { AgentConfig } from "../store";

export function SettingsAgentsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { configuredAgents, setConfiguredAgents, pushGlobalErrorMessage } = useAppStore();
  const [agents, setAgents] = useState<AgentConfig[]>(configuredAgents);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AgentConfig | null>(null);

  const [envRaw, setEnvRaw] = useState<string>("");

  useEffect(() => {
    if (open) {
      setAgents(configuredAgents);
      setEditingId(null);
      setEditForm(null);
      setEnvRaw("");
    }
  }, [open, configuredAgents]);

  const handleSave = async (updatedAgents: AgentConfig[]) => {
    try {
      const { theme } = useAppStore.getState();
      await request.updateSettings({ agents: updatedAgents, theme });
      setConfiguredAgents(updatedAgents);
    } catch (err) {
      pushGlobalErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAdd = () => {
    // Generate a temporary internal editing ID for the new item.
    // The user will specify the actual Agent ID in the input field.
    const internalEditingId = `__new_agent_${Date.now()}_${Math.floor(Math.random() * 1000)}__`;

    const newAgent = { id: "", command: "", args: [], env: {} };
    // Temporarily set the agent's ID to the internal editing ID so we can track it
    // during the edit session. It will be replaced by the user's input when saved.
    setAgents([...agents, { ...newAgent, id: internalEditingId }]);
    setEditingId(internalEditingId);
    setEditForm(newAgent);
    setEnvRaw("");
  };

  const handleEdit = (agent: AgentConfig) => {
    setEditingId(agent.id);
    setEditForm({ ...agent });
    setEnvRaw(Object.keys(agent.env || {}).length > 0 ? JSON.stringify(agent.env) : "");
  };

  const handleDelete = async (id: string) => {
    const updated = agents.filter((a) => a.id !== id);
    setAgents(updated);
    if (editingId === id) {
      setEditingId(null);
      setEditForm(null);
    }
    await handleSave(updated);
  };

  const handleSaveEdit = async () => {
    if (!editForm) return;
    if (!editForm.id.trim() || !editForm.command.trim()) {
      pushGlobalErrorMessage(t("settings.errorIdCommand"));
      return;
    }

    if (
      agents.some(
        (a) => a.id === editForm.id && a.id !== editingId && !a.id.startsWith("__new_agent_"),
      )
    ) {
      pushGlobalErrorMessage(t("settings.errorDuplicateId"));
      return;
    }

    if (envRaw.trim()) {
      try {
        const parsed = JSON.parse(envRaw.trim());
        if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
          throw new Error(t("settings.errorEnvJson"));
        }
      } catch {
        pushGlobalErrorMessage(t("settings.errorEnvJson"));
        return;
      }
    }

    const updated = agents.map((a) => (a.id === editingId ? editForm : a));
    setAgents(updated);
    setEditingId(null);
    setEditForm(null);
    await handleSave(updated);
  };

  const handleCancelEdit = () => {
    // If the cancelled edit was a brand-new unsaved agent, remove it from the list
    if (editingId && editingId.startsWith("__new_agent_")) {
      setAgents(agents.filter((a) => a.id !== editingId));
    }
    setEditingId(null);
    setEditForm(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={true} className="sm:max-w-xl gap-0.5">
        <DialogHeader className="mb-2 gap-1">
          <DialogTitle className="flex items-center gap-1 text-md">
            {t("settings.agents")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 mb-2 pt-2">
          <div className="flex items-center justify-between p-1">
            <h3 className="text-xs text-foreground/50">{t("settings.description")}</h3>
            <Button variant="outline" size="xs" onClick={handleAdd} className="h-7 text-xs text-foreground/70">
              <Plus className="mr-1 size-3" />
              {t("settings.addAgent")}
            </Button>
          </div>

          <ScrollArea className="h-80 border-t border-border -mx-4 -mb-6">
            <div className="space-y-1.5 m-3">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between rounded-lg border p-1.5 text-sm bg-secondary/50"
                >
                  {editingId === agent.id && editForm ? (
                    <div className="flex w-full flex-col gap-2">
                      <Input
                        placeholder={t("settings.agentId")}
                        value={editForm.id}
                        onChange={(e) => setEditForm({ ...editForm, id: e.target.value })}
                        className="h-8 text-xs! text-foreground/80 focus-visible:ring-0.5"
                      />
                      <div className="flex gap-2">
                        <Input
                          placeholder={t("settings.command")}
                          value={editForm.command}
                          onChange={(e) => setEditForm({ ...editForm, command: e.target.value })}
                          className="h-8 text-[11px]! font-mono flex-4 text-foreground/80 focus-visible:ring-0.5"
                        />
                        <Input
                          placeholder={t("settings.args")}
                          value={editForm.args?.join(" ") || ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              args: e.target.value.split(/\s+/).filter(Boolean),
                            })
                          }
                          className="h-8 text-[11px]! font-mono flex-1 text-foreground/80 focus-visible:ring-0.5"
                        />
                      </div>
                      <Input
                        placeholder={t("settings.envJson")}
                        value={envRaw}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEnvRaw(val);
                          const trimmed = val.trim();
                          if (!trimmed) {
                            setEditForm({ ...editForm, env: {} });
                            return;
                          }
                          try {
                            const parsed = JSON.parse(trimmed);
                            if (
                              typeof parsed === "object" &&
                              !Array.isArray(parsed) &&
                              parsed !== null
                            ) {
                              // Ensure all values are strings
                              const stringifiedEnv: Record<string, string> = {};
                              for (const [k, v] of Object.entries(parsed)) {
                                stringifiedEnv[k] = String(v);
                              }
                              setEditForm({ ...editForm, env: stringifiedEnv });
                            }
                          } catch {
                            // Let the user keep typing invalid JSON without throwing errors
                          }
                        }}
                        className="h-8 text-[11px]! font-mono text-foreground/80 focus-visible:ring-0.5"
                      />
                      <div className="flex justify-end gap-2 mt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelEdit}
                          className="h-7 text-xs text-foreground/70"
                        >
                          {t("settings.cancel")}
                        </Button>
                        <Button size="sm" onClick={handleSaveEdit} className="h-7 text-xs text-foreground/70">
                          {t("settings.save")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full flex-row items-center gap-2">
                      <div className="flex min-w-8 font-normal truncate">
                        <span className="">{agent.id}</span>
                      </div>
                      <div className="text-[10px] flex-1 text-muted-foreground font-mono truncate">
                        {[agent.command, ...(agent.args || [])].join(" ")}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-6 text-foreground/80"
                          onClick={() => handleEdit(agent)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-6 text-destructive/80 hover:text-destructive"
                          onClick={() => handleDelete(agent.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {agents.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("settings.noAgents")}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
