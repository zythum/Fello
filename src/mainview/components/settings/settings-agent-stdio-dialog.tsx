import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StdioAgentInfo } from "../../../shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMessage } from "../providers/message";

interface SettingsAgentStdioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAgent: StdioAgentInfo | null;
  onSave: (agent: StdioAgentInfo) => Promise<void> | void;
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

export function SettingsAgentStdioDialog({
  open,
  onOpenChange,
  initialAgent,
  onSave,
}: SettingsAgentStdioDialogProps) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const [draft, setDraft] = useState<StdioAgentInfo | null>(initialAgent);
  const [argsRaw, setArgsRaw] = useState("");
  const [envRaw, setEnvRaw] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(initialAgent);
    setArgsRaw(initialAgent?.args?.join(" ") || "");
    setEnvRaw(
      initialAgent && Object.keys(initialAgent.env || {}).length > 0
        ? JSON.stringify(initialAgent.env)
        : "",
    );
  }, [initialAgent, open]);

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.id.trim() || !draft.command.trim()) {
      toast.error(t("settings.agents.errorIdCommand"));
      return;
    }

    const env = parseStringMapJson(envRaw);
    if (!env) {
      toast.error(t("settings.agents.errorEnvJson"));
      return;
    }

    await onSave({
      ...draft,
      id: draft.id.trim(),
      command: draft.command.trim(),
      args: argsRaw.split(/\s+/).filter(Boolean),
      env,
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
              "settings.agents.dialogDesc",
              "Configure the agent ID, command, arguments and environment variables.",
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
                  {t("settings.agents.command")}
                </label>
                <Input
                  placeholder={t("settings.agents.command")}
                  value={draft.command}
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                  className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">
                  {t("settings.agents.args")}
                </label>
                <Input
                  placeholder={t("settings.agents.args")}
                  value={argsRaw}
                  onChange={(e) => setArgsRaw(e.target.value)}
                  className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                {t("settings.agents.envVars", "Env vars")}
              </label>
              <Textarea
                placeholder={t("settings.agents.envJson")}
                value={envRaw}
                onChange={(e) => setEnvRaw(e.target.value)}
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
