import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";
import { z } from "zod";
import type { Reminder } from "../../shared/reminder";

export type { Reminder, ReminderTrigger } from "../../shared/reminder";

const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("once"), at: z.number().int().nonnegative() }),
  z.object({ type: z.literal("cron"), expr: z.string().min(1).max(100) }),
]);

const reminderSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(500),
  trigger: triggerSchema,
  disabled: z.boolean(),
  firedAt: z.array(z.number().int().nonnegative()),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const fileSchema = z.object({
  version: z.literal(1),
  reminders: z.array(reminderSchema),
});

function cloneReminder(item: Reminder): Reminder {
  return { ...item, trigger: { ...item.trigger }, firedAt: [...item.firedAt] };
}

/**
 * Persists reminders to reminders.json. Writes run one at a time and go through a
 * temporary file, so a crash cannot leave a half-written file. A file that fails to
 * parse is an error, not an empty list, so existing reminders are never overwritten.
 */
export class ReminderStore {
  private items: Reminder[] = [];
  private writeQueue: Promise<unknown> = Promise.resolve();
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly path: string) {}

  /**
   * Reads reminders.json once. If the file exists but cannot be read or parsed, the load fails
   * and every later write fails too, so the file is never overwritten with an empty list.
   */
  load(): Promise<void> {
    this.loadPromise ??= this.readFromDisk();
    return this.loadPromise;
  }

  private async readFromDisk(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.items = [];
        return;
      }
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error("reminders.json is not valid JSON. Fix or remove the file, then restart Fello.");
    }
    const parsed = fileSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`reminders.json is invalid: ${parsed.error.message}`);
    }
    this.items = parsed.data.reminders;
  }

  list(): Reminder[] {
    return this.items.map(cloneReminder);
  }

  get(id: string): Reminder | undefined {
    const found = this.items.find((item) => item.id === id);
    return found ? cloneReminder(found) : undefined;
  }

  /** Applies a change and persists it. A failed write restores the previous state. */
  mutate<T>(change: (items: Reminder[]) => T): Promise<T> {
    const run = this.writeQueue.then(async () => {
      // Throws when the file could not be loaded. Nothing is written in that case.
      await this.load();
      const snapshot = this.items.map(cloneReminder);
      try {
        const result = change(this.items);
        await this.persist();
        return result;
      } catch (error) {
        this.items = snapshot;
        throw error;
      }
    });
    this.writeQueue = run.catch(() => {});
    return run;
  }

  newId(): string {
    return randomUUID();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    const content = JSON.stringify({ version: 1, reminders: this.items }, null, 2);
    await writeFile(temporaryPath, `${content}\n`, "utf8");
    await rename(temporaryPath, this.path);
  }
}
