import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
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
    tone = "text-primary";
    label =
      at - now < 60000
        ? t("assistant.reminders.status.anyMoment", "Any moment now")
        : t("assistant.reminders.status.countdown", "in {{duration}}", {
            duration: formatDuration(at - now, t),
          });
  }
  return <span className={`shrink-0 text-[10px] ${tone}`}>{label}</span>;
}

const NO_REMINDERS: Reminder[] = [];
const NO_DIARIES: AssistantDiary[] = [];

export function CalendarPanel({
  onOpenDiary,
}: {
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
    const onChanged = (payload: AssistantReminderList) => {
      if (active) setListing(payload);
    };
    subscribe.on("assistant-reminders-changed", onChanged);
    void request
      .listAssistantReminders()
      .then((list) => {
        if (active) setListing(list);
      })
      .catch(() => {});
    return () => {
      active = false;
      subscribe.off("assistant-reminders-changed", onChanged);
    };
  }, []);

  useEffect(() => {
    let active = true;
    // Dream writes diary files, so the list is refetched when a Dream run finishes.
    const refresh = () => {
      void request
        .listAssistantDiaries()
        .then((list) => {
          if (active) setDiaries(list);
        })
        .catch(() => {});
    };
    refresh();
    const onStatus = ({ status }: { status: { dreaming: boolean } }) => {
      if (wasDreaming.current && !status.dreaming) refresh();
      wasDreaming.current = status.dreaming;
    };
    subscribe.on("assistant-status-changed", onStatus);
    return () => {
      active = false;
      subscribe.off("assistant-status-changed", onStatus);
    };
  }, []);

  const reminders = listing?.reminders ?? NO_REMINDERS;
  const timeZone = listing?.timeZone ?? "UTC";
  const items = useMemo(
    () => occurrencesOnDay(reminders, selected, timeZone),
    [reminders, selected, timeZone],
  );
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
      <div className="shrink-0">
        <CalendarDayPicker
          reminders={reminders}
          timeZone={timeZone}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        <h3 className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
          {t("assistant.reminders.title", "Reminders")}
        </h3>
        {items.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("assistant.reminders.empty", "No reminders on this day")}
          </p>
        ) : (
          <ItemGroup className="gap-2">
            {items.map((item) => (
              <Item key={item.key} variant="outline" size="sm" className="shadow-sm rounded-md">
                <ItemContent>
                  <ItemTitle className="flex w-full items-center justify-between gap-2 font-normal">
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
                      {formatTime(item.at, timeZone)}
                    </span>
                    <TriggerLabel reminder={item.reminder} at={item.at} now={now} />
                  </ItemTitle>
                  <ItemDescription className="whitespace-pre-wrap wrap-break-word text-xs leading-relaxed text-sidebar-foreground/85">
                    {item.reminder.text}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}

        {diariesOnDay.length > 0 && (
          <section className="mt-3">
            <h3 className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
              {t("assistant.calendar.diary", "Diary")}
            </h3>
            <ItemGroup className="gap-2">
              {diariesOnDay.map((diary) => (
                <Item
                  key={diary.file}
                  variant="outline"
                  size="sm"
                  className="shadow-sm rounded-md text-left pr-2"
                  render={<button type="button" onClick={() => onOpenDiary(diary, timeZone)} />}
                >
                  <ItemContent>
                    <ItemTitle className="flex w-full items-start justify-between gap-2 font-normal">
                      <span className="line-clamp-3 min-w-0 whitespace-pre-line wrap-break-word text-xs leading-snug">
                        {diary.title ?? diary.file}
                      </span>
                      <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground/50" />
                    </ItemTitle>
                    <ItemDescription className="text-[10px] text-muted-foreground/70">
                      {formatDiaryPeriod(diary, timeZone, i18n.language)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </section>
        )}
      </div>
    </div>
  );
}
