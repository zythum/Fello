import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StdioMcpServerInfo } from "../../../shared/schema";
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

interface SettingsMcpStdioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMcp: StdioMcpServerInfo | null;
  onSave: (mcp: StdioMcpServerInfo) => Promise<void> | void;
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

export function SettingsMcpStdioDialog({
  open,
  onOpenChange,
  initialMcp,
  onSave,
}: SettingsMcpStdioDialogProps) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const [draft, setDraft] = useState<StdioMcpServerInfo | null>(initialMcp);
  const [argsRaw, setArgsRaw] = useState("");
  const [envRaw, setEnvRaw] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(initialMcp);
    setArgsRaw(initialMcp?.args?.join(" ") || "");
    setEnvRaw(
      initialMcp && Object.keys(initialMcp.env || {}).length > 0
        ? JSON.stringify(initialMcp.env)
        : "",
    );
  }, [initialMcp, open]);

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.id.trim() || !draft.command.trim()) {
      toast.error(t("settings.mcp.errorIdCommand", "ID and Command are required."));
      return;
    }
    const env = parseStringMapJson(envRaw);
    if (!env) {
      toast.error(t("settings.mcp.errorEnvJson", "Env must be a valid JSON object."));
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
            {initialMcp?.id
              ? t("settings.mcp.editMcp", "Edit MCP Server")
              : t("settings.mcp.addStdioMcp", "Add Stdio MCP Server")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.mcp.dialogDesc",
              "Configure the MCP server ID, command, arguments and environment variables.",
            )}
          </DialogDescription>
        </DialogHeader>

        {draft && (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                {t("settings.mcp.mcpId", "MCP Server ID")}
              </label>
              <Input
                placeholder={t("settings.mcp.mcpId", "MCP Server ID")}
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                className="h-8 text-xs! text-foreground/70 focus-visible:ring-0.5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                {t("settings.mcp.command", "Command")}
              </label>
              <Input
                placeholder={t("settings.mcp.command", "Command")}
                value={draft.command}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                {t("settings.mcp.args", "Arguments")}
              </label>
              <Textarea
                placeholder={t("settings.mcp.args", "Arguments")}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                value={argsRaw}
                onChange={(e) => setArgsRaw(e.target.value)}
                className="text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5 min-h-[60px] break-all max-w-full"
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                {t("settings.mcp.envVars", "Environment Variables (JSON)")}
              </label>
              <Textarea
                placeholder={t("settings.mcp.envJson", "Environment Variables (JSON)")}
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
            {t("settings.mcp.cancel", "Cancel")}
          </Button>
          <Button size="sm" onClick={handleSave} className="h-7 text-xs">
            {t("settings.mcp.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
