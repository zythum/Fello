import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { request, isWebUI } from "../../../backend";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { extractErrorMessage } from "@/lib/utils";
import { useMessage } from "../../providers/message";
import { electron } from "../../../electron";
import type { SettingProxyInfo } from "../../../../shared/schema";

type ProxyMode = SettingProxyInfo["mode"];

interface SettingsProxyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsProxyDialog({ open, onOpenChange }: SettingsProxyDialogProps) {
  const { t } = useTranslation();
  const proxy = useAppStore((s) => s.proxy);
  const setProxy = useAppStore((s) => s.setProxy);
  const { toast, alert, confirm } = useMessage();

  const [draft, setDraft] = useState<SettingProxyInfo>(() => ({
    mode: proxy.mode ?? "off",
    httpProxy: proxy.httpProxy ?? "",
    httpsProxy: proxy.httpsProxy ?? "",
    noProxy: proxy.noProxy ?? "",
    username: proxy.username ?? "",
    password: proxy.password ?? "",
  }));
  useEffect(() => {
    if (!open) return;
    setDraft({
      mode: proxy.mode ?? "off",
      httpProxy: proxy.httpProxy ?? "",
      httpsProxy: proxy.httpsProxy ?? "",
      noProxy: proxy.noProxy ?? "",
      username: proxy.username ?? "",
      password: proxy.password ?? "",
    });
  }, [open, proxy]);

