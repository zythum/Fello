import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiAgentInfo } from "../../../shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMessage } from "../providers/message";

interface SettingsAgentApiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAgent: ApiAgentInfo | null;
  onSave: (agent: ApiAgentInfo) => Promise<void> | void;
}

function parseStringMapJson(raw: string): Record<string, string> | null {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const output: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") return null;
    output[k] = v;
  }
  return output;
}

export function SettingsAgentApiDialog({
  open,
  onOpenChange,
  initialAgent,
  onSave,
}: SettingsAgentApiDialogProps) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const [draft, setDraft] = useState<ApiAgentInfo | null>(initialAgent);
  const [headersRaw, setHeadersRaw] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(initialAgent);
    setHeadersRaw(
      initialAgent && Object.keys(initialAgent.headers || {}).length > 0
        ? JSON.stringify(initialAgent.headers)
        : "",
    );
  }, [initialAgent, open]);

  const handleSave = async () => {
    if (!draft) return;
    if (
      !draft.id.trim() ||
      !draft.provider.trim() ||
      !draft.baseUrl.trim() ||
      !draft.apiKey.trim()
    ) {
      toast.error(
        t(
          "settings.agents.errorApiRequired",
          "Please provide agent ID, provider, base URL, and API key.",
        ),
      );
      return;
    }

    const headers = parseStringMapJson(headersRaw);
    if (!headers) {
      toast.error(t("settings.agents.errorEnvJson", "Invalid JSON object."));
      return;
    }

    await onSave({
      ...draft,
      id: draft.id.trim(),
      provider: draft.provider.trim() as ApiAgentInfo["provider"],
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      headers,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initialAgent?.id
              ? t("settings.agents.editAgent", "Edit Agent")
              : t("settings.agents.addAgent", "Add Agent")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.agents.apiDialogDesc",
              "Configure provider, endpoint and authentication for API agent.",
            )}
          </DialogDescription>
        </DialogHeader>

        {draft && (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                {t("settings.agents.agentId")}
              </label>
              <Input
                placeholder={t("settings.agents.agentId")}
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                className="h-8 text-xs! text-foreground/70 focus-visible:ring-0.5"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">
                  {t("settings.agents.apiProvider", "Provider")}
                </label>
                <Select
                  value={draft.provider}
                  onValueChange={(value) =>
                    setDraft({ ...draft, provider: value as ApiAgentInfo["provider"] })
                  }
                >
                  <SelectTrigger className="w-full text-[11px]! font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-compatible">openai-compatible</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                {t("settings.agents.apiBaseUrl", "Base URL")}
              </label>
              <Input
                value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                {t("settings.agents.apiKey", "API Key")}
              </label>
              <Input
                type="password"
                placeholder="sk-..."
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                {t("settings.agents.apiHeaders", "Headers (JSON)")}
              </label>
              <Textarea
                placeholder='{ "name": "value" }'
                value={headersRaw}
                onChange={(e) => setHeadersRaw(e.target.value)}
                className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs"
          >
            {t("settings.agents.cancel")}
          </Button>
          <Button size="sm" onClick={handleSave} className="h-7 text-xs">
            {t("settings.agents.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
