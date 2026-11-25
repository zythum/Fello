import { Cron } from "croner";
import {
  isValidCronExpression,
  MAX_FIRED_HISTORY,
  nextCronRun,
  previousCronRun,
  serverTimeZone,
  wasFired,
  type Reminder,
  type ReminderTrigger,
} from "../../shared/reminder";
import { ReminderStore } from "./store";

export { serverTimeZone };

/** setTimeout cannot wait longer than about 24.8 days, so long waits are re-armed in steps. */
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

export type ReminderListFilter = "upcoming" | "past" | "all";

export type ReminderView = Reminder & { nextRunAt: number | null };

export type DueReminder = { id: string; dueAt: number };

export type ReminderServiceOptions = {
  store: ReminderStore;
  /** Called when a reminder is due. The caller decides when and whether to deliver it. */
  onDue: (due: DueReminder) => void;
  /** Called after any change to the stored reminders, so the UI can refresh. */
  onChange?: () => void;
  now?: () => number;
};

function matchesFilter(reminder: Reminder, filter: ReminderListFilter, now: number): boolean {
  if (filter === "all") return true;
  const fired = reminder.trigger.type === "once" && wasFired(reminder, reminder.trigger.at);
  if (fired) return filter === "past";
  if (filter === "past") return reminder.trigger.type === "once" && reminder.trigger.at <= now;
  // upcoming: active reminders that can still fire.
  if (reminder.disabled) return false;
  return reminder.trigger.type === "cron" || reminder.trigger.at > now;
}

function nextRunAt(reminder: Reminder, now: number): number | null {
  if (reminder.disabled) return null;
  if (reminder.trigger.type === "once") {
    if (wasFired(reminder, reminder.trigger.at)) return null;
    // A one-time reminder that is already due has no next run.
    return reminder.trigger.at > now ? reminder.trigger.at : null;
  }
  return nextCronRun(reminder.trigger.expr, now, serverTimeZone());
}

/** Builds a trigger from the caller's input and rejects anything that cannot fire. */
export function toTrigger(input: { at?: number; cron?: string }, now: number): ReminderTrigger {
  const hasAt = input.at !== undefined;
  const hasCron = input.cron !== undefined;
  if (hasAt === hasCron) throw new Error("Give exactly one of at or cron.");
  if (hasAt) {
    if (!Number.isFinite(input.at) || input.at! <= now) {
      throw new Error("Reminder time must be in the future.");
    }
    return { type: "once", at: input.at! };
  }
  const expr = input.cron!.trim();
  if (!isValidCronExpression(expr, serverTimeZone()))
    throw new Error(`Invalid cron expression: ${expr}`);
  return { type: "cron", expr };
}

/**
 * Owns reminder timers. It only reports due reminders through `onDue`. Delivering the
 * message to the assistant is the caller's job, because it depends on the assistant's
 * connection and busy state.
 */
export class ReminderService {
  private readonly timers = new Map<string, () => void>();
  private readonly now: () => number;

  constructor(private readonly options: ReminderServiceOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  private changed(): void {
    this.options.onChange?.();
  }

  /** Every stored reminder, including disabled ones. */
  listAll(): Reminder[] {
    return this.options.store.list();
  }

  /** Reads reminders.json without arming timers, so listing works even while the assistant is stopped. */
  async load(): Promise<void> {
    await this.options.store.load();
  }

  async start(): Promise<void> {
    await this.load();
    for (const reminder of this.options.store.list()) this.schedule(reminder);
  }

  stop(): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
  }

  list(filter: ReminderListFilter = "upcoming"): ReminderView[] {
    const now = this.now();
    return this.options.store
      .list()
      .filter((reminder) => matchesFilter(reminder, filter, now))
      .map((reminder) => ({ ...reminder, nextRunAt: nextRunAt(reminder, now) }));
  }

  get(id: string): ReminderView | undefined {
    const reminder = this.options.store.get(id);
    return reminder ? { ...reminder, nextRunAt: nextRunAt(reminder, this.now()) } : undefined;
  }

