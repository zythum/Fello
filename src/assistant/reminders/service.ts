import { Cron } from "croner";
import { isValidCronExpression, nextCronRun, type Reminder, type ReminderTrigger } from "../../shared/reminder";
import { ReminderStore } from "./store";

/** A reminder delivered up to this long after it was due is still sent. Later ones are missed. */
export const CATCH_UP_WINDOW_MS = 60 * 60 * 1000;

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

/** Time zone of the server process. Cron times and calendar days are evaluated in it. */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function matchesFilter(reminder: Reminder, filter: ReminderListFilter): boolean {
  if (filter === "all") return true;
  if (filter === "past") return reminder.status === "fired" || reminder.status === "missed";
  return reminder.status === "scheduled";
}

function nextRunAt(reminder: Reminder): number | null {
  if (reminder.status !== "scheduled") return null;
  if (reminder.trigger.type === "once") return reminder.trigger.at;
  return nextCronRun(reminder.trigger.expr, Date.now(), serverTimeZone());
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
  if (!isValidCronExpression(expr, serverTimeZone())) throw new Error(`Invalid cron expression: ${expr}`);
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

  /** Every stored reminder, including disabled and deleted ones. */
  listAll(): Reminder[] {
    return this.options.store.list();
  }

  async start(): Promise<void> {
    await this.options.store.load();
    for (const reminder of this.options.store.list()) this.schedule(reminder);
  }

  stop(): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
  }

  list(filter: ReminderListFilter = "upcoming"): ReminderView[] {
    return this.options.store
      .list()
      .filter((reminder) => matchesFilter(reminder, filter))
      .map((reminder) => ({ ...reminder, nextRunAt: nextRunAt(reminder) }));
  }

  get(id: string): ReminderView | undefined {
    const reminder = this.options.store.get(id);
    return reminder ? { ...reminder, nextRunAt: nextRunAt(reminder) } : undefined;
  }

  async create(input: { text: string; at?: number; cron?: string }): Promise<ReminderView> {
    const now = this.now();
    const reminder: Reminder = {
      id: this.options.store.newId(),
      text: input.text,
      trigger: toTrigger(input, now),
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
      lastFiredAt: null,
    };
    await this.options.store.mutate((items) => {
      items.push(reminder);
    });
    this.schedule(reminder);
    this.changed();
    return { ...reminder, nextRunAt: nextRunAt(reminder) };
  }

  async update(
    id: string,
    patch: { text?: string; at?: number; cron?: string; enabled?: boolean },
  ): Promise<ReminderView> {
    const current = this.options.store.get(id);
    if (!current || current.status === "deleted") throw new Error(`Reminder ${id} does not exist.`);

    const now = this.now();
    const hasNewTime = patch.at !== undefined || patch.cron !== undefined;
    const trigger = hasNewTime ? toTrigger(patch, now) : current.trigger;
    let status = current.status;
    if (hasNewTime) status = "scheduled";
    if (patch.enabled === false) {
      status = "disabled";
    } else if (patch.enabled === true && status === "disabled") {
      status = "scheduled";
    } else if (patch.enabled === true && (status === "fired" || status === "missed")) {
      throw new Error("Give a new time to reschedule a reminder that already ran or was missed.");
    }

    await this.options.store.mutate((items) => {
      const target = items.find((item) => item.id === id);
      if (!target) throw new Error(`Reminder ${id} does not exist.`);
      target.text = patch.text ?? target.text;
      target.trigger = trigger;
      target.status = status;
      target.updatedAt = now;
    });
    const updated = this.options.store.get(id)!;
    this.schedule(updated);
    this.changed();
    return { ...updated, nextRunAt: nextRunAt(updated) };
  }

  async delete(id: string): Promise<void> {
    const current = this.options.store.get(id);
    if (!current || current.status === "deleted") throw new Error(`Reminder ${id} does not exist.`);
    const now = this.now();
    await this.options.store.mutate((items) => {
      const target = items.find((item) => item.id === id);
      if (target) {
        target.status = "deleted";
        target.updatedAt = now;
      }
    });
    this.unschedule(id);
    this.changed();
  }

  /** Records a successful delivery. A one-time reminder is finished after it fires. */
  async markDelivered(id: string, firedAt: number): Promise<void> {
    await this.options.store.mutate((items) => {
      const target = items.find((item) => item.id === id);
      if (!target) return;
      target.lastFiredAt = firedAt;
      target.updatedAt = firedAt;
      if (target.trigger.type === "once") target.status = "fired";
    });
    const updated = this.options.store.get(id);
    if (updated?.trigger.type === "once") this.unschedule(id);
    this.changed();
  }

  /** A one-time reminder that could not be delivered in time is missed. Cron occurrences are only skipped. */
  async markMissed(id: string): Promise<void> {
    await this.options.store.mutate((items) => {
      const target = items.find((item) => item.id === id);
      if (target && target.trigger.type === "once") target.status = "missed";
    });
    this.unschedule(id);
    this.changed();
  }

  private schedule(reminder: Reminder): void {
    this.unschedule(reminder.id);
    if (reminder.status !== "scheduled") return;
    if (reminder.trigger.type === "once") {
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
    const job = new Cron(expr, { mode: "5-part" }, () => this.options.onDue({ id, dueAt: this.now() }));
    this.timers.set(id, () => job.stop());
  }

  private unschedule(id: string): void {
    this.timers.get(id)?.();
    this.timers.delete(id);
  }
}
