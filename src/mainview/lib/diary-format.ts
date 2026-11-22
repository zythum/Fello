import type { AssistantDiary } from "../../shared/schema";

const DAY_LABEL: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

/** One diary period in the selected language, e.g. "Nov 22 12:28–13:58". */
export function formatDiaryPeriod(
  period: Pick<AssistantDiary, "startAt" | "endAt">,
  timeZone: string,
  language: string,
): string {
  const formatDay = new Intl.DateTimeFormat("en-CA", { ...DAY_LABEL, timeZone });
  const formatDate = new Intl.DateTimeFormat(language, {
    timeZone,
    month: "short",
    day: "numeric",
  });
  const formatClock = new Intl.DateTimeFormat(language, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const startClock = formatClock.format(period.startAt);
  const endClock = formatClock.format(period.endAt);
  if (formatDay.format(period.startAt) === formatDay.format(period.endAt)) {
    return `${formatDate.format(period.startAt)} ${startClock}–${endClock}`;
  }
  return `${formatDate.format(period.startAt)} ${startClock} – ${formatDate.format(period.endAt)} ${endClock}`;
}
