import { createContext, useContext, useMemo } from "react";
import type { ComponentProps } from "react";
import type { DayButton } from "react-day-picker";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import {
  occurrencesBetween,
  zonedDayBounds,
  type Reminder,
} from "../../../../../shared/reminder";

/** Dots show the number of reminders that day, up to this many. Larger counts are not expanded. */
const MAX_DOTS = 3;

type RemindersContextValue = {
  reminders: Reminder[];
  timeZone: string;
  /** Dot count per calendar date. Reset whenever the reminders or the time zone change. */
  dotCounts: Map<string, number>;
};

const RemindersContext = createContext<RemindersContextValue>({
  reminders: [],
  timeZone: "UTC",
  dotCounts: new Map(),
});

function countOnDay(reminders: Reminder[], date: Date, timeZone: string): number {
  // The calendar date is a label (year, month, day), so the same day is picked in the server's zone.
  const { start, end } = zonedDayBounds(date.getFullYear(), date.getMonth() + 1, date.getDate(), timeZone);
  let total = 0;
  for (const reminder of reminders) {
    total += occurrencesBetween(reminder, start, end, timeZone, MAX_DOTS).length;
    if (total >= MAX_DOTS) break;
  }
  return Math.min(total, MAX_DOTS);
}

/** Calendar day cell: the default button plus one dot per reminder on that day. */
function ReminderDayButton(props: ComponentProps<typeof DayButton>) {
  const { reminders, timeZone, dotCounts } = useContext(RemindersContext);
  const date = props.day.date;
  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  let count = dotCounts.get(key);
  if (count === undefined) {
    count = countOnDay(reminders, date, timeZone);
    dotCounts.set(key, count);
  }
  return (
    <CalendarDayButton {...props}>
      {props.children}
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

export function ReminderCalendar({
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
  const value = useMemo<RemindersContextValue>(
    () => ({ reminders, timeZone, dotCounts: new Map() }),
    [reminders, timeZone],
  );
  return (
    <RemindersContext.Provider value={value}>
      <Calendar
        mode="single"
        selected={selected}
        onSelect={(date) => {
          // Clicking the selected day deselects it (undefined). Keep the current day selected.
          if (date) onSelect(date);
        }}
        components={{ DayButton: ReminderDayButton }}
        className="w-full text-xs [&_button]:text-xs"
      />
    </RemindersContext.Provider>
  );
}
