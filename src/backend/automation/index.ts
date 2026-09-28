import { join } from "path";
import { CronJob } from "cron";
import type { McpServer } from "@agentclientprotocol/sdk";
import { store, normalizeRemainingRuns } from "./store";
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
    remainingRuns?: Schedule["remainingRuns"];
    features?: Schedule["features"];
    mcpServers?: Schedule["mcpServers"];
  }) => Schedule;
  updateSchedule: (scheduleId: string, updates: Partial<Schedule>) => Schedule;
  deleteSchedule: (scheduleId: string) => void;
  executeTask: (scheduleId: string, source?: "cron" | "manual") => Promise<Task>;
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
    // 单次计划：已执行（remainingRuns 归零）或已过期都视为无下次；否则返回计划时间点本身
    // （不要走 job.nextDate()：once 的时间点若已过去，cron 库会抛异常）
    if (schedule.cron.type === "once") {
      if (isRunLimitReached(schedule)) return null;
      const at = schedule.cron.at;
      return at && at > Date.now() ? at : null;
    }
    const job = scheduledCrons.get(schedule.id);
    if (!job) return null;
    try {
      return job.nextDate().toMillis();
    } catch {
      return null;
    }
  }

  /** 剩余执行次数已耗尽（remainingRuns 为 null 表示不限次数） */
  function isRunLimitReached(schedule: Schedule): boolean {
    return schedule.remainingRuns !== null && schedule.remainingRuns <= 0;
  }

  /** 消耗一次执行配额；归零后注销 cron，避免继续触发 */
  function consumeRun(schedule: Schedule) {
    if (schedule.remainingRuns === null) return;
    schedule.remainingRuns = Math.max(0, schedule.remainingRuns - 1);
    schedule.updatedAt = Date.now();
    store.saveSchedule(schedule);
    if (isRunLimitReached(schedule)) {
      unscheduleCron(schedule.id);
      console.log(`[Automation] "${schedule.name}" reached its run limit, unscheduled`);
    }
    sendEvent("schedules-changed", undefined);
  }

  function scheduleCron(schedule: Schedule) {
    unscheduleCron(schedule.id);
    if (isRunLimitReached(schedule)) return;

    // 单次计划：用 Date 一次性调度（cron 库对 realDate 会置 runOnce，触发后不再重排）
    if (schedule.cron.type === "once") {
      const at = schedule.cron.at;
      // 已过期的时间点不注册；启动时由 restoreActiveSchedules 判定为「已错过」
      if (!at || at <= Date.now()) return;
      try {
        const onceJob = new CronJob(
          new Date(at),
          async () => {
            try {
              await executeTask(schedule.id, "cron");
            } catch (err) {
              console.error(`[Automation] Failed to run once task for "${schedule.name}":`, err);
            } finally {
              unscheduleCron(schedule.id);
            }
          },
          null,
          false,
        );
        scheduledCrons.set(schedule.id, onceJob);
        onceJob.start();
        console.log(
          `[Automation] Scheduled once "${schedule.name}" at ${new Date(at).toLocaleString(storage.getSettings().i18n?.language)}`,
        );
      } catch (err) {
        console.error(`[Automation] Failed to schedule once "${schedule.name}":`, err);
      }
      return;
    }

    if (schedule.cron.type !== "cron" || !schedule.cron.expr) return;
    try {
      const cronJob = new CronJob(
        schedule.cron.expr,
        async () => {
          if (runningTasks.has(schedule.id)) return;
          try {
            await executeTask(schedule.id, "cron");
          } catch (err) {
            console.error(`[Automation] Failed to start task for "${schedule.name}":`, err);
          }
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
      if (s.cron.type === "cron" && s.cron.expr) {
        scheduleCron(s);
      } else if (s.cron.type === "once") {
        // 已执行过（remainingRuns 归零）：不再恢复
        if (isRunLimitReached(s)) continue;
        const at = s.cron.at;
        if (at && at > Date.now()) {
          scheduleCron(s);
        } else {
          // 应用关闭期间错过：不补跑，仅保留记录（UI 依据 remainingRuns>0 且时间已过显示「已错过」）
          console.log(
            `[Automation] "${s.name}" once trigger missed (scheduled at ${at ? new Date(at).toLocaleString(storage.getSettings().i18n?.language) : "?"})`,
          );
        }
      }
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

  async function executeTask(
    scheduleId: string,
    source: "cron" | "manual" = "manual",
  ): Promise<Task> {
    if (runningTasks.has(scheduleId)) throw new Error("Schedule task is already running");

    const schedule = store.getSchedule(scheduleId);
    if (!schedule) throw new Error("Schedule not found");
    // 执行次数只约束定时触发；手动触发不受剩余次数限制
    if (source === "cron" && isRunLimitReached(schedule))
      throw new Error("Schedule run limit reached");

    runningTasks.add(scheduleId);
    const taskId = String(Date.now());
    const startedAt = Date.now();
    const task: Task = { id: taskId, scheduleId, startedAt, completedAt: null, status: "running" };

    store.saveTask(scheduleId, task);
    sendEvent("task-update", { scheduleId, task });

    // 在「触发瞬间」记录 lastRunAt：自动与手动触发都写，成功、失败都写
    schedule.lastRunAt = Date.now();
    schedule.updatedAt = Date.now();
    store.saveSchedule(schedule);
    sendEvent("schedules-changed", undefined);

    const taskDir = store.taskDir(scheduleId, taskId);

    try {
      // 自动触发消耗一次执行配额：周期计划自减 remainingRuns，单次计划由 1 归 0；
      // 手动触发不扣次数（「现在就跑一次」）
      if (source === "cron") consumeRun(schedule);

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
    remainingRuns?: Schedule["remainingRuns"];
    features?: Schedule["features"];
    mcpServers?: Schedule["mcpServers"];
  }): Schedule {
    const schedule = store.createSchedule(params);
    if (schedule.cron.type !== "manual") scheduleCron(schedule);
    return schedule;
  }

  function updateSchedule(scheduleId: string, updates: Partial<Schedule>): Schedule {
    const schedule = store.getSchedule(scheduleId);
    if (!schedule) throw new Error("Schedule not found");
    Object.assign(schedule, updates);
    if (schedule.cron.type === "once") {
      // 单次计划用 remainingRuns 作为「是否已执行」标记（1 = 待执行，0 = 已执行）。
      // 保存为单次时一律重置为 1，确保每次配置都是一次干净的待执行。
      schedule.remainingRuns = 1;
    } else if ("remainingRuns" in updates) {
      schedule.remainingRuns = normalizeRemainingRuns(updates.remainingRuns);
    }
    schedule.updatedAt = Date.now();
    store.saveSchedule(schedule);
    if (schedule.cron.type !== "manual") scheduleCron(schedule);
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
