import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HttpMcpServerInfo } from "../../../../shared/schema";
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
import { useMessage } from "../../providers/message";

interface SettingsMcpHttpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMcp: HttpMcpServerInfo | null;
  onSave: (mcp: HttpMcpServerInfo) => Promise<void> | void;
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

export function SettingsMcpHttpDialog({
  open,
  onOpenChange,
  initialMcp,
  onSave,
}: SettingsMcpHttpDialogProps) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const [draft, setDraft] = useState<HttpMcpServerInfo | null>(initialMcp);
  const [headersRaw, setHeadersRaw] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(initialMcp);
    setHeadersRaw(
      initialMcp && Object.keys(initialMcp.headers || {}).length > 0
        ? JSON.stringify(initialMcp.headers)
        : "",
    );
  }, [initialMcp, open]);

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.id.trim()) {
      toast.error(t("settings.mcp.errorIdRequired", "ID is required."));
      return;
    }
    if (!draft.url.trim()) {
      toast.error(t("settings.mcp.errorUrlRequired", "URL is required."));
      return;
    }
    const headers = parseStringMapJson(headersRaw);
    if (!headers) {
      toast.error(t("settings.mcp.errorHeadersJson", "Headers must be a valid JSON object."));
      return;
    }

    await onSave({
      ...draft,
      id: draft.id.trim(),
      url: draft.url.trim(),
      headers,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initialMcp?.id
              ? t("settings.mcp.editMcp", "Edit MCP Server")
              : t("settings.mcp.addHttpMcp", "Add HTTP MCP Server")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.mcp.httpDialogDesc",
              "Configure the MCP server ID, HTTP URL and request headers.",
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
                {t("settings.mcp.url", "URL")}
              </label>
              <Input
                placeholder={t("settings.mcp.url", "URL")}
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                {t("settings.mcp.headers", "Headers (JSON)")}
              </label>
              <Textarea
                placeholder={t("settings.mcp.headersJson", "Headers (JSON)")}
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
