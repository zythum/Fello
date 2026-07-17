import { join } from "path";
import { CronJob } from "cron";
import type { McpServer } from "@agentclientprotocol/sdk";
import { store } from "./store";
import type { BackendContext } from "../types";
import type { InferenceModule } from "../inference";
import type { Schedule, Task, SessionNotificationFelloExt } from "../../shared/schema";

// ── Types ────────────────────────────────────────────────────────────

export interface AutomationModule {
  listSchedules: () => (Schedule & { nextRunAt: number | null })[];
  createSchedule: (params: {
    name: string;
    agentId: string;
    modelId?: string;
    prompt: string;
    cron: Schedule["cron"];
    features?: Schedule["features"];
    mcpServers?: Schedule["mcpServers"];
  }) => Schedule;
  updateSchedule: (scheduleId: string, updates: Partial<Schedule>) => Schedule;
  deleteSchedule: (scheduleId: string) => void;
  executeTask: (scheduleId: string) => Promise<Task>;
  listTasks: (scheduleId: string) => Task[];
  listTaskFiles: (scheduleId: string, taskId: string) => string[];
  readTaskFile: (
    scheduleId: string,
    taskId: string,
    filePath: string,
    encoding?: "base64",
  ) => string;
  getTaskFileSystemPath: (scheduleId: string, taskId: string, filePath: string) => string;
  deleteTask: (scheduleId: string, taskId: string) => void;
  stopAllCrons: () => void;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createAutomationModule(
  ctx: BackendContext,
  deps: { inference: InferenceModule },
): AutomationModule {
  const { sendEvent, storage } = ctx;
  const { inference } = deps;

  // ── Scheduler state ────────────────────────────────────────────────

  const scheduledCrons = new Map<string, CronJob>();
  const runningTasks = new Set<string>();

  function getNextRun(schedule: Schedule): number | null {
    const job = scheduledCrons.get(schedule.id);
    if (!job) return null;
    try {
      return job.nextDate().toMillis();
    } catch {
      return null;
    }
  }

  function scheduleCron(schedule: Schedule) {
    unscheduleCron(schedule.id);
    if (schedule.cron.type !== "cron" || !schedule.cron.expr) return;
    try {
      const cronJob = new CronJob(
        schedule.cron.expr,
        async () => {
          if (runningTasks.has(schedule.id)) return;
          await executeTask(schedule.id);
        },
        null,
        false,
      );
      scheduledCrons.set(schedule.id, cronJob);
      cronJob.start();
      const next = getNextRun(schedule);
      console.log(
        `[Automation] Scheduled "${schedule.name}" (${schedule.cron.expr}) next: ${next ? new Date(next).toLocaleString(storage.getSettings().i18n?.language) : "?"}`,
      );
    } catch (err) {
      console.error(`[Automation] Failed to schedule "${schedule.name}":`, err);
    }
  }

  function unscheduleCron(scheduleId: string) {
    const existing = scheduledCrons.get(scheduleId);
    if (existing) {
      existing.stop();
      scheduledCrons.delete(scheduleId);
    }
  }

  function stopAllCrons() {
    for (const job of scheduledCrons.values()) job.stop();
    scheduledCrons.clear();
  }

  function restoreActiveSchedules() {
    const schedules = store.listSchedules();
    for (const s of schedules) {
      if (s.cron.type === "cron" && s.cron.expr) scheduleCron(s);
    }
    console.log(`[Automation] Restored ${scheduledCrons.size} active schedule(s)`);
  }

  // ── Runner ─────────────────────────────────────────────────────────

  function buildAutomationMcpServers(mcpIds: string[]): McpServer[] {
    const settings = storage.getSettings();
    const servers: McpServer[] = [];
    for (const id of mcpIds) {
      const config = settings.mcpServers?.find((s) => s.id === id);
      if (!config) continue;
      if (config.type === "stdio") {
        servers.push({
          name: id,
          command: config.command,
          args: config.args,
          env: Object.entries(config.env).map(([k, v]) => ({ name: k, value: v })),
        });
      } else if (config.type === "http") {
        servers.push({
          type: "http",
          name: id,
          url: config.url,
          headers: Object.entries(config.headers).map(([k, v]) => ({ name: k, value: v })),
        });
      } else if (config.type === "sse") {
        servers.push({
          type: "sse",
          name: id,
          url: config.url,
          headers: Object.entries(config.headers).map(([k, v]) => ({ name: k, value: v })),
        });
      }
    }
    return servers;
  }

  async function executeTask(scheduleId: string): Promise<Task> {
    if (runningTasks.has(scheduleId)) throw new Error("Schedule task is already running");

    const schedule = store.getSchedule(scheduleId);
    if (!schedule) throw new Error("Schedule not found");

    runningTasks.add(scheduleId);
    const taskId = String(Date.now());
    const startedAt = Date.now();
    const task: Task = { id: taskId, scheduleId, startedAt, completedAt: null, status: "running" };

    store.saveTask(scheduleId, task);
    sendEvent("task-update", { scheduleId, task });

    const taskDir = store.taskDir(scheduleId, taskId);

    try {
      const mcpServers = buildAutomationMcpServers(schedule.mcpServers ?? []);

      const result = await inference.runInference({
        agentId: schedule.agentId,
        prompt: schedule.prompt,
        model: schedule.modelId ?? undefined,
        cwd: taskDir,
        mcpServers,
        features: schedule.features ?? [],
      });

      const notifications: SessionNotificationFelloExt[] = result.notifications.map((n, i) => ({
        ...n,
        update: {
          ...n.update,
          _meta: {
            ...n.update?._meta,
            fello: {
              ...(n.update?._meta?.fello as {}),
              receivedAt: Date.now(),
              displayId: `auto-${i}`,
            },
          },
        },
      }));

      store.writeTaskFile(
        scheduleId,
        taskId,
        ".fello-conversation.json",
        JSON.stringify(
          {
            __type: "fello-conversation",
            meta: {
              name: schedule.name,
              agentId: schedule.agentId,
              modelId: schedule.modelId ?? null,
              prompt: schedule.prompt,
              startedAt,
              completedAt: Date.now(),
            },
            notifications,
            terminalLogs: result.terminalLogs,
          },
          null,
          2,
        ),
      );

      schedule.lastRunAt = Date.now();
      schedule.updatedAt = Date.now();
      store.saveSchedule(schedule);
      sendEvent("schedules-changed", undefined);

      task.completedAt = Date.now();
      task.status = "success";
      store.saveTask(scheduleId, task);
      sendEvent("task-update", { scheduleId, task });
      return task;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      task.completedAt = Date.now();
      task.status = "error";
      task.error = errorMessage;
      store.saveTask(scheduleId, task);
      sendEvent("task-update", { scheduleId, task });
      console.error(`[Automation] Task failed:`, errorMessage);
      return task;
    } finally {
      runningTasks.delete(scheduleId);
    }
  }

  // ── Schedule CRUD ──────────────────────────────────────────────────

  function listSchedules() {
    return store.listSchedules().map((s) => ({ ...s, nextRunAt: getNextRun(s) }));
  }

  function createSchedule(params: {
    name: string;
    agentId: string;
    modelId?: string;
    prompt: string;
    cron: Schedule["cron"];
    features?: Schedule["features"];
    mcpServers?: Schedule["mcpServers"];
  }): Schedule {
    const schedule = store.createSchedule(params);
    if (schedule.cron.type === "cron" && schedule.cron.expr) scheduleCron(schedule);
    return schedule;
  }

  function updateSchedule(scheduleId: string, updates: Partial<Schedule>): Schedule {
    const schedule = store.getSchedule(scheduleId);
    if (!schedule) throw new Error("Schedule not found");
    Object.assign(schedule, updates);
    schedule.updatedAt = Date.now();
    store.saveSchedule(schedule);
    if (schedule.cron.type === "cron" && schedule.cron.expr) scheduleCron(schedule);
    else unscheduleCron(scheduleId);
    return schedule;
  }

  function deleteSchedule(scheduleId: string) {
    unscheduleCron(scheduleId);
    store.deleteSchedule(scheduleId);
  }

  function listTasks(scheduleId: string) {
    return store.listTasks(scheduleId);
  }
  function listTaskFiles(scheduleId: string, taskId: string) {
    return store.listTaskFiles(scheduleId, taskId);
  }
  function readTaskFile(scheduleId: string, taskId: string, filePath: string, encoding?: "base64") {
    return store.readTaskFile(scheduleId, taskId, filePath, encoding);
  }
  function getTaskFileSystemPath(scheduleId: string, taskId: string, filePath: string) {
    const base = store.taskDir(scheduleId, taskId);
    const fullPath = join(base, filePath);
    if (!fullPath.startsWith(base + "/") && fullPath !== base) throw new Error("Invalid file path");
    return fullPath;
  }
  function deleteTask(scheduleId: string, taskId: string) {
    store.deleteTask(scheduleId, taskId);
  }

  // ── Init: restore crons ────────────────────────────────────────────
  restoreActiveSchedules();

  return {
    listSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    executeTask,
    listTasks,
    listTaskFiles,
    readTaskFile,
    getTaskFileSystemPath,
    deleteTask,
    stopAllCrons,
  };
}
