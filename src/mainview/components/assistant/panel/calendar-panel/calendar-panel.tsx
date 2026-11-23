import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDiaryPeriod } from "@/lib/diary-format";
import { request, subscribe } from "../../../../backend";
import {
  occurrencesBetween,
  wasFired,
  zonedDayBounds,
  type Reminder,
} from "../../../../../shared/reminder";
import type { AssistantDiary, AssistantReminderList } from "../../../../../shared/schema";
import { CalendarDayPicker } from "./calendar-day-picker";

type ReminderOccurrence = {
  key: string;
  at: number;
  reminder: Reminder;
};

/** Every trigger time that falls on the selected day, sorted by time. Disabled ones included. */
function occurrencesOnDay(
  reminders: Reminder[],
  date: Date,
  timeZone: string,
): ReminderOccurrence[] {
  const { start, end } = zonedDayBounds(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    timeZone,
  );
  const items: ReminderOccurrence[] = [];
  for (const reminder of reminders) {
    for (const at of occurrencesBetween(reminder, start, end, timeZone)) {
      items.push({ key: `${reminder.id}:${at}`, at, reminder });
    }
  }
  return items.sort((a, b) => a.at - b.at);
}

function formatTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(ms));
}

type TFunction = ReturnType<typeof useTranslation>["t"];

/** Coarse countdown in the same style as the automation list: the panel refreshes every 30s. */
function formatDuration(ms: number, t: TFunction): string {
  if (ms < 60 * 60 * 1000)
    return t("assistant.reminders.duration.minutes", "{{minutes}} min", {
      minutes: Math.max(1, Math.floor(ms / 60000)),
    });
  if (ms < 24 * 60 * 60 * 1000)
    return t("assistant.reminders.duration.hoursMinutes", "{{hours}}h {{minutes}}m", {
      hours: Math.floor(ms / 3600000),
      minutes: Math.floor((ms % 3600000) / 60000),
    });
  return t("assistant.reminders.duration.daysHours", "{{days}}d {{hours}}h", {
    days: Math.floor(ms / 86400000),
    hours: Math.floor((ms % 86400000) / 3600000),
  });
}

/**
 * Cards show a countdown for upcoming occurrences. A past occurrence reads "Triggered" when it
 * is in `firedAt`; otherwise it is "Past" (missed or skipped). The state is derived, because a
 * recurring reminder never stops.
 */
function TriggerLabel({ reminder, at, now }: { reminder: Reminder; at: number; now: number }) {
  const { t } = useTranslation();
  const fired = wasFired(reminder, at);
  let tone: string;
  let label: string;
  if (reminder.disabled) {
    tone = "text-muted-foreground";
    label = t("assistant.reminders.status.disabled", "Disabled");
  } else if (fired) {
    tone = "text-emerald-600 dark:text-emerald-400";
    label = t("assistant.reminders.status.fired", "Triggered");
  } else if (at <= now) {
    tone = "text-amber-600 dark:text-amber-400";
    label = t("assistant.reminders.status.overdue", "Past");
  } else {
    tone = "text-teal-600 dark:text-teal-400";
    label =
      at - now < 60000
        ? t("assistant.reminders.status.anyMoment", "Any moment now")
        : t("assistant.reminders.status.countdown", "in {{duration}}", {
            duration: formatDuration(at - now, t),
          });
  }
  return <span className={`shrink-0 text-[10px] font-medium ${tone}`}>{label}</span>;
}

/**
 * Anchor for "now" inside the day's list. Without it the cards only show their own status, so it is
 * hard to tell which side of the current moment an entry falls on.
 */
function NowLine({ at, timeZone }: { at: number; timeZone: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-teal-600 dark:text-teal-400">
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        <span className="tabular-nums">
          {t("assistant.reminders.now", "Now")} {formatTime(at, timeZone)}
        </span>
      </span>
      <span className="h-px flex-1 bg-teal-600/30 dark:bg-teal-400/30" aria-hidden />
    </div>
  );
}

/**
 * One row of the day list. Adjacent trigger times of the same reminder share one card, so a
 * per-hour reminder does not fill the panel; occurrences separated by another reminder stay apart.
 */
type ReminderCardRow = {
  kind: "card";
  key: string;
  reminder: Reminder;
  /** The card's representative time: its last occurrence in the past, its first one ahead. */
  at: number;
  /** How many occurrences the card covers. */
  total: number;
};

type ListRow = ReminderCardRow | { kind: "now" };

/** Runs of consecutive occurrences of the same reminder. The input is already time-sorted. */
function groupRuns(list: ReminderOccurrence[]): ReminderOccurrence[][] {
  const runs: ReminderOccurrence[][] = [];
  for (const item of list) {
    const run = runs[runs.length - 1];
    if (run && run[0].reminder.id === item.reminder.id) run.push(item);
    else runs.push([item]);
  }
  return runs;
}

function reminderCard(run: ReminderOccurrence[], past: boolean): ReminderCardRow {
  const first = run[0];
  const last = run[run.length - 1];
  return {
    kind: "card",
    key: `${first.reminder.id}:${first.at}`,
    reminder: first.reminder,
    at: past ? last.at : first.at,
    total: run.length,
  };
}

const NO_REMINDERS: Reminder[] = [];
const NO_DIARIES: AssistantDiary[] = [];

