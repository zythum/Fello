import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { ApiAgentInfo } from "../../../../shared/schema";
import { request } from "../../../backend";
import { useAppStore } from "../../../store";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { extractErrorMessage } from "@/lib/utils";
import { useMessage } from "../../providers/message";

function isAssistantSourceAgent(agent: unknown): agent is ApiAgentInfo {
  if (!agent || typeof agent !== "object") return false;
  const candidate = agent as {
    type?: unknown;
    provider?: unknown;
    disabled?: unknown;
  };
  return (
    candidate.type === "api" &&
    candidate.provider === "openai-compatible" &&
    candidate.disabled !== true
  );
}

export function SettingsAssistant() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const configuredAgents = useAppStore((state) => state.configuredAgents);
  const configuredMcpServers = useAppStore((state) => state.configuredMcpServers);
  const assistant = useAppStore((state) => state.assistant);
  const setAssistant = useAppStore((state) => state.setAssistant);
  const { toast } = useMessage();
  const [isSaving, setIsSaving] = useState(false);
  // Null means "no pending edit": the input shows the saved value.
  const [maxContextDraft, setMaxContextDraft] = useState<string | null>(null);
  const [workerModelDraft, setWorkerModelDraft] = useState<string | null>(null);

  const availableAgents = useMemo(
    () => configuredAgents.filter(isAssistantSourceAgent),
    [configuredAgents],
  );
  const workerAgents = useMemo(
    () => configuredAgents.filter((agent) => !agent.disabled),
    [configuredAgents],
  );

  const updateAssistant = async (nextAssistant: typeof assistant, successMessage: string) => {
    const previous = assistant;
    setAssistant(nextAssistant);
    setIsSaving(true);
    try {
      await request.updateSettings({ assistant: nextAssistant });
      toast.success(successMessage);
    } catch (error) {
      setAssistant(previous);
      toast.error(
        extractErrorMessage(error) ||
          t("settings.assistant.updateFailed", "Failed to update Personal Assistant agent."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleEnabledChange = (enabled: boolean) =>
    updateAssistant(
      { ...assistant, enabled },
      t(
        enabled ? "settings.assistant.enabledUpdated" : "settings.assistant.disabledUpdated",
        enabled ? "Personal Assistant enabled." : "Personal Assistant disabled.",
      ),
    );

  const handleChange = (sourceAgentId: string | null) => {
    if (!sourceAgentId || sourceAgentId === assistant.sourceAgentId) return;
    return updateAssistant(
      { ...assistant, sourceAgentId },
      t("settings.assistant.updated", "Personal Assistant agent updated."),
    );
  };

  const handleDreamChange = (
    field: "maxContextTokens" | "preferredTime",
    value: number | string,
  ) => {
    const dream = { ...assistant.dream, [field]: value };
    return updateAssistant(
      { ...assistant, dream },
      t("settings.assistant.dreamUpdated", "Dream settings updated."),
    );
  };

  const commitMaxContextDraft = () => {
    const draft = maxContextDraft;
    setMaxContextDraft(null);
    if (draft === null) return;
    const value = Number(draft);
    if (Number.isSafeInteger(value) && value > 0 && value !== assistant.dream.maxContextTokens) {
      void handleDreamChange("maxContextTokens", value);
    }
  };

  const handleWorkerChange = (patch: Partial<typeof assistant.worker>) =>
    updateAssistant(
      { ...assistant, worker: { ...assistant.worker, ...patch } },
      t("settings.assistant.workerUpdated", "Worker settings updated."),
    );

  const commitWorkerModelDraft = () => {
    const draft = workerModelDraft;
    setWorkerModelDraft(null);
    if (draft === null) return;
    const nextModelId = draft.trim() || null;
    if (nextModelId !== assistant.worker.modelId) {
      void handleWorkerChange({ modelId: nextModelId });
    }
  };

  const toggleWorkerMcp = (id: string, enabled: boolean) => {
    const mcpServers = enabled
      ? [...new Set([...assistant.worker.mcpServers, id])]
      : assistant.worker.mcpServers.filter((candidate) => candidate !== id);
    void handleWorkerChange({ mcpServers });
  };

  return (
    <div className="flex h-full flex-1 flex-col">
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="mx-auto mb-4 w-full max-w-4xl space-y-6 px-5 py-4">
          <div>
            <h3 className="text-lg font-medium">
              {t("settings.assistant.title", "Personal Assistant")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t(
                "settings.assistant.desc",
                "Choose the enabled OpenAI-compatible API agent used by your Personal Assistant.",
              )}
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.assistant.groupGeneral", "General")}
            </h4>
            <div className="flex items-center justify-between gap-6">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium leading-none" htmlFor="assistant-enabled">
                  {t("settings.assistant.enabled", "Enable Personal Assistant")}
                </label>
                <span className="text-xs text-muted-foreground/90">
                  {t(
                    "settings.assistant.enabledDesc",
                    "Connect the assistant automatically while Fello is running.",
                  )}
                </span>
              </div>
              <Switch
                id="assistant-enabled"
                checked={assistant.enabled}
                disabled={isSaving}
                onCheckedChange={(checked) => void handleEnabledChange(checked)}
              />
            </div>
          </div>

          <div className="border-t border-border" />

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.assistant.groupModel", "Model")}
            </h4>
            {availableAgents.length === 0 ? (
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium leading-none">
                    {t("settings.assistant.sourceAgent", "Source agent")}
                  </span>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.empty",
                      "No enabled OpenAI-compatible API agents are available.",
                    )}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => navigate("/settings/agents")}
                >
                  {t("settings.assistant.configureAgents", "Configure agents")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-sm font-medium leading-none"
                    htmlFor="assistant-source-agent"
                  >
                    {t("settings.assistant.sourceAgent", "Source agent")}
                  </label>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.sourceAgentDesc",
                      "Its API key and model catalog are reused. Changing it restarts the assistant.",
                    )}
                  </span>
                </div>
                <Select
                  value={assistant.sourceAgentId ?? ""}
                  onValueChange={handleChange}
                  disabled={isSaving}
                >
                  <SelectTrigger id="assistant-source-agent" size="sm" className="w-44 shrink-0">
                    <SelectValue
                      placeholder={t("settings.assistant.selectAgent", "Select an agent")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAgents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="border-t border-border" />

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.assistant.groupDream", "Dream")}
            </h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-sm font-medium leading-none"
                    htmlFor="assistant-dream-max-context"
                  >
                    {t("settings.assistant.dreamMaxContext", "Max context tokens")}
                  </label>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.dreamMaxContextDesc",
                      "Schedule Dream before assistant context reaches this limit.",
                    )}
                  </span>
                </div>
                <Input
                  id="assistant-dream-max-context"
                  type="number"
                  min={1}
                  step={1}
                  className="w-36 shrink-0"
                  value={maxContextDraft ?? String(assistant.dream.maxContextTokens)}
                  onChange={(event) => setMaxContextDraft(event.target.value)}
                  onBlur={commitMaxContextDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-sm font-medium leading-none"
                    htmlFor="assistant-dream-preferred-time"
                  >
                    {t("settings.assistant.dreamPreferredTime", "Preferred time")}
                  </label>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.dreamPreferredTimeDesc",
                      "Preferred local time for a future Dream run.",
                    )}
                  </span>
                </div>
                <Input
                  id="assistant-dream-preferred-time"
                  type="time"
                  className="w-36 shrink-0"
                  value={assistant.dream.preferredTime}
                  onChange={(event) => void handleDreamChange("preferredTime", event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border" />

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.assistant.groupWorker", "Worker")}
            </h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-sm font-medium leading-none"
                    htmlFor="assistant-worker-agent"
                  >
                    {t("settings.assistant.workerAgent", "Worker agent")}
                  </label>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.workerAgentDesc",
                      "Agent used by background workers. New workers use it; running workers keep their agent.",
                    )}
                  </span>
                </div>
                <Select
                  value={assistant.worker.agentId ?? ""}
                  onValueChange={(value) => void handleWorkerChange({ agentId: value || null })}
                  disabled={isSaving}
                >
                  <SelectTrigger id="assistant-worker-agent" size="sm" className="w-44 shrink-0">
                    <SelectValue
                      placeholder={t("settings.assistant.selectAgent", "Select an agent")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {workerAgents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-sm font-medium leading-none"
                    htmlFor="assistant-worker-model"
                  >
                    {t("settings.assistant.workerModel", "Worker model")}
                  </label>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.workerModelDesc",
                      "Leave empty to use the agent's default model.",
                    )}
                  </span>
                </div>
                <Input
                  id="assistant-worker-model"
                  className="w-44 shrink-0"
                  placeholder={t("settings.assistant.workerModelPlaceholder", "Agent default")}
                  value={workerModelDraft ?? assistant.worker.modelId ?? ""}
                  onChange={(event) => setWorkerModelDraft(event.target.value)}
                  onBlur={commitWorkerModelDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium leading-none">
                    {t("settings.assistant.workerMcp", "Worker MCP servers")}
                  </span>
                  <span className="text-xs text-muted-foreground/90">
                    {t(
                      "settings.assistant.workerMcpDesc",
                      "MCP servers passed to every worker session.",
                    )}
                  </span>
                </div>
                {configuredMcpServers.length === 0 ? (
                  <span className="text-xs text-muted-foreground/70">
                    {t("settings.assistant.workerMcpEmpty", "No MCP servers configured.")}
                  </span>
                ) : (
                  <div className="space-y-2">
                    {configuredMcpServers.map((server) => (
                      <div key={server.id} className="flex items-center justify-between gap-6">
                        <span className="text-sm">{server.id}</span>
                        <Switch
                          checked={assistant.worker.mcpServers.includes(server.id)}
                          disabled={isSaving}
                          onCheckedChange={(checked) => toggleWorkerMcp(server.id, checked)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