  const updateDraft = (patch: Partial<SettingProxyInfo>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleModeChange = (mode: string | null) => {
    if (!mode) return;
    updateDraft({ mode: mode as ProxyMode });
  };

  const handleSave = async () => {
    const trimStr = (value?: string): string | undefined => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    };
    const next: SettingProxyInfo = {
      mode: draft.mode,
      httpProxy: trimStr(draft.httpProxy),
      httpsProxy: trimStr(draft.httpsProxy),
      noProxy: trimStr(draft.noProxy),
      username: trimStr(draft.username),
      password: trimStr(draft.password),
    };

    if (next.mode === "manual") {
      if (!next.httpProxy) {
        toast.error(
          t(
            "settings.proxy.validation.httpProxyRequired",
            "HTTP proxy URL is required in manual mode.",
          ),
        );
        return;
      }
      for (const [field, value] of [
        [t("settings.proxy.httpProxy", "HTTP Proxy"), next.httpProxy],
        [t("settings.proxy.httpsProxy", "HTTPS proxy"), next.httpsProxy],
      ] as const) {
        const v = value?.trim();
        if (v && !/^https?:\/\//i.test(v) && !/^[^/]+:\d+$/i.test(v)) {
          toast.error(
            t(
              "settings.proxy.validation.invalidProxyUrl",
              "{{field}} should start with http:// or https://, or use a host:port address (e.g. http://127.0.0.1:7890).",
              { field },
            ),
          );
          return;
        }
      }
    }

    try {
      await request.updateSettings({ proxy: next });
      setProxy(next);
      onOpenChange(false);

      if (isWebUI) {
        await alert({
          title: t("settings.proxy.restartTitle", "Restart Required"),
          content: t(
            "settings.proxy.restartManualDesc",
            "Proxy settings saved. Please manually restart the Fello server process to apply the new configuration.",
          ),
        });
        return;
      }

      const result = await confirm({
        title: t("settings.proxy.restartTitle", "Restart Required"),
        content: t(
          "settings.proxy.restartDesc",
          "Proxy settings saved. Restart Fello to apply the new proxy configuration.",
        ),
        buttons: [
          { text: t("settings.proxy.later", "Later"), value: null, variant: "outline" },
          {
            text: t("settings.proxy.restartNow", "Restart Now"),
            value: "confirm",
            variant: "default",
          },
        ],
      });
      if (result) {
        await electron.restartApp();
      }
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.proxy.saveFailed", "Failed to save proxy settings."),
      );
    }
  };

  const modeItems = [
    { value: "off", label: t("settings.proxy.off", "Direct") },
    { value: "manual", label: t("settings.proxy.manual", "Manual") },
    { value: "system", label: t("settings.proxy.system", "System") },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settings.proxy.title", "Network Proxy")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* ── Mode ── */}
          <div className="flex items-center justify-between gap-4">
            <Field className="gap-1">
              <FieldLabel className="text-xs text-muted-foreground">
                {t("settings.proxy.mode", "Proxy Mode")}
              </FieldLabel>
              <span className="text-[10px] text-muted-foreground/70">
                {draft.mode === "off" &&
                  t("settings.proxy.offDesc", "Connect directly without a proxy")}
                {draft.mode === "manual" &&
                  t(
                    "settings.proxy.manualDesc",
                    "Specify a proxy server manually for all network requests",
                  )}
                {draft.mode === "system" &&
                  t(
                    "settings.proxy.systemDesc",
                    "Use the system proxy settings (macOS/Windows or environment variables)",
                  )}
              </span>
            </Field>
            <Select items={modeItems} value={draft.mode} onValueChange={handleModeChange}>
              <SelectTrigger size="sm" className="w-35 text-[11px]!">
                <SelectValue placeholder="Mode" />
              </SelectTrigger>
              <SelectContent>
                {modeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.mode === "manual" && (
            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor="proxy-http" className="text-[11px] text-muted-foreground">
                  {t("settings.proxy.httpProxy", "HTTP Proxy")}
                </FieldLabel>
                <Input
                  id="proxy-http"
                  type="text"
                  value={draft.httpProxy ?? ""}
                  onChange={(e) => updateDraft({ httpProxy: e.target.value })}
                  placeholder={t(
                    "settings.proxy.httpProxyPlaceholder",
                    "e.g. http://127.0.0.1:7890",
                  )}
                  className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="proxy-https" className="text-[11px] text-muted-foreground">
                  {t("settings.proxy.httpsProxy", "HTTPS Proxy (optional)")}
                </FieldLabel>
                <Input
                  id="proxy-https"
                  type="text"
                  value={draft.httpsProxy ?? ""}
                  onChange={(e) => updateDraft({ httpsProxy: e.target.value })}
                  placeholder={t(
                    "settings.proxy.httpProxyPlaceholder",
                    "e.g. http://127.0.0.1:7890",
                  )}
                  className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
                <p className="text-[10px] text-muted-foreground/70">
                  {t("settings.proxy.httpsProxyHint", "Falls back to the HTTP proxy when empty.")}
                </p>
              </Field>
              <Field>
                <FieldLabel htmlFor="proxy-no-proxy" className="text-[11px] text-muted-foreground">
                  {t("settings.proxy.noProxy", "No Proxy (optional)")}
                </FieldLabel>
                <Input
                  id="proxy-no-proxy"
                  type="text"
                  value={draft.noProxy ?? ""}
                  onChange={(e) => updateDraft({ noProxy: e.target.value })}
                  placeholder={t(
                    "settings.proxy.noProxyPlaceholder",
                    "e.g. localhost,127.0.0.1,*.internal",
                  )}
                  className="h-8 text-[11px]! font-mono text-foreground/70 focus-visible:ring-0.5"
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel
                    htmlFor="proxy-username"
                    className="text-[11px] text-muted-foreground"
                  >
                    {t("settings.proxy.username", "Username (optional)")}
                  </FieldLabel>
                  <Input
                    id="proxy-username"
                    type="text"
                    value={draft.username ?? ""}
                    onChange={(e) => updateDraft({ username: e.target.value })}
                    className="h-8 text-[11px]! text-foreground/70 focus-visible:ring-0.5"
                  />
                </Field>
                <Field>
                  <FieldLabel
                    htmlFor="proxy-password"
                    className="text-[11px] text-muted-foreground"
                  >
                    {t("settings.proxy.password", "Password (optional)")}
                  </FieldLabel>
                  <Input
                    id="proxy-password"
                    type="password"
                    value={draft.password ?? ""}
                    onChange={(e) => updateDraft({ password: e.target.value })}
                    className="h-8 text-[11px]! text-foreground/70 focus-visible:ring-0.5"
                  />
                </Field>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs"
          >
            {t("settings.proxy.cancel", "Cancel")}
          </Button>
          <Button type="button" size="sm" className="h-7 text-xs" onClick={handleSave}>
            {t("settings.proxy.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
