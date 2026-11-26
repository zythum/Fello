import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, CircleCheck, Download, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractErrorMessage } from "@/lib/utils";
import { electron } from "../../electron";
import { useAppStore } from "../../store";
import { useMessage } from "../providers/message";

const RELEASES_URL = "https://github.com/Zythum/fello/releases";

/** 版本对应的 GitHub Release 页；没有版本号时回退到 releases 列表。 */
function releaseUrlFor(version: string | undefined): string {
  return version ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL;
}

/**
 * 侧边栏底部的升级卡片。
 *
 * 取代原来的顶部 toast：更新提示不再抢占视野，而是安静地停留在「设置」上方，
 * 由用户自己决定什么时候更新 / 重启。卡片本身不提供取消 / 隐藏入口。
 *
 * 状态完全来自 store（由 App.tsx 统一订阅 electron 的 updater 事件写入），
 * 这里只负责展示和触发动作。
 */
export function UpdateCard() {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const updaterEvent = useAppStore((s) => s.updaterEvent);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    // 安装失败 / 状态切回可操作时复位本地的「重启中」，否则卡片会永远停在禁用态。
    // eslint-disable-next-line react/set-state-in-effect
    if (updaterEvent?.type !== "downloaded") setIsInstalling(false);
  }, [updaterEvent]);

  if (!updaterEvent) return null;

  const showActionError = (error: unknown) => {
    toast.error(extractErrorMessage(error) || t("updater.actionFailed", "Update action failed"));
  };

  const hasUpdateInfo =
    updaterEvent.type === "available" ||
    updaterEvent.type === "downloaded" ||
    updaterEvent.type === "download-failed" ||
    updaterEvent.type === "install-failed";
  const version = hasUpdateInfo ? updaterEvent.info.version : undefined;
  const versionLabel = hasUpdateInfo
    ? version
      ? `v${version}`
      : t("updater.newVersion", "a new version")
    : null;
  const releaseUrl = versionLabel ? releaseUrlFor(version) : null;
  /**
   * 各状态固定为「标题 + 说明 + 操作区」三行，切换状态时卡片高度不变。
   * 下载中没有版本号，用一句提示占住说明行，避免卡片突然变矮。
   */
  const description =
    updaterEvent.type === "download-progress"
      ? t("updater.downloadingHint", "Restart when finished")
      : updaterEvent.type === "downloaded"
        ? t("updater.restartToInstall", "Restart to install {{version}}.", {
            version: versionLabel ?? "",
          })
        : updaterEvent.type === "download-failed"
          ? updaterEvent.message || t("updater.downloadFailedHint", "Please try again")
          : updaterEvent.type === "install-failed"
            ? updaterEvent.message ||
              t("updater.installFailedHint", "Restart the app and try again")
            : versionLabel;

  const handleDownload = () => {
    void electron.downloadUpdate().catch(showActionError);
  };

  const handleOpenReleasePage = () => {
    if (!releaseUrl) return;
    void electron.openInBrowser(releaseUrl).catch(showActionError);
  };

  const handleInstall = async () => {
    if (isInstalling) return;
    setIsInstalling(true);
    try {
      await electron.installUpdate();
    } catch (error) {
      setIsInstalling(false);
      showActionError(error);
    }
  };

  const handleRestartApp = () => {
    void electron.restartApp().catch(showActionError);
  };

  return (
    <div className="grid animate-update-card-in motion-reduce:animate-none">
      <div className="min-h-0 overflow-hidden">
        <div className="mx-2 mb-2 rounded-md border border-border bg-sidebar-accent/40 p-2">
          <div className="flex items-start gap-1.5">
            {updaterEvent.type === "download-progress" ? (
              <LoaderCircle className="mt-px size-3.5 shrink-0 animate-spin text-sidebar-foreground/60" />
            ) : updaterEvent.type === "downloaded" ? (
              <CircleCheck className="mt-px size-3.5 shrink-0 text-green-500" />
            ) : updaterEvent.type === "download-failed" ||
              updaterEvent.type === "install-failed" ? (
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-yellow-500" />
            ) : (
              <Download className="mt-px size-3.5 shrink-0 text-sidebar-foreground/60" />
            )}
            <div className="min-w-0 flex-1">
              <div className="h-4 truncate text-xs font-medium leading-4 text-sidebar-foreground/90">
                {updaterEvent.type === "available"
                  ? t("updater.available", "Update available")
                  : updaterEvent.type === "download-progress"
                    ? t("updater.downloading", "Downloading update {{percent}}%", {
                        percent: Math.round(updaterEvent.percent),
                      })
                    : updaterEvent.type === "download-failed"
                      ? t("updater.downloadFailed", "Update download failed")
                      : updaterEvent.type === "install-failed"
                        ? t("updater.installFailed", "Update install failed")
                        : t("updater.ready", "Update ready to install")}
              </div>
              <div
                className="h-4 truncate text-[11px] leading-4 text-sidebar-foreground/50"
                title={description ?? undefined}
              >
                {description}
              </div>
            </div>
            {releaseUrl && (
              <button
                type="button"
                title={t("updater.viewRelease", "View release notes on GitHub")}
                aria-label={t("updater.viewRelease", "View release notes on GitHub")}
                onClick={handleOpenReleasePage}
                className="-mt-0.5 -mr-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/80"
              >
                <ArrowUpRight className="size-3" />
              </button>
            )}
          </div>

          {/* 操作区固定 h-6：按钮与进度条共用一个槽位，切换状态时高度不跳 */}
          <div className="mt-1.5 h-6">
            {updaterEvent.type === "download-progress" && (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={updaterEvent.percent}
                className="flex h-6 items-center"
              >
                <div className="h-1 w-full overflow-hidden rounded-full bg-sidebar-foreground/15">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                    style={{ width: `${updaterEvent.percent}%` }}
                  />
                </div>
              </div>
            )}

            {updaterEvent.type === "available" && (
              <Button size="xs" className="w-full text-xs" onClick={handleDownload}>
                {t("updater.updateNow", "Update now")}
              </Button>
            )}

            {updaterEvent.type === "download-failed" && (
              <Button size="xs" className="w-full text-xs" onClick={handleDownload}>
                {t("updater.retry", "Retry")}
              </Button>
            )}

            {updaterEvent.type === "install-failed" && (
              <Button size="xs" className="w-full text-xs" onClick={handleRestartApp}>
                {t("updater.restartApp", "Restart app")}
              </Button>
            )}

            {updaterEvent.type === "downloaded" && (
              <Button
                size="xs"
                className="w-full text-xs"
                disabled={isInstalling}
                onClick={() => void handleInstall()}
              >
                {isInstalling && <LoaderCircle className="size-3 animate-spin" />}
                {isInstalling
                  ? t("updater.restarting", "Restarting…")
                  : t("updater.restart", "Restart")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
