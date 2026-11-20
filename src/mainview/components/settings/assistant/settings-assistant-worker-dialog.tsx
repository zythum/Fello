import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentInfo,
  Feature,
  McpServerInfo,
  SettingAssistantWorkerType,
} from "../../../../shared/schema";
import { FEATURE_I18N_KEYS, WORKER_FEATURES } from "../../../../shared/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { McpToggleGrid } from "../../common/mcp-toggle-grid";

function createEmptyType(
  agents: AgentInfo[],
  defaultFeatures: Feature[],
  defaultMcpServers: string[],
): SettingAssistantWorkerType {
  return {
    id: "",
    name: "",
    description: "",
    enabled: true,
    agentId: agents[0]?.id ?? null,
    modelId: null,
    permissionMode: "ask",
    features: [
      ...new Set(defaultFeatures.filter((feature) => WORKER_FEATURES.includes(feature))),
    ],
    mcpServers: [...new Set(defaultMcpServers)],
    instructions: "",
  };
}

function DialogField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function SettingsAssistantWorkerDialog({
  open,
  onOpenChange,
  initialType,
  agents,
  mcpServers,
  defaultFeatures,
  defaultMcpServers,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType: SettingAssistantWorkerType | null;
  agents: AgentInfo[];
  mcpServers: McpServerInfo[];
  /** Global feature defaults used when creating a new worker type. */
  defaultFeatures: Feature[];
  /** Enabled global MCP server ids used when creating a new worker type. */
  defaultMcpServers: string[];
  /** Return false to keep the dialog open (for example on a duplicate id). */
  onSave: (type: SettingAssistantWorkerType) => Promise<boolean> | boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<SettingAssistantWorkerType>(() =>
    initialType
      ? {
          ...initialType,
          features: [...(initialType.features ?? [])],
          mcpServers: [...(initialType.mcpServers ?? [])],
          instructions: initialType.instructions ?? "",
          enabled: initialType.enabled ?? true,
          permissionMode: initialType.permissionMode ?? "ask",
        }
      : createEmptyType(agents, defaultFeatures, defaultMcpServers),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isEditing = !!initialType;

  const toggleFeature = (feature: SettingAssistantWorkerType["features"][number]) => {
    setForm((current) => ({
      ...current,
      features: current.features.includes(feature)
        ? current.features.filter((item) => item !== feature)
        : [...current.features, feature],
    }));
  };

  const toggleMcp = (id: string, checked: boolean) => {
    setForm((current) => ({
      ...current,
      mcpServers: checked
        ? [...new Set([...current.mcpServers, id])]
        : current.mcpServers.filter((item) => item !== id),
    }));
  };

  const submit = async () => {
    const name = form.name.trim();
    if (!name) {
      setError(t("settings.assistant.workerType.required", "Name is required."));
      return;
    }
    if (!form.agentId) {
      setError(t("settings.assistant.workerType.selectAgent", "Select an agent."));
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave({
        ...form,
        id: form.id.trim(),
        name,
        description: form.description.trim(),
        modelId: form.modelId?.trim() || null,
        features: form.features.filter((feature) => WORKER_FEATURES.includes(feature)),
        instructions: form.instructions.trim(),
      });
      if (saved) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? t("settings.assistant.workerType.edit", "Edit worker type")
              : t("settings.assistant.workerType.add", "Add worker type")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.assistant.workerType.dialogDesc",
              "Describe when the assistant should use this type, then choose its agent, features and MCP servers.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto py-1 pr-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <DialogField label={t("settings.assistant.workerType.name", "Name (display)")}>
                <Input
                  value={form.name}
                  placeholder="Coder"
                  className="h-7 text-xs!"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </DialogField>

              <DialogField
                label={t(
                  "settings.assistant.workerType.description",
                  "Description (for selection)",
                )}
              >
                <Textarea
                  value={form.description}
                  rows={2}
                  placeholder={t(
                    "settings.assistant.workerType.descriptionPlaceholder",
                    "Use for coding, refactors and code review.",
                  )}
                  className="resize-y text-xs!"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </DialogField>

              <div className="grid grid-cols-2 gap-3">
                <DialogField label={t("settings.assistant.workerType.agent", "Agent")}>
                  <Select
                    value={form.agentId ?? ""}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, agentId: value || null }))
                    }
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue
                        placeholder={t(
                          "settings.assistant.workerType.selectAgent",
                          "Select an agent",
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </DialogField>

                <DialogField label={t("settings.assistant.workerType.model", "Model")}>
                  <Input
                    value={form.modelId ?? ""}
                    placeholder={t(
                      "settings.assistant.workerType.modelPlaceholder",
                      "Agent default",
                    )}
                    className="h-7 text-xs!"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        modelId: event.target.value || null,
                      }))
                    }
                  />
                </DialogField>
              </div>

              <DialogField label={t("settings.assistant.workerType.permission", "Permission")}>
                <Tabs
                  value={form.permissionMode}
                  onValueChange={(value) => {
                    if (value === "ask" || value === "allow-all") {
                      setForm((current) => ({ ...current, permissionMode: value }));
                    }
                  }}
                  className="w-full"
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="ask" className="text-xs">
                      {t("settings.assistant.workerType.permissionAsk", "Ask")}
                    </TabsTrigger>
                    <TabsTrigger value="allow-all" className="text-xs">
                      {t("settings.assistant.workerType.permissionAllowAll", "Allow all")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </DialogField>

              <DialogField
                label={t("settings.assistant.workerType.instructions", "Instructions (prompt)")}
              >
                <Textarea
                  value={form.instructions}
                  rows={8}
                  placeholder={t(
                    "settings.assistant.workerType.instructionsPlaceholder",
                    "Describe the worker's role, working style and expected output.",
                  )}
                  className="min-h-30 resize-y text-xs!"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, instructions: event.target.value }))
                  }
                />
              </DialogField>
            </div>

            <div className="flex min-w-0 flex-col gap-3 sm:border-l sm:border-border sm:pl-4">
              <DialogField label={t("settings.assistant.workerType.features", "Features")}>
                <div className="grid grid-cols-2 gap-1">
                  {WORKER_FEATURES.map((feature) => {
                    const checked = form.features.includes(feature);
                    return (
                      <div
                        key={feature}
                        className="flex h-7 cursor-default items-center justify-between gap-2 rounded border bg-secondary/50 px-2 text-xs transition-colors hover:bg-accent"
                        onClick={() => toggleFeature(feature)}
                      >
                        <span className="truncate">
                          {t(FEATURE_I18N_KEYS[feature], { defaultValue: feature })}
                        </span>
                        <div onClick={(event) => event.stopPropagation()}>
                          <Switch
                            size="sm"
                            checked={checked}
                            onCheckedChange={() => toggleFeature(feature)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </DialogField>

              <DialogField label={t("settings.assistant.workerType.mcp", "MCP servers")}>
                {mcpServers.length === 0 ? (
                  <span className="text-xs text-muted-foreground/70">
                    {t("settings.assistant.workerType.mcpEmpty", "No MCP servers configured.")}
                  </span>
                ) : (
                  <McpToggleGrid
                    servers={mcpServers}
                    selected={form.mcpServers}
                    disabled={saving}
                    onToggle={toggleMcp}
                  />
                )}
              </DialogField>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onOpenChange(false)}
          >
            {t("settings.assistant.workerType.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            disabled={saving}
            onClick={() => void submit()}
          >
            {t("settings.assistant.workerType.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
