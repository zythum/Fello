import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { request, subscribe, isWebUI } from "../../../backend";
import { openGuide } from "@/lib/open-guide";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/lib/clipboard";
import { electron } from "../../../electron";
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { extractErrorMessage } from "@/lib/utils";
import { useMessage } from "../../providers/message";
import type {
  TunnelInfo,
  TunnelProvider,
  TunnelProviderInfo,
  TunnelStatus,
} from "../../../../shared/schema";

type TunnelProviderMeta = {
  /** CLI 可执行名，用于「未安装」提示 */
  command: string;
  /** 官网 / 官方文档地址（点击 provider 名称打开） */
  homepage: string;
  /** CLI 登录 / 鉴权提示的 i18n key */
  hintKey: string;
  /** 对应 locale 缺失时的英文兜底 */
  hintFallback: string;
};

/**
 * provider 专属文案。用 Record<TunnelProvider, ...> 而不是 `=== "devtunnel"` 三元判断：
 * 新增 TunnelProvider 时 TypeScript 会强制补齐，不会静默落到某个默认分支。
 */
const TUNNEL_PROVIDER_META: Record<TunnelProvider, TunnelProviderMeta> = {
  devtunnel: {
    command: "devtunnel",
    homepage: "https://learn.microsoft.com/zh-cn/azure/developer/dev-tunnels/get-started",
    hintKey: "settings.webui.tunnelDevtunnelHint",
    hintFallback: "Log in once with `devtunnel user login` before starting.",
  },
  ngrok: {
    command: "ngrok",
    homepage: "https://ngrok.com/",
    hintKey: "settings.webui.tunnelNgrokHint",
    hintFallback: "Configure your authtoken first: `ngrok config add-authtoken <token>`.",
  },
};

const TUNNEL_PROVIDERS = Object.keys(TUNNEL_PROVIDER_META) as TunnelProvider[];

/** 把单个 provider 的最新状态合并进列表，避免事件回调与请求回调各写一份。 */
function mergeProviderStatus(prev: TunnelInfo | null, status: TunnelStatus): TunnelInfo | null {
  if (!prev) return prev;
  return {
    providers: prev.providers.map((info) =>
      info.provider === status.provider ? { ...info, ...status } : info,
    ),
  };
}

/**
 * 公网隧道设置。
 *
 * 只在 WebUI 开启时挂载：WebUI 关闭后后端会自动停掉隧道，组件卸载即可丢弃状态，
 * 下次开启时重新检测本机 CLI（避免安装 / 卸载 CLI 后一直看到旧结果）。
 * 每个提供方各自独立，devtunnel 与 ngrok 可以同时开启；状态以后端的
 * `tunnel-status-changed` 事件为准（启动中 → 已就绪 / 出错 / 已停止）。
 */
