export type UpdaterInfo = {
  version?: string;
  releaseName?: string;
  releaseDate?: string;
  releaseNotes?: string;
};

export type UpdaterEvent =
  | { type: "checking"; manual: boolean }
  | { type: "available"; manual: boolean; info: UpdaterInfo }
  | { type: "not-available"; manual: boolean; info: UpdaterInfo }
  | {
      type: "download-progress";
      percent: number;
      transferred?: number;
      total?: number;
      bytesPerSecond?: number;
    }
  /** manual 仅用于「手动检查发现同一版本已下载」时把侧边栏展开，普通下载完成不带该字段。 */
  | { type: "downloaded"; info: UpdaterInfo; manual?: boolean }
  /**
   * 下载失败。
   *
   * 与 `error` 区分：`error` 是检查阶段的失败（卡片状态保持不变），
   * 这里表示「更新仍然可用，只是这次下载没成功」，升级卡片会保留并提供重试。
   */
  | { type: "download-failed"; message: string; info: UpdaterInfo }
  | { type: "error"; manual: boolean; message: string }
  | { type: "disabled"; manual: boolean; reason: string };

export type AutoUpdateCheckGate = {
  shouldStart: (manual: boolean) => boolean;
};

type RawObject = Record<string, unknown>;

function asObject(value: unknown): RawObject {
  return value != null && typeof value === "object" ? (value as RawObject) : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeUpdaterInfo(info: unknown): UpdaterInfo {
  const source = asObject(info);
  const normalized: UpdaterInfo = {};
  const version = optionalString(source.version);
  const releaseName = optionalString(source.releaseName);
  const releaseDate = optionalString(source.releaseDate);
  const releaseNotes = optionalString(source.releaseNotes);

  if (version) normalized.version = version;
  if (releaseName) normalized.releaseName = releaseName;
  if (releaseDate) normalized.releaseDate = releaseDate;
  if (releaseNotes) normalized.releaseNotes = releaseNotes;

  return normalized;
}

export function createUpdaterEvent(
  type: "available" | "not-available",
  info: unknown,
  manual: boolean,
): UpdaterEvent {
  return { type, manual, info: normalizeUpdaterInfo(info) };
}

export function createUpdaterProgressEvent(progress: unknown): UpdaterEvent {
  const source = asObject(progress);
  const rawPercent = optionalNumber(source.percent) ?? 0;
  const percent = Math.max(0, Math.min(100, Math.round(rawPercent * 10) / 10));

  return {
    type: "download-progress",
    percent,
    transferred: optionalNumber(source.transferred),
    total: optionalNumber(source.total),
    bytesPerSecond: optionalNumber(source.bytesPerSecond),
  };
}

export function createAutoUpdateCheckGate(): AutoUpdateCheckGate {
  let didStartAutomaticCheck = false;

  return {
    shouldStart(manual: boolean) {
      if (manual) return true;
      if (didStartAutomaticCheck) return false;
      didStartAutomaticCheck = true;
      return true;
    },
  };
}
