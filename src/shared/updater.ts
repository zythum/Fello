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
  | { type: "downloaded"; info: UpdaterInfo }
  | { type: "error"; manual: boolean; message: string }
  | { type: "disabled"; manual: boolean; reason: string };

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
