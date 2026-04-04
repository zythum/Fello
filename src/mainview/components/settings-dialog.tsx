import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { request } from "../backend";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Plus, Pencil } from "lucide-react";
import type { AgentConfig } from "../store";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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

  const handleSave = async () => {
    try {
      await request.updateSettings({ agents });
      setConfiguredAgents(agents);
      onOpenChange(false);
    } catch (err) {
      pushGlobalErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAdd = () => {
    const newId = `agent-${Date.now()}`;
    const newAgent = { id: newId, name: "New Agent", command: "", args: [], env: {} };
    setAgents([...agents, newAgent]);
    setEditingId(newId);
    setEditForm(newAgent);
    setEnvRaw("");
  };

  const handleEdit = (agent: AgentConfig) => {
    setEditingId(agent.id);
    setEditForm({ ...agent });
    setEnvRaw(Object.keys(agent.env || {}).length > 0 ? JSON.stringify(agent.env) : "");
  };

  const handleDelete = (id: string) => {
    setAgents(agents.filter((a) => a.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setEditForm(null);
    }
  };

  const handleSaveEdit = () => {
    if (!editForm) return;
    if (!editForm.name.trim() || !editForm.command.trim()) {
      pushGlobalErrorMessage("Name and Command are required.");
      return;
    }

    if (envRaw.trim()) {
      try {
        const parsed = JSON.parse(envRaw.trim());
        if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
          throw new Error("Env must be a valid JSON object");
        }
      } catch {
        pushGlobalErrorMessage("Env must be a valid JSON object.");
        return;
      }
    }

    setAgents(agents.map((a) => (a.id === editForm.id ? editForm : a)));
    setEditingId(null);
    setEditForm(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure available AI agents and their launch commands.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Agents</h3>
            <Button variant="outline" size="sm" onClick={handleAdd} className="h-7 text-xs">
              <Plus className="mr-1 size-3" />
              Add Agent
            </Button>
          </div>

          <ScrollArea className="h-60 rounded-md border p-2">
            <div className="space-y-2">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between rounded-lg border p-2 text-sm"
                >
                  {editingId === agent.id && editForm ? (
                    <div className="flex w-full flex-col gap-2">
                      <Input
                        placeholder="Agent Name (e.g. Kiro)"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="h-8 text-xs"
                      />
                      <div className="flex gap-2">
                        <Input
                          placeholder="Command (e.g. kiro-cli)"
                          value={editForm.command}
                          onChange={(e) => setEditForm({ ...editForm, command: e.target.value })}
                          className="h-8 text-xs font-mono flex-1"
                        />
                        <Input
                          placeholder="Args (e.g. acp)"
                          value={editForm.args?.join(" ") || ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              args: e.target.value.split(/\s+/).filter(Boolean),
                            })
                          }
                          className="h-8 text-xs font-mono flex-2"
                        />
                      </div>
                      <Input
                        placeholder='Env JSON (e.g. {"API_KEY": "..."})'
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
                        className="h-8 text-xs font-mono"
                      />
                      <div className="flex justify-end gap-2 mt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelEdit}
                          className="h-6 text-xs"
                        >
                          Cancel
                        </Button>
                        <Button size="sm" onClick={handleSaveEdit} className="h-6 text-xs">
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col min-w-0 gap-1 flex-1 pr-4">
                        <span className="font-medium truncate">{agent.name}</span>
                        <span className="text-xs text-muted-foreground font-mono truncate">
                          {[agent.command, ...(agent.args || [])].join(" ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => handleEdit(agent)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(agent.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {agents.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No agents configured.
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
