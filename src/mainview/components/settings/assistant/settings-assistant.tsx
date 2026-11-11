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
  const assistant = useAppStore((state) => state.assistant);
  const setAssistant = useAppStore((state) => state.setAssistant);
  const { toast } = useMessage();
  const [isSaving, setIsSaving] = useState(false);

  const availableAgents = useMemo(
    () => configuredAgents.filter(isAssistantSourceAgent),
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
                  <label className="text-sm font-medium leading-none" htmlFor="assistant-source-agent">
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
        </div>
      </ScrollArea>
    </div>
  );
}
