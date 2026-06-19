export { store } from "./store";
export { scheduleCron, unscheduleCron, stopAllCrons, getNextRun } from "./scheduler";
export { initRunner, executeTask } from "./runner";

// ── High-level Schedule Handlers ─────────────────────────────────────

import { join } from "path";
import { store } from "./store";
import { scheduleCron, unscheduleCron, getNextRun } from "./scheduler";
import type { Schedule } from "../../shared/schema";

export function listSchedules() {
  return store.listSchedules().map((s) => ({ ...s, nextRunAt: getNextRun(s) }));
}

export function createSchedule(params: {
  name: Schedule["name"];
  agentId: Schedule["agentId"];
  modelId?: Schedule["modelId"];
  prompt: Schedule["prompt"];
  cron: Schedule["cron"];
  features?: Schedule["features"];
  mcpServers?: Schedule["mcpServers"];
}): Schedule {
  const schedule = store.createSchedule(params);
  if (schedule.cron.type === "cron" && schedule.cron.expr) {
    scheduleCron(schedule);
  }
  return schedule;
}

export function updateSchedule(scheduleId: string, updates: Partial<Schedule>): Schedule {
  const schedule = store.getSchedule(scheduleId);
  if (!schedule) throw new Error("Schedule not found");
  Object.assign(schedule, updates);
  schedule.updatedAt = Date.now();
  store.saveSchedule(schedule);
  if (schedule.cron.type === "cron" && schedule.cron.expr) {
    scheduleCron(schedule);
  } else {
    unscheduleCron(scheduleId);
  }
  return schedule;
}

export function deleteSchedule(scheduleId: string) {
  unscheduleCron(scheduleId);
  store.deleteSchedule(scheduleId);
}

export function listTasks(scheduleId: string) {
  return store.listTasks(scheduleId);
}

export function listTaskFiles(scheduleId: string, taskId: string) {
  return store.listTaskFiles(scheduleId, taskId);
}

export function readTaskFile(
  scheduleId: string,
  taskId: string,
  filePath: string,
  encoding?: "base64",
) {
  return store.readTaskFile(scheduleId, taskId, filePath, encoding);
}

export function getTaskFileSystemPath(scheduleId: string, taskId: string, filePath: string) {
  const base = store.taskDir(scheduleId, taskId);
  const fullPath = join(base, filePath);
  if (!fullPath.startsWith(base + "/") && fullPath !== base) throw new Error("Invalid file path");
  return fullPath;
}

export function deleteTask(scheduleId: string, taskId: string) {
  store.deleteTask(scheduleId, taskId);
}
