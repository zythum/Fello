import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarIcon } from "lucide-react";

interface DateTimePickerProps {
  /** 选中的绝对时间（epoch 毫秒）；null 表示尚未选择 */
  value: number | null;
  onChange: (value: number) => void;
  /** 时区提示文案（仅用于展示） */
  timezone?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 默认时间：下一个整点 */
function defaultTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return `${pad2(d.getHours())}:00`;
}

/** 用日期部分 + "HH:mm" 组合出绝对时间戳 */
function mergeDateTime(date: Date, time: string): number {
  const [h, m] = time.split(":").map((v) => parseInt(v, 10));
  const next = new Date(date);
  next.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return next.getTime();
}

export function DateTimePicker({ value, onChange, timezone }: DateTimePickerProps) {
  const { t, i18n } = useTranslation();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(() => {
    if (value === null) return defaultTime();
    const d = new Date(value);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  });

  // 外部值变化时同步时间部分
  useEffect(() => {
    if (value === null) return;
    const d = new Date(value);
    // eslint-disable-next-line react/set-state-in-effect
    setTime(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
  }, [value]);

  const date = value !== null ? new Date(value) : undefined;

  const handleSelectDate = (next?: Date) => {
    if (!next) return;
    onChange(mergeDateTime(next, time));
    setOpen(false);
  };

  const handleTimeChange = (next: string) => {
    setTime(next);
    onChange(mergeDateTime(date ?? new Date(), next));
  };

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="h-8 min-w-0 flex-1 justify-start text-xs font-normal text-foreground/70"
            />
          }
        >
          <span className="truncate">
            {date
              ? date.toLocaleDateString(i18n.language, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : t("automation.oncePickDate", "Pick a date")}
          </span>
          <CalendarIcon className="ml-auto size-3.5 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleSelectDate}
            disabled={{ before: new Date() }}
            timeZone={timeZone}
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={time}
        onChange={(e) => handleTimeChange(e.target.value)}
        className="w-16 appearance-none text-xs! text-muted-foreground hover:text-foreground focus:text-foreground bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
      />
      {timezone && (
        <span className="shrink-0 text-[10px] text-muted-foreground/60">({timezone})</span>
      )}
    </div>
  );
}
