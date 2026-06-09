import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Preset = "daily" | "weekdays" | "hourly" | "weekly" | "custom";

interface CronEditorProps {
  value: string;
  onChange: (value: string) => void;
  timezone?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const INTERVALS = [1, 2, 3, 4, 6, 8, 12];
const DAYS_OF_WEEK_VALUES = ["1", "2", "3", "4", "5", "6", "0"];

function detectPreset(expr: string): Preset {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "custom";
  const [min, hr, dom, mon, dow] = parts;
  if (hr.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    const n = parseInt(hr.slice(2));
    if (!isNaN(n) && INTERVALS.includes(n)) return "hourly";
  }
  const h = parseInt(hr),
    m = parseInt(min);
  if (isNaN(h) || isNaN(m)) return "custom";
  if (dom === "*" && mon === "*" && dow === "*") return "daily";
  if (dom === "*" && mon === "*" && dow === "1-5") return "weekdays";
  if (dom === "*" && mon === "*" && /^\d$/.test(dow)) return "weekly";
  return "custom";
}

function parseParts(expr: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { hour: 9, minute: 0, interval: 2, dow: "1" };
  const [min, hr] = parts;
  const dow = parts[4];
  if (hr.startsWith("*/"))
    return {
      hour: 9,
      minute: parseInt(min) || 0,
      interval: parseInt(hr.slice(2)) || 2,
      dow: /^\d$/.test(dow) ? dow : "1",
    };
  return {
    hour: parseInt(hr) || 9,
    minute: parseInt(min) || 0,
    interval: 2,
    dow: /^\d$/.test(dow) ? dow : "1",
  };
}

function buildCron(
  preset: Preset,
  hour: number,
  minute: number,
  interval: number,
  dow: string,
): string {
  switch (preset) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${dow}`;
    case "hourly":
      return `${minute} */${interval} * * *`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

export function CronEditor({ value, onChange, timezone }: CronEditorProps) {
  const { t, i18n } = useTranslation();
  const [preset, setPreset] = useState<Preset>(() => detectPreset(value));
  const [parts, setParts] = useState(() => parseParts(value));

  // Sync preset when value changes externally
  useEffect(() => {
    const detected = detectPreset(value);
    if (detected !== "custom") {
      setPreset(detected);
      setParts(parseParts(value));
    }
  }, [value]);

  const handlePresetChange = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") {
      onChange(buildCron(p, parts.hour, parts.minute, parts.interval, parts.dow));
    }
  };

  const updateParts = (patch: Partial<typeof parts>) => {
    const next = { ...parts, ...patch };
    setParts(next);
    if (preset !== "custom") {
      onChange(buildCron(preset, next.hour, next.minute, next.interval, next.dow));
    }
  };

  const presetItems = [
    { value: "daily", label: t("automation.cron.daily", "Every day") },
    { value: "weekdays", label: t("automation.cron.weekdays", "Weekdays") },
    { value: "weekly", label: t("automation.cron.weekly", "Every week") },
    { value: "hourly", label: t("automation.cron.hourly", "Every N hours") },
    { value: "custom", label: t("automation.cron.custom", "Custom") },
  ];

  const intervalItems = INTERVALS.map((n) => ({ value: String(n), label: `${n}h` }));
  const minuteItems = MINUTES.map((m) => ({
    value: String(m),
    label: `${String(m).padStart(2, "0")}`,
  }));
  const hourItems = HOURS.map((h) => ({ value: String(h), label: String(h).padStart(2, "0") }));
  const dowItems = DAYS_OF_WEEK_VALUES.map((v) => ({
    value: v,
    label: t(
      `automation.cron.days.${v}`,
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parseInt(v)],
    ),
  }));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Select
          items={presetItems}
          value={preset}
          onValueChange={(v) => {
            if (v) handlePresetChange(v as Preset);
          }}
        >
          <SelectTrigger className="h-8 text-xs! w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presetItems.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {preset === "custom" ? (
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="min hour day month weekday"
            className="h-8 text-xs! font-mono text-foreground/70 focus-visible:ring-0.5 flex-1"
          />
        ) : preset === "hourly" ? (
          <>
            <Select
              items={intervalItems}
              value={String(parts.interval)}
              onValueChange={(v) => {
                if (v) updateParts({ interval: parseInt(v) });
              }}
            >
              <SelectTrigger className="h-7 text-xs! w-15">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {intervalItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {t("automation.cron.atMinute", "at min")}
            </span>
            <Select
              items={minuteItems}
              value={String(parts.minute)}
              onValueChange={(v) => {
                if (v) updateParts({ minute: parseInt(v) });
              }}
            >
              <SelectTrigger className="h-7 text-xs! w-15">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {minuteItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <>
            {preset === "weekly" && (
              <Select
                items={dowItems}
                value={parts.dow}
                onValueChange={(v) => {
                  if (v) updateParts({ dow: v });
                }}
              >
                <SelectTrigger className="h-7 text-xs! w-18">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dowItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="text-xs text-muted-foreground">{t("automation.cron.at", "at")}</span>
            <Select
              items={hourItems}
              value={String(parts.hour)}
              onValueChange={(v) => {
                if (v) updateParts({ hour: parseInt(v) });
              }}
            >
              <SelectTrigger className="h-7 text-xs! w-15">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hourItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">:</span>
            <Select
              items={minuteItems}
              value={String(parts.minute)}
              onValueChange={(v) => {
                if (v) updateParts({ minute: parseInt(v) });
              }}
            >
              <SelectTrigger className="h-7 text-xs! w-15">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {minuteItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {value} · {t("automation.cron.nextRun", "Next run")}: {formatNextCron(value, i18n.language)}
        {timezone && <span className="ml-1 text-muted-foreground/50">({timezone})</span>}
      </p>
    </div>
  );
}

function formatNextCron(expr: string, locale?: string): string {
  try {
    const next = getNextCronDate(expr);
    if (!next) return "—";
    return next.toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function getNextCronDate(expr: string): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minF, hrF, , , dowF] = parts;

  const now = new Date();
  // Try next 7 days × 24 hours to find next match
  for (let d = 0; d < 8; d++) {
    const candidate = new Date(now.getTime() + d * 86400000);
    const dow = candidate.getDay();

    if (dowF !== "*") {
      if (dowF === "1-5" && (dow === 0 || dow === 6)) continue;
      else if (/^\d$/.test(dowF) && dow !== parseInt(dowF)) continue;
      else if (dowF.includes(",") && !dowF.split(",").map(Number).includes(dow)) continue;
    }

    if (hrF.startsWith("*/")) {
      const interval = parseInt(hrF.slice(2)) || 1;
      const minute = parseInt(minF) || 0;
      for (let h = 0; h < 24; h += interval) {
        candidate.setHours(h, minute, 0, 0);
        if (candidate > now) return candidate;
      }
    } else {
      const h = parseInt(hrF),
        m = parseInt(minF);
      if (isNaN(h) || isNaN(m)) return null;
      candidate.setHours(h, m, 0, 0);
      if (candidate > now) return candidate;
    }
  }
  return null;
}