function WebUITunnelSection() {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const [tunnelInfo, setTunnelInfo] = useState<TunnelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [detectFailed, setDetectFailed] = useState(false);
  const [busy, setBusy] = useState<Partial<Record<TunnelProvider, boolean>>>({});
  const [copied, setCopied] = useState<TunnelProvider | null>(null);

  useEffect(() => {
    let cancelled = false;
    request
      .getTunnelStatus({ refresh: true })
      .then((info) => {
        if (cancelled) return;
        setTunnelInfo(info);
        setDetectFailed(false);
      })
      .catch(() => {
        if (!cancelled) setDetectFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleTunnelStatusChanged = (detail: { status: TunnelStatus }) => {
      setTunnelInfo((prev) => mergeProviderStatus(prev, detail.status));
    };
    subscribe.on("tunnel-status-changed", handleTunnelStatusChanged);
    return () => subscribe.off("tunnel-status-changed", handleTunnelStatusChanged);
  }, []);

  const applyStatus = (status: TunnelStatus) => {
    setTunnelInfo((prev) => mergeProviderStatus(prev, status));
  };

  const setProviderBusy = (provider: TunnelProvider, value: boolean) => {
    setBusy((prev) => ({ ...prev, [provider]: value }));
  };

  const refreshProviders = async () => {
    setLoading(true);
    try {
      setTunnelInfo(await request.getTunnelStatus({ refresh: true }));
      setDetectFailed(false);
    } catch (err) {
      setDetectFailed(true);
      toast.error(
        extractErrorMessage(err) ||
          t("settings.webui.tunnelDetectFailed", "Failed to detect tunnel CLIs."),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (provider: TunnelProvider) => {
    setProviderBusy(provider, true);
    try {
      applyStatus(await request.startTunnel({ provider }));
    } catch (err) {
      const errorMessage = extractErrorMessage(err);
      // 用户在「正在启动」时点了取消：后端会以 cancelled 结束，不需要再弹错误。
      if (!/cancelled|already starting/i.test(errorMessage)) {
        toast.error(
          errorMessage || t("settings.webui.tunnelUpdateFailed", "Failed to update the tunnel."),
        );
      }
      // 启动失败时后端已把 state 置为 error，重新拉一次拿完整错误信息。
      request
        .getTunnelStatus({})
        .then(setTunnelInfo)
        .catch(() => {});
    } finally {
      setProviderBusy(provider, false);
    }
  };

  const handleStop = async (provider: TunnelProvider) => {
    setProviderBusy(provider, true);
    try {
      applyStatus(await request.stopTunnel({ provider }));
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.webui.tunnelUpdateFailed", "Failed to update the tunnel."),
      );
    } finally {
      setProviderBusy(provider, false);
    }
  };

  const handleCopy = async (provider: TunnelProvider, url: string | null) => {
    if (!url) return;
    await copyText(url);
    setCopied(provider);
    setTimeout(() => setCopied(null), 3000);
  };

  const providerInfos: TunnelProviderInfo[] =
    tunnelInfo?.providers ??
    TUNNEL_PROVIDERS.map((provider): TunnelProviderInfo => ({
      provider,
      installed: false,
      state: "stopped",
      url: null,
      error: null,
    }));

  return (
    <div className="space-y-4 mb-2 pt-4 border-t border-border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm text-foreground/70">
            {t("settings.webui.tunnel", "Public tunnel")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              "settings.webui.tunnelDesc",
              "Expose this WebUI to the internet through devtunnel or ngrok.",
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 text-xs text-muted-foreground"
          disabled={loading}
          onClick={() => void refreshProviders()}
        >
          <RefreshCw className={loading ? "size-3 animate-spin" : "size-3"} />
          {t("settings.webui.tunnelRefresh", "Re-detect")}
        </Button>
      </div>

      {loading && !tunnelInfo ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("settings.webui.tunnelDetecting", "Detecting tunnel CLIs…")}
        </div>
      ) : detectFailed && !tunnelInfo ? (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{t("settings.webui.tunnelDetectFailed", "Failed to detect tunnel CLIs.")}</span>
        </div>
      ) : (
        <ItemGroup className="gap-2">
          {providerInfos.map((info) => {
            const isStarting = info.state === "starting";
            const isRunning = info.state === "running";
            const isError = info.state === "error";
            const isBusy = busy[info.provider] ?? false;
            const meta = TUNNEL_PROVIDER_META[info.provider];
            const badgeLabel = isStarting
              ? t("settings.webui.tunnelStarting", "Starting…")
              : isRunning
                ? t("settings.webui.tunnelRunning", "Running")
                : isError
                  ? t("settings.webui.tunnelFailed", "Failed")
                  : info.installed
                    ? t("settings.webui.tunnelInstalled", "Detected")
                    : t("settings.webui.tunnelNotInstalled", "Not installed");
            const badgeClass = isStarting
              ? "rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400"
              : isRunning
                ? "rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                : isError
                  ? "rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive"
                  : "rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground";
            return (
              <Item
                key={info.provider}
                variant="outline"
                size="sm"
                className="gap-y-2 py-2 bg-muted/30"
              >
                <ItemContent className="min-w-0">
                  <ItemTitle className="gap-2">
                    <button
                      type="button"
                      onClick={() => void electron.openInBrowser(meta.homepage)}
                      title={`${t("settings.webui.tunnelWebsite", "Official website")} — ${meta.homepage}`}
                      className="cursor-default font-mono text-sm font-medium transition-colors hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                    >
                      {info.provider}
                    </button>
                    <span className={badgeClass}>{badgeLabel}</span>
                  </ItemTitle>
                  <ItemDescription className="text-xs">
                    {info.installed
                      ? t(meta.hintKey, meta.hintFallback)
                      : t(
                          "settings.webui.tunnelInstallHint",
                          "Install the {{command}} CLI and make sure it is on PATH.",
                          { command: meta.command },
                        )}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {isStarting && (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  )}
                  <Switch
                    checked={isStarting || isRunning}
                    // starting 时保持可操作（关掉即取消启动）；运行中即使检测结果变成未安装也必须能关闭，
                    // 否则 CLI 被移除后隧道会卡在「只能关 WebUI 才能停」的状态。
                    disabled={
                      (!info.installed && !isStarting && !isRunning) || (isBusy && !isStarting)
                    }
                    aria-label={info.provider}
                    onCheckedChange={(checked) => {
                      if (checked) void handleStart(info.provider);
                      else void handleStop(info.provider);
                    }}
                  />
                </ItemActions>

                {isRunning && info.url && (
                  <ItemFooter className="flex-col items-stretch justify-start gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {t("settings.webui.tunnelAccessUrl", "Tunnel URL:")}
                    </span>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        readOnly
                        value={info.url}
                        className="h-8 text-xs! font-mono text-foreground/70 focus-visible:ring-0.5 bg-background"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8 shrink-0"
                        onClick={() => void handleCopy(info.provider, info.url)}
                        title={t("settings.webui.copy", "Copy")}
                      >
                        {copied === info.provider ? (
                          <Check className="size-4 text-green-500" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </Button>
                    </div>
                  </ItemFooter>
                )}

                {isError && info.error && (
                  <ItemFooter className="items-start justify-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    <span className="whitespace-pre-wrap break-all">{info.error}</span>
                  </ItemFooter>
                )}
              </Item>
            );
          })}
        </ItemGroup>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {t(
            "settings.webui.tunnelSecurity",
            "A public tunnel exposes this Fello instance to the internet: anyone with the full URL (including the token) can operate it remotely (read/write files, run terminal commands, chat with AI). If Fello runs on a company network, an office computer, or any other sensitive environment, confirm your network and security policies before enabling a tunnel, and turn it off as soon as you are done.",
          )}
        </span>
      </div>
    </div>
  );
}

export function SettingsWebUI() {
  const { t, i18n } = useTranslation();
  const { webUIStatus } = useAppStore();
  const { toast } = useMessage();
  const [copied, setCopied] = useState(false);
  const [customPort, setCustomPort] = useState<string>("");
  const [customToken, setCustomToken] = useState<string>("");

  const handleToggle = async (checked: boolean) => {
    try {
      if (checked) {
        const portNum = customPort.trim() ? parseInt(customPort, 10) : undefined;
        const status = await request.startWebUIServer({
          port: portNum && !isNaN(portNum) ? portNum : undefined,
          token: customToken.trim() || undefined,
        });
        useAppStore.getState().setWebUIStatus(status);
      } else {
        const status = await request.stopWebUIServer();
        useAppStore.getState().setWebUIStatus(status);
      }
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("settings.webui.updateFailed", "Failed to update configuration."),
      );
    }
  };

  const handleCopy = async () => {
    if (webUIStatus.url) {
      await copyText(webUIStatus.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  if (isWebUI) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="space-y-6 px-5 py-4 w-full max-w-4xl mx-auto">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">{t("settings.webui.title", "WebUI Settings")}</h3>
              <button
                type="button"
                onClick={() => openGuide(i18n.language, "webui.md")}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-default"
              >
                <BookOpen className="size-3.5" />
                {t("settings.webui.guide", "User Guide")}
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                "settings.webui.disabledInWebUI",
                "WebUI configuration is disabled when running inside the browser.",
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="space-y-6 px-5 py-4 w-full max-w-4xl mx-auto">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">{t("settings.webui.title", "WebUI Settings")}</h3>
              <button
                type="button"
                onClick={() => openGuide(i18n.language, "webui.md")}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-default"
              >
                <BookOpen className="size-3.5" />
                {t("settings.webui.guide", "User Guide")}
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("settings.webui.desc", "Configure remote access to the Fello interface.")}
            </p>
          </div>
          <div className="space-y-4 mb-2 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm text-foreground/70">
                {t("settings.webui.enable", "Enable WebUI")}
              </h3>
              <Switch checked={webUIStatus.enabled} onCheckedChange={handleToggle} />
            </div>

            {!webUIStatus.enabled && (
              <div className="flex gap-2 mt-2">
                <div className="flex flex-col gap-2 flex-1">
                  <span className="text-xs text-muted-foreground">
                    {t("settings.webui.port", "Port:")}
                  </span>
                  <Input
                    type="text"
                    placeholder={t("settings.webui.autoGenerated", "Auto-generated")}
                    value={customPort}
                    onChange={(e) => setCustomPort(e.target.value)}
                    disabled={webUIStatus.enabled}
                    className="h-8 text-xs! font-mono"
                  />
                </div>
                <div className="flex flex-col gap-2 flex-2">
                  <span className="text-xs text-muted-foreground">
                    {t("settings.webui.token", "Token:")}
                  </span>
                  <Input
                    type="text"
                    placeholder={t("settings.webui.autoGenerated", "Auto-generated")}
                    value={customToken}
                    onChange={(e) => setCustomToken(e.target.value)}
                    disabled={webUIStatus.enabled}
                    className="h-8 text-xs! font-mono"
                  />
                </div>
              </div>
            )}

            {webUIStatus.enabled && webUIStatus.url && (
              <div className="flex flex-col gap-2 mt-4">
                <span className="text-xs text-muted-foreground">
                  {t("settings.webui.accessUrl", "Access URL:")}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    readOnly
                    value={webUIStatus.url}
                    className="h-8 text-xs! font-mono text-foreground/70 focus-visible:ring-0.5 bg-background"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={handleCopy}
                    title={t("settings.webui.copy", "Copy")}
                  >
                    {copied ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {t(
                "settings.webui.note",
                "Note: This URL contains a temporary token. The WebUI will be disabled when you restart the application.",
              )}
            </p>
          </div>

          {webUIStatus.enabled && <WebUITunnelSection />}
        </div>
      </ScrollArea>
    </div>
  );
}
