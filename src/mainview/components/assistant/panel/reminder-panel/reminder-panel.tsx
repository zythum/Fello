import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { request, subscribe } from "../../../../backend";
import { occurrencesBetween, zonedDayBounds, type Reminder, type ReminderStatus } from "../../../../../shared/reminder";
import { ReminderCalendar } from "./reminder-calendar";
import type { AssistantReminderList } from "../../../../../shared/schema";

type ReminderOccurrence = {
  key: string;
  at: number;
  reminder: Reminder;
};

/** Every trigger time that falls on the selected day, sorted by time. Disabled and deleted ones included. */
function occurrencesOnDay(reminders: Reminder[], date: Date, timeZone: string): ReminderOccurrence[] {
  const { start, end } = zonedDayBounds(date.getFullYear(), date.getMonth() + 1, date.getDate(), timeZone);
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

function StatusLabel({ status }: { status: ReminderStatus }) {
  const { t } = useTranslation();
  const labels: Record<ReminderStatus, string> = {
    scheduled: t("assistant.reminders.status.scheduled", "Scheduled"),
    fired: t("assistant.reminders.status.fired", "Triggered"),
    missed: t("assistant.reminders.status.missed", "Missed"),
    disabled: t("assistant.reminders.status.disabled", "Disabled"),
    deleted: t("assistant.reminders.status.deleted", "Deleted"),
  };
  const tone =
    status === "missed"
      ? "text-destructive"
      : status === "scheduled"
        ? "text-primary"
        : "text-muted-foreground";
  return <span className={`shrink-0 text-[10px] ${tone}`}>{labels[status]}</span>;
}

const NO_REMINDERS: Reminder[] = [];

export function ReminderPanel() {
  const { t } = useTranslation();
  // Reminders and the server's time zone come together, so the UI never mixes browser and server time.
  const [listing, setListing] = useState<AssistantReminderList | null>(null);
  const [selected, setSelected] = useState<Date>(() => new Date());

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

  const reminders = listing?.reminders ?? NO_REMINDERS;
  const timeZone = listing?.timeZone ?? "UTC";
  const items = useMemo(
    () => occurrencesOnDay(reminders, selected, timeZone),
    [reminders, selected, timeZone],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <ReminderCalendar reminders={reminders} timeZone={timeZone} selected={selected} onSelect={setSelected} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("assistant.reminders.empty", "No reminders on this day")}
          </p>
        ) : (
          <ItemGroup className="gap-2">
            {items.map((item) => (
              <Item key={item.key} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle className="flex w-full items-center justify-between gap-2 font-normal">
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
                      {formatTime(item.at, timeZone)}
                    </span>
                    <StatusLabel status={item.reminder.status} />
                  </ItemTitle>
                  <ItemDescription className="whitespace-pre-wrap wrap-break-word text-xs leading-relaxed text-sidebar-foreground/85">
                    {item.reminder.text}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </div>
    </div>
  );
}