export function CalendarPanel({
  assistantId,
  onOpenDiary,
}: {
  assistantId: string;
  onOpenDiary: (diary: AssistantDiary, timeZone: string) => void;
}) {
  const { t, i18n } = useTranslation();
  // Reminders and the server's time zone come together, so the UI never mixes browser and server time.
  const [listing, setListing] = useState<AssistantReminderList | null>(null);
  const [diaries, setDiaries] = useState<AssistantDiary[]>(NO_DIARIES);
  const [selected, setSelected] = useState<Date>(() => new Date());
  // Keeps the countdown text current without refetching anything.
  const [now, setNow] = useState(() => Date.now());
  // Starts true so the first idle status refetches: a Dream may have already been running at mount.
  const wasDreaming = useRef(true);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const onChanged = (payload: { assistantId: string } & AssistantReminderList) => {
      if (active && payload.assistantId === assistantId) setListing(payload);
    };
    subscribe.on("assistant-reminders-changed", onChanged);
    void request
      .listAssistantReminders({ assistantId })
      .then((list) => {
        if (active) setListing(list);
      })
      .catch(() => {});
    return () => {
      active = false;
      subscribe.off("assistant-reminders-changed", onChanged);
    };
  }, [assistantId]);

  useEffect(() => {
    let active = true;
    // Dream writes diary files, so the list is refetched when a Dream run finishes.
    const refresh = () => {
      void request
        .listAssistantDiaries({ assistantId })
        .then((list) => {
          if (active) setDiaries(list);
        })
        .catch(() => {});
    };
    refresh();
    const onStatus = ({
      assistantId: changedId,
      status,
    }: {
      assistantId: string;
      status: { dreaming: boolean };
    }) => {
      if (changedId !== assistantId) return;
      if (wasDreaming.current && !status.dreaming) refresh();
      wasDreaming.current = status.dreaming;
    };
    subscribe.on("assistant-status-changed", onStatus);
    return () => {
      active = false;
      subscribe.off("assistant-status-changed", onStatus);
    };
  }, [assistantId]);

  const reminders = listing?.reminders ?? NO_REMINDERS;
  const timeZone = listing?.timeZone ?? "UTC";
  const items = useMemo(
    () => occurrencesOnDay(reminders, selected, timeZone),
    [reminders, selected, timeZone],
  );
  // The list itself: runs of adjacent occurrences of the same reminder become one card. The "now"
  // marker only separates the delivered part from the upcoming part, so a run that contains the
  // current moment is shown as two cards with the marker in between.
  const rows = useMemo<ListRow[]>(() => {
    const { start, end } = zonedDayBounds(
      selected.getFullYear(),
      selected.getMonth() + 1,
      selected.getDate(),
      timeZone,
    );
    const firstAhead = items.findIndex((item) => item.at > now);
    const split = firstAhead === -1 ? items.length : firstAhead;

    const past = groupRuns(items.slice(0, split)).map((run) => reminderCard(run, true));
    const future = groupRuns(items.slice(split)).map((run) => reminderCard(run, false));
    // The marker only means something while the selected day actually contains the current time.
    const between: ListRow[] = now >= start && now < end ? [{ kind: "now" }] : [];
    return [...past, ...between, ...future];
  }, [items, now, selected, timeZone]);
  const diariesOnDay = useMemo(() => {
    const { start, end } = zonedDayBounds(
      selected.getFullYear(),
      selected.getMonth() + 1,
      selected.getDate(),
      timeZone,
    );
    return diaries.filter((diary) => diary.startAt < end && diary.endAt > start);
  }, [diaries, selected, timeZone]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-1">
        <CalendarDayPicker
          reminders={reminders}
          timeZone={timeZone}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      <ScrollArea className="flex-1 min-h-0 border-t" viewportClassName="p-3">
        <h3 className="px-0.5 pb-2 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
          {t("assistant.reminders.title", "Reminders")}
        </h3>
        {items.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("assistant.reminders.empty", "No reminders on this day")}
          </p>
        ) : (
          <ItemGroup className="gap-2">
            {rows.map((row) => {
              if (row.kind === "now") return <NowLine key="now" at={now} timeZone={timeZone} />;
              return (
                <Item
                  key={row.key}
                  variant="muted"
                  size="sm"
                  className="rounded-md border-foreground/15 p-2 shadow-2xs"
                >
                  <ItemContent>
                    <ItemTitle className="flex w-full items-center justify-between gap-2 font-normal">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
                          {formatTime(row.at, timeZone)}
                        </span>
                        {row.total > 1 && (
                          <span className="text-[9px] tabular-nums text-muted-foreground/60">
                            ×{row.total}
                          </span>
                        )}
                      </span>
                      <TriggerLabel reminder={row.reminder} at={row.at} now={now} />
                    </ItemTitle>
                    <ItemDescription className="whitespace-pre-wrap wrap-break-word text-xs leading-snug text-sidebar-foreground/85">
                      {row.reminder.text}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              );
            })}
          </ItemGroup>
        )}

        {diariesOnDay.length > 0 && (
          <section className="mt-3">
            <h3 className="px-0.5 pb-2 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
              {t("assistant.calendar.diary", "Diary")}
            </h3>
            <ItemGroup className="gap-2">
              {diariesOnDay.map((diary) => (
                <Item
                  key={diary.file}
                  variant="muted"
                  size="sm"
                  className="rounded-md border-foreground/15 p-2 shadow-2xs text-left"
                  render={<button type="button" onClick={() => onOpenDiary(diary, timeZone)} />}
                >
                  <ItemContent>
                    <ItemTitle className="flex w-full items-start justify-between gap-2 font-normal">
                      <span className="line-clamp-3 min-w-0 whitespace-pre-line wrap-break-word text-xs leading-snug">
                        {diary.title ?? diary.file}
                      </span>
                      <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground/50" />
                    </ItemTitle>
                    <ItemDescription className="text-[11px] text-muted-foreground/70">
                      {formatDiaryPeriod(diary, timeZone, i18n.language)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </section>
        )}
      </ScrollArea>
    </div>
  );
}
