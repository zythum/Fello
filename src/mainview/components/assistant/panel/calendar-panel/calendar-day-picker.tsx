import { createContext, useContext, useMemo } from "react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import type { DayButton } from "react-day-picker";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { occurrencesBetween, zonedDayBounds, type Reminder } from "../../../../../shared/reminder";

/**
 * Dots show how many reminders fall on that day (not how many times they trigger), up to this many.
 * Larger counts are not expanded.
 */
const MAX_DOTS = 3;

type CalendarContextValue = {
  reminders: Reminder[];
  timeZone: string;
  /** Dot count per calendar date. Reset whenever the reminders or the time zone change. */
  dotCounts: Map<string, number>;
};

const CalendarContext = createContext<CalendarContextValue>({
  reminders: [],
  timeZone: "UTC",
  dotCounts: new Map(),
});

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function countOnDay(reminders: Reminder[], date: Date, timeZone: string): number {
  // The calendar date is a label (year, month, day), so the same day is picked in the server's zone.
  const { start, end } = zonedDayBounds(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    timeZone,
  );
  let total = 0;
  for (const reminder of reminders) {
    // One dot per reminder, so an hourly reminder still counts as a single reminder that day.
    if (occurrencesBetween(reminder, start, end, timeZone, 1).length === 0) continue;
    total += 1;
    if (total >= MAX_DOTS) break;
  }
  return total;
}

/** Calendar day cell: the default button plus one dot per reminder on that day. */
function CalendarDayButtonCell(props: ComponentProps<typeof DayButton>) {
  const { reminders, timeZone, dotCounts } = useContext(CalendarContext);
  const { t } = useTranslation();
  const date = props.day.date;
  const key = dayKey(date);
  let count = dotCounts.get(key);
  if (count === undefined) {
    count = countOnDay(reminders, date, timeZone);
    dotCounts.set(key, count);
  }
  return (
    <CalendarDayButton {...props}>
      {props.modifiers.today ? (
        // The label is anchored to the day number (not to the cell), so its gap to the number stays
        // the same while the calendar — and therefore the cell — is resized. A div, not a span:
        // the day button styles its direct span children (`[&>span]:text-xs`), which would
        // override the label's own font size.
        <div className="relative flex flex-col items-center">
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 pb-0.5 text-[7px] leading-none font-medium whitespace-nowrap opacity-60"
          >
            {t("assistant.calendar.today", "Today")}
          </div>
          {props.children}
        </div>
      ) : (
        props.children
      )}
      {count > 0 && (
        // Absolutely positioned so the dots never change the layout of the day number.
        <span className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-0.5">
          {Array.from({ length: count }, (_, index) => (
            <span key={index} className="size-1 rounded-full bg-current opacity-70" />
          ))}
        </span>
      )}
    </CalendarDayButton>
  );
}

export function CalendarDayPicker({
  reminders,
  timeZone,
  selected,
  onSelect,
}: {
  reminders: Reminder[];
  timeZone: string;
  selected: Date;
  onSelect: (date: Date) => void;
}) {
  const value = useMemo<CalendarContextValue>(
    () => ({ reminders, timeZone, dotCounts: new Map() }),
    [reminders, timeZone],
  );
  return (
    <CalendarContext.Provider value={value}>
      <Calendar
        mode="single"
        selected={selected}
        onSelect={(date) => {
          // Clicking the selected day deselects it (undefined). Keep the current day selected.
          if (date) onSelect(date);
        }}
        components={{ DayButton: CalendarDayButtonCell }}
        className="w-full text-xs [&_button]:text-xs"
      />
    </CalendarContext.Provider>
  );
}
