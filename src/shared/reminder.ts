import { Cron } from "croner";

export type ReminderTrigger = { type: "once"; at: number } | { type: "cron"; expr: string };

export type ReminderStatus = "scheduled" | "fired" | "missed" | "disabled" | "deleted";

export type Reminder = {
  id: string;
  text: string;
  trigger: ReminderTrigger;
  status: ReminderStatus;
  createdAt: number;
  updatedAt: number;
  lastFiredAt: number | null;
};

/** Reminders with these statuses count toward calendar dots. Disabled and deleted ones do not. */
export function countsOnCalendar(status: ReminderStatus): boolean {
  return status === "scheduled" || status === "fired" || status === "missed";
}

/** Expanding one day is capped, so a per-minute cron cannot stall the UI. */
export const MAX_OCCURRENCES_PER_DAY = 1440;

/** Five fields: minute, hour, day of month, month, day of week, evaluated in `timeZone`. */
function cronOptions(timeZone: string) {
  return { mode: "5-part" as const, paused: true, timezone: timeZone };
}

/** True when the expression is a valid 5-field cron expression in `timeZone`. */
export function isValidCronExpression(expr: string, timeZone: string): boolean {
  try {
    new Cron(expr, cronOptions(timeZone));
    return true;
  } catch {
    return false;
  }
}

/** Next trigger time strictly after `fromMs`, or null when there is none. */
export function nextCronRun(expr: string, fromMs: number, timeZone: string): number | null {
  const next = new Cron(expr, cronOptions(timeZone)).nextRun(new Date(fromMs));
  return next ? next.getTime() : null;
}

/**
 * Trigger times of a reminder that fall in [startMs, endMs), in ascending order, evaluated in `timeZone`.
 * An invalid cron expression yields no occurrences instead of throwing.
 */
export function occurrencesBetween(
  reminder: Pick<Reminder, "trigger">,
  startMs: number,
  endMs: number,
  timeZone: string,
  limit = MAX_OCCURRENCES_PER_DAY,
): number[] {
  const { trigger } = reminder;
  if (trigger.type === "once") {
    return trigger.at >= startMs && trigger.at < endMs ? [trigger.at] : [];
  }
  let cron: Cron;
  try {
    cron = new Cron(trigger.expr, cronOptions(timeZone));
  } catch {
    return [];
  }
  const found: number[] = [];
  let cursor = startMs - 1;
  while (found.length < limit) {
    const next = cron.nextRun(new Date(cursor));
    if (!next || next.getTime() >= endMs) break;
    found.push(next.getTime());
    cursor = next.getTime();
  }
  return found;
}

/** Offset of `timeZone` from UTC at the instant, in milliseconds. */
function offsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Instant of local midnight at the start of a calendar date in `timeZone`. */
function zonedMidnight(year: number, month: number, day: number, timeZone: string): number {
  const wallAsUtc = Date.UTC(year, month - 1, day);
  const first = wallAsUtc - offsetMs(wallAsUtc, timeZone);
  return wallAsUtc - offsetMs(first, timeZone);
}

/**
 * [start, end) of a calendar day in `timeZone`. The date is a calendar date (year, month 1-12, day),
 * not an instant, so the same label means the same day in every zone.
 */
export function zonedDayBounds(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): { start: number; end: number } {
  return {
    start: zonedMidnight(year, month, day, timeZone),
    end: zonedMidnight(year, month, day + 1, timeZone),
  };
}
