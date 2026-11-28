import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, FileText, FolderOpen, Loader2, RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { copyText } from "@/lib/clipboard";
import { extractErrorMessage } from "@/lib/utils";
import type { DataRootState, DataRootProblem, DiagnosticsInfo } from "../../../../shared/schema";
import { isWebUI, request } from "../../../backend";
import { electron } from "../../../electron";
import { useAppStore } from "../../../store";
import { useMessage } from "../../providers/message";

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** 文件不存在时的只读路径：置灰、不可点击，后面跟一个说明。 */
function MissingPath({ path, suffix }: { path: string; suffix: string }) {
  return (
    <span className="font-mono break-all text-muted-foreground/60">
      <FileText className="mr-1 inline size-3 align-[-0.15em] opacity-40" />
      <span>{path}</span>
      <span className="ml-1.5 font-sans">{suffix}</span>
    </span>
  );
}

function useProblemText() {
  const { t } = useTranslation();
  return useCallback(
    (problem: DataRootProblem): string => {
      const path = problem.path ?? "";
      switch (problem.code) {
        case "empty":
          return t("settings.advanced.problem.empty", "The path is empty.");
        case "relative":
          return t("settings.advanced.problem.relative", "The path must be absolute.");
        case "missing":
          return t("settings.advanced.problem.missing", "{{path}} does not exist.", { path });
        case "not-directory":
          return t("settings.advanced.problem.notDirectory", "{{path}} is not a directory.", {
            path,
          });
        case "unreadable":
          return t("settings.advanced.problem.unreadable", "Cannot read {{path}}.", { path });
        case "same":
          return t("settings.advanced.problem.same", "This is already the current data root.");
        case "filesystem-root":
          return t(
            "settings.advanced.problem.filesystemRoot",
            "A filesystem root cannot be used as the data root.",
          );
        case "home-directory":
          return t(
            "settings.advanced.problem.homeDirectory",
            "The home directory itself cannot be used as the data root.",
          );
        case "inside-current":
          return t(
            "settings.advanced.problem.insideCurrent",
            "The directory cannot be inside the current data root.",
          );
        case "contains-current":
          return t(
            "settings.advanced.problem.containsCurrent",
            "The current data root cannot be inside the chosen directory.",
          );
        case "not-writable":
          return t("settings.advanced.problem.notWritable", "No write permission for {{path}}.", {
            path,
          });
        case "not-empty":
          return t(
            "settings.advanced.problem.notEmpty",
            "The directory is not empty. Choose an empty directory or an existing Fello data root.",
          );
        case "env-locked":
          return t(
            "settings.advanced.problem.envLocked",
            "The directory is fixed by the FELLO_DATA_ROOT environment variable.",
          );
      }
    },
    [t],
  );
}

/**
 * 可点击的路径：桌面端点击即在 Finder 中定位；WebUI 下退化成纯文本
 * （`revealInFinder` 在 WebUI 是 no-op，做成按钮会给人"点了没反应"的错觉）。
 */
function RevealablePath({
  path,
  title,
  kind = "folder",
}: {
  path: string;
  title: string;
  kind?: "file" | "folder";
}) {
  if (isWebUI) return <span className="font-mono break-all">{path}</span>;

  const Icon = kind === "file" ? FileText : FolderOpen;

  return (
    <button
      type="button"
      title={title}
      onClick={() => void electron.revealInFinder(path)}
      className="group cursor-default text-left font-mono break-all transition-colors hover:text-blue-600 dark:hover:text-blue-400"
    >
      {/* inline 而不是 flex：作为格子里的 flex 项时，行盒的 baseline 才是文字 baseline，
          右边的「可用空间」才能和数据根按 baseline 对齐。 */}
      <Icon className="mr-1 inline size-3 align-[-0.15em] opacity-60 group-hover:opacity-100" />
      <span className="group-hover:underline">{path}</span>
    </button>
  );
}