  async create(input: { text: string; at?: number; cron?: string }): Promise<ReminderView> {
    const now = this.now();
    const reminder: Reminder = {
      id: this.options.store.newId(),
      text: input.text,
      trigger: toTrigger(input, now),
      disabled: false,
      firedAt: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.options.store.mutate((items) => {
      items.push(reminder);
    });
    this.schedule(reminder);
    this.changed();
    return { ...reminder, nextRunAt: nextRunAt(reminder, now) };
  }

  async update(
    id: string,
    patch: { text?: string; at?: number; cron?: string; enabled?: boolean },
  ): Promise<ReminderView> {
    const current = this.options.store.get(id);
    if (!current) throw new Error(`Reminder ${id} does not exist.`);

    const now = this.now();
    const hasNewTime = patch.at !== undefined || patch.cron !== undefined;
    const trigger = hasNewTime ? toTrigger(patch, now) : current.trigger;
    const disabled = patch.enabled === undefined ? current.disabled : !patch.enabled;

    await this.options.store.mutate((items) => {
      const target = items.find((item) => item.id === id);
      if (!target) throw new Error(`Reminder ${id} does not exist.`);
      target.text = patch.text ?? target.text;
      target.trigger = trigger;
      target.disabled = disabled;
      target.updatedAt = now;
    });
    const updated = this.options.store.get(id)!;
    this.schedule(updated);
    this.changed();
    return { ...updated, nextRunAt: nextRunAt(updated, now) };
  }

  /** Removes the reminder permanently. */
  async delete(id: string): Promise<void> {
    if (!this.options.store.get(id)) throw new Error(`Reminder ${id} does not exist.`);
    await this.options.store.mutate((items) => {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items.splice(index, 1);
    });
    this.unschedule(id);
    this.changed();
  }

  /** Records a successful delivery of one occurrence. A one-time reminder is finished after it fires. */
  async markDelivered(id: string, occurrenceAt: number): Promise<void> {
    const now = this.now();
    await this.options.store.mutate((items) => {
      const target = items.find((item) => item.id === id);
      if (!target) return;
      if (!wasFired(target, occurrenceAt)) {
        // Keep ascending even when deliveries arrive out of order, and keep the newest ones.
        target.firedAt = [...target.firedAt, occurrenceAt]
          .sort((a, b) => a - b)
          .slice(-MAX_FIRED_HISTORY);
      }
      target.updatedAt = now;
    });
    const updated = this.options.store.get(id);
    if (updated?.trigger.type === "once") this.unschedule(id);
    this.changed();
  }

  private schedule(reminder: Reminder): void {
    this.unschedule(reminder.id);
    if (reminder.disabled) return;
    if (reminder.trigger.type === "once") {
      // A one-time reminder that was already delivered stays done, including across restarts.
      if (wasFired(reminder, reminder.trigger.at)) return;
      // Only a reminder armed before its time can fire. Anything already due when it is armed
      // (the app was closed, or the reminder was disabled meanwhile) stays missed, and a
      // reminder armed while running still fires late when the machine was asleep.
      if (reminder.trigger.at <= this.now()) return;
      this.armOnce(reminder.id, reminder.trigger.at);
    } else {
      this.armCron(reminder.id, reminder.trigger.expr);
    }
  }

  private armOnce(id: string, at: number): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      timer = null;
      const remaining = at - this.now();
      if (remaining > 0) {
        timer = setTimeout(tick, Math.min(remaining, MAX_TIMER_MS));
        this.timers.set(id, () => {
          if (timer) clearTimeout(timer);
        });
        return;
      }
      this.timers.delete(id);
      this.options.onDue({ id, dueAt: at });
    };
    tick();
  }

  private armCron(id: string, expr: string): void {
    const job = new Cron(expr, { mode: "5-part", timezone: serverTimeZone() }, () => {
      // The callback only knows the actual (possibly delayed) time. Report the planned occurrence
      // it belongs to, so delivered times line up with the occurrence cards.
      this.options.onDue({
        id,
        dueAt: previousCronRun(expr, this.now(), serverTimeZone()) ?? this.now(),
      });
    });
    this.timers.set(id, () => job.stop());
  }

  private unschedule(id: string): void {
    this.timers.get(id)?.();
    this.timers.delete(id);
  }
}
