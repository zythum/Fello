import { CronJob } from "cron";
import { store } from "./store";
import { executeTask } from "./runner";
import { storageOps } from "../storage";
import type { Schedule } from "../../shared/schema";

const scheduledCrons = new Map<string, CronJob>();

export function getNextRun(schedule: Schedule): number | null {
  const job = scheduledCrons.get(schedule.id);
  if (!job) return null;
  try {
    return job.nextDate().toMillis();
  } catch {
    return null;
  }
}

export function scheduleCron(schedule: Schedule) {
  unscheduleCron(schedule.id);

  if (schedule.cron.type !== "cron" || !schedule.cron.expr) {
    return;
  }

  try {
    const cronJob = new CronJob(
      schedule.cron.expr,
      async () => {
        if (runningTasks.has(schedule.id)) {
          console.log(`[Automation] "${schedule.name}" already running, skipping`);
          return;
        }
        await executeTask(schedule.id);
      },
      null,
      false,
    );

    scheduledCrons.set(schedule.id, cronJob);
    cronJob.start();

    const next = getNextRun(schedule);
    console.log(
      `[Automation] Scheduled "${schedule.name}" (${schedule.cron.expr}) next: ${next ? new Date(next).toLocaleString(storageOps.getSettings().i18n?.language) : "?"}`,
    );
  } catch (err) {
    console.error(`[Automation] Failed to schedule "${schedule.name}":`, err);
  }
}

export function unscheduleCron(scheduleId: string) {
  const existing = scheduledCrons.get(scheduleId);
  if (existing) {
    existing.stop();
    scheduledCrons.delete(scheduleId);
  }
}

export function restoreActiveSchedules() {
  const schedules = store.listSchedules();
  for (const s of schedules) {
    if (s.cron.type === "cron" && s.cron.expr) {
      scheduleCron(s);
    }
  }
  console.log(`[Automation] Restored ${scheduledCrons.size} active schedule(s)`);
}

export function stopAllCrons() {
  for (const job of scheduledCrons.values()) {
    job.stop();
  }
  scheduledCrons.clear();
  console.log("[Automation] All crons stopped");
}

// Track running tasks to prevent concurrent execution of the same schedule
export const runningTasks = new Set<string>();