export function SettingsAdvanced() {
  const { t } = useTranslation();
  const { toast, confirm } = useMessage();
  const problemText = useProblemText();
  const isMacApp = useAppStore((s) => s.isMacApp);
  // macOS 是 Finder，Windows/Linux 是资源管理器 / 文件管理器。
  const revealLabel = isMacApp
    ? t("settings.advanced.reveal", "Show in Finder")
    : t("settings.advanced.revealFolder", "Show in folder");

  const [info, setInfo] = useState<DataRootState | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await request.getDataRoot());
    } catch (error) {
      toast.error(
        extractErrorMessage(error) ||
          t("settings.advanced.loadFailed", "Failed to read the data root."),
      );
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  // 首次加载走 promise 链：effect 里同步 setState 会触发级联渲染
  // （react/set-state-in-effect），与本项目其它设置页保持一致。
  useEffect(() => {
    let cancelled = false;
    request
      .getDataRoot()
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(
            extractErrorMessage(error) ||
              t("settings.advanced.loadFailed", "Failed to read the data root."),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    request
      .getDiagnostics()
      .then((next) => {
        if (!cancelled) setDiagnostics(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [t, toast]);

  const apply = useCallback(
    async (target: string | null): Promise<boolean> => {
      setBusy(true);
      try {
        const result = await request.setDataRoot({ target });
        if (!result.ok) {
          toast.error(
            result.problem
              ? problemText(result.problem)
              : t("settings.advanced.saveFailed", "Failed to update the data root."),
          );
          return false;
        }
        await refresh();
        return true;
      } catch (error) {
        toast.error(
          extractErrorMessage(error) ||
            t("settings.advanced.saveFailed", "Failed to update the data root."),
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [problemText, refresh, t, toast],
  );

  const handleChange = async () => {
    if (!info || isWebUI || busy) return;

    const picked = await electron.showOpenDialog();
    if (!picked) return;

    const answer = await confirm({
      title: t("settings.advanced.changeTitle", "Change data root?"),
      content: t(
        "settings.advanced.changeImpact",
        [
          "Current: {{current}}",
          "After restart: {{target}}",
          "",
          "Existing data is NOT moved or deleted.",
          "",
          "After the restart Fello uses a separate set of data and settings from the new directory:",
          "· projects and sessions",
          "· personal assistants and their memory",
          "· automations",
          "· iLink login state",
          "· user-level skills",
          "· all settings (agents, API keys, MCP, proxy, language, theme, shortcuts)",
          "",
          "If the new directory is empty, this is equivalent to a fresh Fello install.",
          "The current data stays at {{current}} and you can switch back at any time.",
        ].join("\n"),
        { current: info.current, target: picked },
      ),
      buttons: [
        { text: t("message.cancel", "Cancel"), value: null, variant: "outline" },
        {
          text: t("settings.advanced.saveAndRestart", "Save and restart"),
          value: "restart",
          variant: "default",
        },
      ],
    });
    if (!answer) return;

    const ok = await apply(picked);
    if (!ok) return;
    await electron.restartApp();
  };

  const handleReset = async () => {
    if (!info || isWebUI || busy) return;

    const answer = await confirm({
      title: t("settings.advanced.resetTitle", "Use the default data root?"),
      content: t(
        "settings.advanced.resetImpact",
        [
          "Current: {{current}}",
          "After restart: {{defaultPath}} (default)",
          "",
          "Existing data is NOT moved or deleted.",
          "After the restart Fello uses the data and settings stored in the default directory.",
          "If that directory has no data, this is equivalent to a fresh Fello install.",
        ].join("\n"),
        { current: info.current, defaultPath: info.defaultPath },
      ),
      buttons: [
        { text: t("message.cancel", "Cancel"), value: null, variant: "outline" },
        {
          text: t("settings.advanced.saveAndRestart", "Save and restart"),
          value: "restart",
          variant: "default",
        },
      ],
    });
    if (!answer) return;

    const ok = await apply(null);
    if (!ok) return;
    await electron.restartApp();
  };

  const sourceLabel = (data: DataRootState): string => {
    if (data.source === "env") {
      return t("settings.advanced.sourceEnv", "FELLO_DATA_ROOT environment variable");
    }
    if (data.source === "rc") return t("settings.advanced.sourceRc", "~/.fellorc");
    return t("settings.advanced.sourceDefault", "Default");
  };

  const platformLabel = diagnostics
    ? `${diagnostics.platform}-${diagnostics.arch}${
        diagnostics.packaged === null ? "" : diagnostics.packaged ? " (packaged)" : " (dev)"
      }`
    : "?";

  const diagnosticsText = [
    `Fello ${__APP_VERSION__}`,
    `platform: ${platformLabel}`,
    diagnostics
      ? diagnostics.electronVersion
        ? `runtime: Electron ${diagnostics.electronVersion} · Node ${diagnostics.nodeVersion} · Chromium ${diagnostics.chromeVersion ?? "?"}`
        : `runtime: Node ${diagnostics.nodeVersion}`
      : null,
    diagnostics ? `uptime: ${formatUptime(diagnostics.uptimeSeconds)}` : null,
    diagnostics
      ? `memory: ${formatBytes(diagnostics.memoryBytes)}${
          diagnostics.memoryScope === "app" ? " (app processes)" : ""
        }`
      : null,
    diagnostics ? `timezone: ${diagnostics.timezone}` : null,
    diagnostics?.freeSpaceBytes != null
      ? `free space: ${formatBytes(diagnostics.freeSpaceBytes)}`
      : null,
    `data root: ${info?.current ?? "?"}`,
    `source: ${info?.source ?? "?"}`,
    `config: ${info?.rcPath ?? "?"}${info && !info.rcExists ? " (missing)" : ""}`,
    diagnostics?.crashLogPath
      ? `crash log: ${diagnostics.crashLogPath}${diagnostics.crashLogExists ? "" : " (missing)"}`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const handleCopyDiagnostics = async () => {
    await copyText(diagnosticsText);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="space-y-6 px-5 py-4 mb-4 w-full max-w-4xl mx-auto">
          <div>
            <h3 className="text-lg font-medium">{t("settings.advanced.title", "Advanced")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("settings.advanced.desc", "Data root, configuration file and diagnostics.")}
            </p>
          </div>

          {isWebUI && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t(
                  "settings.advanced.webuiReadOnly",
                  "The data root is read-only in the WebUI. Change it from the desktop app.",
                )}
              </span>
            </div>
          )}

          {/* ── Data root ── */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
              {t("settings.advanced.groupData", "Data root")}
            </h4>

            {loading && !info ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t("settings.advanced.loading", "Loading…")}
              </div>
            ) : info ? (
              <>
                <div className="grid grid-cols-[6.5rem_1fr] items-baseline gap-x-2 gap-y-1.5 text-xs">
                  <span className="text-muted-foreground">
                    {t("settings.advanced.current", "In use")}
                  </span>
                  <RevealablePath path={info.current} title={revealLabel} />

                  {info.restartRequired && info.configured && (
                    <>
                      <span className="text-muted-foreground">
                        {t("settings.advanced.pending", "After restart")}
                      </span>
                      <span className="font-mono break-all text-amber-600 dark:text-amber-400">
                        {info.configured}
                      </span>
                    </>
                  )}

                  <span className="text-muted-foreground">
                    {t("settings.advanced.source", "Source")}
                  </span>
                  <span>{sourceLabel(info)}</span>
                </div>

                {info.problem && (
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span className="whitespace-pre-wrap break-all">{info.problem}</span>
                  </div>
                )}

                {info.restartRequired && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t(
                      "settings.advanced.restartRequiredHint",
                      "The configured directory takes effect after restarting Fello.",
                    )}
                  </p>
                )}

                {info.source === "env" && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "settings.advanced.envLocked",
                      "Fixed by the FELLO_DATA_ROOT environment variable. Change or unset it to switch directories.",
                    )}
                  </p>
                )}

                {!isWebUI && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={busy || info.source === "env"}
                      onClick={() => void handleChange()}
                    >
                      {busy && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                      {t("settings.advanced.change", "Change directory…")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={busy || info.source === "env" || info.source === "default"}
                      onClick={() => void handleReset()}
                    >
                      <RotateCcw className="mr-1.5 size-3" />
                      {t("settings.advanced.reset", "Use default")}
                    </Button>
                  </div>
                )}
              </>
            ) : null}
          </div>

          <div className="border-t border-border" />

          {/* ── Diagnostics ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1">
              <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
                {t("settings.advanced.groupDiagnostics", "Diagnostics")}
              </h4>
              <button
                type="button"
                title={t("settings.advanced.copy", "Copy diagnostics")}
                aria-label={t("settings.advanced.copy", "Copy diagnostics")}
                onClick={() => void handleCopyDiagnostics()}
                className="cursor-default text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
              </button>
            </div>
            <div className="grid grid-cols-[6.5rem_1fr] items-baseline gap-x-2 gap-y-1.5 text-xs">
              <span className="text-muted-foreground">
                {t("settings.advanced.version", "Version")}
              </span>
              <span className="font-mono">{__APP_VERSION__}</span>
              <span className="text-muted-foreground">
                {t("settings.advanced.platform", "Platform")}
              </span>
              <span className="font-mono">
                {diagnostics ? `${diagnostics.platform}-${diagnostics.arch}` : "—"}
                {diagnostics?.packaged != null && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {diagnostics.packaged
                      ? t("settings.advanced.packaged", "packaged")
                      : t("settings.advanced.devBuild", "dev")}
                  </span>
                )}
              </span>

              {diagnostics && (
                <>
                  <span className="text-muted-foreground">
                    {t("settings.advanced.runtime", "Runtime")}
                  </span>
                  <span className="font-mono break-all">
                    {diagnostics.electronVersion
                      ? `Electron ${diagnostics.electronVersion} · Node ${diagnostics.nodeVersion} · Chromium ${diagnostics.chromeVersion ?? "?"}`
                      : `Node ${diagnostics.nodeVersion}`}
                  </span>

                  <span className="text-muted-foreground">
                    {t("settings.advanced.uptime", "Uptime")}
                  </span>
                  <span className="font-mono">{formatUptime(diagnostics.uptimeSeconds)}</span>

                  <span className="text-muted-foreground">
                    {t("settings.advanced.memory", "Memory")}
                  </span>
                  <span
                    className="font-mono"
                    title={
                      diagnostics.memoryScope === "app"
                        ? t("settings.advanced.memoryApp", "All application processes")
                        : t("settings.advanced.memoryProcess", "Process RSS")
                    }
                  >
                    {formatBytes(diagnostics.memoryBytes)}
                  </span>

                  <span className="text-muted-foreground">
                    {t("settings.advanced.timezone", "Time zone")}
                  </span>
                  <span className="font-mono break-all">{diagnostics.timezone}</span>

                  {diagnostics.crashLogPath && (
                    <>
                      <span className="text-muted-foreground">
                        {t("settings.advanced.crashLog", "Crash log")}
                      </span>
                      {diagnostics.crashLogExists ? (
                        <RevealablePath
                          path={diagnostics.crashLogPath}
                          kind="file"
                          title={revealLabel}
                        />
                      ) : (
                        <MissingPath
                          path={diagnostics.crashLogPath}
                          suffix={t("settings.advanced.crashLogMissing", "(none)")}
                        />
                      )}
                    </>
                  )}
                </>
              )}

              <span className="text-muted-foreground">
                {t("settings.advanced.configFile", "Config file")}
              </span>
              {info ? (
                info.rcExists ? (
                  <RevealablePath path={info.rcPath} kind="file" title={revealLabel} />
                ) : (
                  <MissingPath
                    path={info.rcPath}
                    suffix={t("settings.advanced.configNotCreated", "(not created)")}
                  />
                )
              ) : (
                <span className="font-mono">—</span>
              )}

              <span className="text-muted-foreground">
                {t("settings.advanced.dataRoot", "Data root")}
              </span>
              {info ? (
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <RevealablePath path={info.current} title={revealLabel} />
                  {diagnostics?.freeSpaceBytes != null && (
                    <span className="shrink-0 text-muted-foreground">
                      {t("settings.advanced.freeSpaceValue", "{{size}} free", {
                        size: formatBytes(diagnostics.freeSpaceBytes),
                      })}
                    </span>
                  )}
                </div>
              ) : (
                <span className="font-mono">—</span>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
