import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Keyboard,
  Info,
  Plug,
  Bluetooth,
  ExternalLink,
  ShieldAlert,
  UsbCPort,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, extractErrorMessage } from "@/lib/utils";
import { isWebUI, request, subscribe } from "../../../backend";
import { electron } from "../../../electron";
import { useAppStore } from "../../../store";
import { useMessage } from "../../providers/message";
import {
  BUILTIN_PERIPHERALS,
  isPeripheralRuntimeAvailable,
  isPeripheralSupportedOnPlatform,
  type PeripheralDescriptor,
  type PeripheralPhase,
  type PeripheralSettingInfo,
  type PeripheralStatus,
  type PeripheralTransport,
} from "../../../../shared/peripherals";
import { RENDERER_PLATFORM } from "../../../lib/peripherals/platform";

const PHASE_CLASS: Record<PeripheralPhase, string> = {
  connected: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  unavailable: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  unsupported: "border-border bg-muted text-muted-foreground",
  inactive: "border-border bg-muted text-muted-foreground",
  // 「链路断了」与「没启用」必须区分：前者开关是 ON 的，显示「未生效」会自相矛盾
  disconnected: "border-border bg-muted text-muted-foreground",
  preparing: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  scanning: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  connecting: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

const TRANSPORT_ICON: Record<PeripheralTransport, LucideIcon> = {
  keyboard: Keyboard,
  hid: UsbCPort,
  bluetooth: Bluetooth,
};

/** 按内置枚举补齐设置数组：保存时把全部内置外设都写下来，避免顺序/缺项歧义。 */
function withEnabled(
  current: readonly PeripheralSettingInfo[],
  id: string,
  enabled: boolean,
): PeripheralSettingInfo[] {
  const previous = new Map(current.map((entry) => [entry.id, entry.enabled]));
  previous.set(id, enabled);
  return BUILTIN_PERIPHERALS.map((descriptor) => ({
    id: descriptor.id,
    enabled: previous.get(descriptor.id) ?? false,
  }));
}

export function SettingsPeripherals() {
  const { t } = useTranslation();
  const { peripherals, setPeripherals } = useAppStore();
  const { toast } = useMessage();
  const [statuses, setStatuses] = useState<Record<string, PeripheralStatus>>({});
  const platform = RENDERER_PLATFORM;
  const available = isPeripheralRuntimeAvailable({ isWebUI, platform });

  // 状态只用于展示（连接进度、HID 权限等），不参与任何门禁。
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    void electron.peripherals
      .getStatuses()
      .then((list) => {
        if (cancelled) return;
        setStatuses(Object.fromEntries(list.map((status) => [status.id, status])));
      })
      .catch(() => undefined);
    const handleStatus = (status: PeripheralStatus) => {
      setStatuses((previous) => ({ ...previous, [status.id]: status }));
    };
    subscribe.on("peripheral-status", handleStatus);
    return () => {
      cancelled = true;
      subscribe.off("peripheral-status", handleStatus);
    };
  }, [available]);

  const saveEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      const previous = peripherals;
      const next = withEnabled(peripherals, id, enabled);
      setPeripherals(next);
      try {
        await request.updateSettings({ peripherals: next });
      } catch (error) {
        setPeripherals(previous);
        toast.error(
          extractErrorMessage(error) ||
            t("settings.peripherals.updateFailed", "Failed to update peripheral settings."),
        );
      }
    },
    [peripherals, setPeripherals, t, toast],
  );

  /**
   * 手动重试连接。
   *
   * 生效之后主进程会**自动连接**，这个按钮只服务失败后的重试（遥控器没唤醒导致扫描超时、
   * 蓝牙刚被打开、授权刚给上……）。不做「断开」：断开只是临时放掉链路，用户一按 F5
   * 就会自动重连（`startVoice` 里会 ensureConnected），留着按钮反而误导 ——
   * 真要停用请关「生效」开关（那会同时停 HID 与 BLE）。
   */
  const handleReconnect = useCallback(
    async (id: string) => {
      try {
        await electron.peripherals.connect(id);
      } catch (error) {
        // 失败原因（超时 / 蓝牙未开 / 没配对）比固定文案有用得多，不能吞掉。
        toast.error(
          extractErrorMessage(error) ||
            t("settings.peripherals.connectFailed", "Failed to connect the peripheral."),
        );
      }
    },
    [t, toast],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-4xl px-5 py-4">
        <h3 className="text-lg font-medium">{t("settings.peripherals.title", "Peripherals")}</h3>
        <p className="text-sm text-muted-foreground">
          {t(
            "settings.peripherals.desc",
            "Connect Bluetooth / HID peripherals and enable the ones whose special behavior should apply.",
          )}
        </p>
      </div>

      {!available && (
        <div className="mx-auto w-full max-w-4xl px-4">
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t(
                "settings.peripherals.desktopOnly",
                "Peripherals are available in the desktop app only.",
              )}
            </span>
          </div>
        </div>
      )}

      <ScrollArea className="w-full flex-1 overflow-hidden">
        <div className={cn("mx-auto w-full max-w-4xl", !available && "opacity-50")}>
          <div className="m-5 space-y-3 pb-6">
            {BUILTIN_PERIPHERALS.map((descriptor) => (
              <PeripheralCard
                key={descriptor.id}
                descriptor={descriptor}
                platform={platform}
                available={available}
                enabled={peripherals.find((entry) => entry.id === descriptor.id)?.enabled ?? false}
                status={statuses[descriptor.id]}
                onToggle={saveEnabled}
                onReconnect={handleReconnect}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function PeripheralCard({
  descriptor,
  platform,
  available,
  enabled,
  status,
  onToggle,
  onReconnect,
}: {
  descriptor: PeripheralDescriptor;
  platform: string;
  available: boolean;
  enabled: boolean;
  status: PeripheralStatus | undefined;
  onToggle: (id: string, enabled: boolean) => void;
  onReconnect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const supported = isPeripheralSupportedOnPlatform(descriptor, platform);
  const productUrl = descriptor.productUrl;
  const interactive = available && supported;
  const phase = status?.phase ?? (supported ? "inactive" : "unsupported");
  // 「已连接」的含义由外设自己声明（蓝牙设备 = 蓝牙已连接，USB 设备可能是别的），
  // 这里只做展示，不参与门禁。
  const connected = phase === "connected";

  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{descriptor.name}</span>
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none",
                PHASE_CLASS[phase],
              )}
            >
              {t(`settings.peripherals.phase.${phase}`, phase)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {status?.message ??
              (supported
                ? t(descriptor.statusLabelKey, t("settings.peripherals.phase.inactive", "Inactive"))
                : t("settings.peripherals.unsupportedPlatform", "Not supported on this platform"))}
          </p>
          {status?.detail && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">{status.detail}</p>
          )}
        </div>
        <Switch
          size="sm"
          checked={enabled}
          disabled={!interactive}
          onCheckedChange={(next) => onToggle(descriptor.id, next)}
        />
      </div>

      <div className="mt-2 -ml-px flex flex-wrap items-center gap-1">
        {descriptor.keys.map((key) => {
          const Icon = TRANSPORT_ICON[key.transport];
          return (
            <span
              key={key.id}
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              <Icon className="size-3" />
              {t(key.labelKey, key.id)}
              {/* 键盘通道展示 code（F5），HID 通道展示注入的系统键（Escape） */}
              {(key.code ?? key.systemKey) && (
                <span className="font-mono text-muted-foreground/70">
                  {key.code ?? key.systemKey}
                </span>
              )}
            </span>
          );
        })}
        {descriptor.bluetooth && (
          <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t("settings.peripherals.voiceCapable", "Voice input")}
          </span>
        )}
        <div className="flex items-center gap-4 ml-2">
          {/* 商品页：纯外链，走 electron.openInBrowser（WebUI 下降级为 window.open） */}
          {productUrl ? (
            <button
              type="button"
              onClick={() => void electron.openInBrowser(productUrl)}
              className="inline-flex cursor-default items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              title={t("settings.peripherals.productPage", "Product page")}
            >
              <ExternalLink className="size-3" />
              {t("settings.peripherals.productPage", "Product page")}
            </button>
          ) : null}
          {enabled && interactive && descriptor.hid && (
            <button
              type="button"
              onClick={() => void electron.peripherals.openPermissionSettings()}
              className="inline-flex cursor-default items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              title={t(
                "settings.peripherals.permissionHint",
                "macOS requires the Input Monitoring permission for HID key input.",
              )}
            >
              <ShieldAlert className="size-3" />
              {t("settings.peripherals.openPermissionSettings", "Input Monitoring settings")}
            </button>
          )}
        </div>
        {/* 只在**未连接**时出现：已连接时没有任何可点的动作（自动连接已经覆盖正常路径）。
            这样按钮永远是可用的，不会出现点了没反应的状态。 */}
        {enabled && interactive && !connected && (
          <Button
            variant="outline"
            size="xs"
            className="ml-auto h-7 text-xs"
            onClick={() => onReconnect(descriptor.id)}
          >
            <Plug className="mr-1 size-3" />
            {t("settings.peripherals.reconnect", "Reconnect")}
          </Button>
        )}
      </div>
    </div>
  );
}
