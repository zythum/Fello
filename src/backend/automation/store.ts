import { join, dirname } from "path";
import { homedir } from "os";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
  statSync,
} from "fs";
import type { Schedule, Task } from "../../shared/schema";

export const AUTOMATIONS_DIR = join(homedir(), ".fello", "automations");
mkdirSync(AUTOMATIONS_DIR, { recursive: true });

/**
 * 归一化剩余执行次数：
 * - `null` / `undefined` / 非法值 / 负数 → `null`（不限次数）
 * - 其余取非负整数
 */
export function normalizeRemainingRuns(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * 归一扫配置：
 * - 修正非法 `type`（旧数据只有 cron / manual）为 `cron`
 * - `expr` 仅对 cron 保留，`at` 仅对 once 保留
 */
function normalizeCron(raw: Schedule["cron"]): Schedule["cron"] {
  const type = raw?.type === "once" || raw?.type === "manual" ? raw.type : "cron";
  return {
    type,
    expr: type === "cron" ? (raw?.expr ?? "") : undefined,
    at: type === "once" && typeof raw?.at === "number" ? raw.at : undefined,
  };
}

/** 补齐历史数据中缺失的字段（旧版本 schedule.json 没有 remainingRuns / cron.at） */
function normalizeSchedule(raw: Schedule): Schedule {
  const cron = normalizeCron(raw.cron);
  const remainingRuns = normalizeRemainingRuns(raw.remainingRuns);
  return {
    ...raw,
    cron,
    // 单次计划用 remainingRuns 作为「是否已执行」标记；缺失（历史数据）按未执行处理
    remainingRuns: cron.type === "once" ? (remainingRuns ?? 1) : remainingRuns,
  };
}

export const store = {
  scheduleDir(scheduleId: string) {
    return join(AUTOMATIONS_DIR, scheduleId);
  },

  scheduleConfigPath(scheduleId: string) {
    return join(this.scheduleDir(scheduleId), "schedule.json");
  },

  tasksDir(scheduleId: string) {
    return join(this.scheduleDir(scheduleId), "tasks");
  },

  taskDir(scheduleId: string, taskId: string) {
    return join(this.tasksDir(scheduleId), taskId);
  },

  taskMetaPath(scheduleId: string, taskId: string) {
    return join(this.taskDir(scheduleId, taskId), "task.json");
  },

  listSchedules(): Schedule[] {
    if (!existsSync(AUTOMATIONS_DIR)) return [];
    const dirs = readdirSync(AUTOMATIONS_DIR);
    const list: Schedule[] = [];
    for (const dir of dirs) {
      try {
        const raw: Schedule = JSON.parse(readFileSync(this.scheduleConfigPath(dir), "utf-8"));
        list.push(normalizeSchedule(raw));
      } catch {
        // skip invalid
      }
    }
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  },

  getSchedule(scheduleId: string): Schedule | null {
    try {
      const raw: Schedule = JSON.parse(readFileSync(this.scheduleConfigPath(scheduleId), "utf-8"));
      return normalizeSchedule(raw);
    } catch {
      return null;
    }
  },

  saveSchedule(schedule: Schedule) {
    const dir = this.scheduleDir(schedule.id);
    mkdirSync(dir, { recursive: true });
    mkdirSync(this.tasksDir(schedule.id), { recursive: true });
    writeFileSync(this.scheduleConfigPath(schedule.id), JSON.stringify(schedule, null, 2));
  },

  createSchedule(params: {
    name: Schedule["name"];
    agentId: Schedule["agentId"];
    modelId?: Schedule["modelId"];
    prompt: Schedule["prompt"];
    cron: Schedule["cron"];
    remainingRuns?: Schedule["remainingRuns"];
    features?: Schedule["features"];
    mcpServers?: Schedule["mcpServers"];
  }): Schedule {
    const now = Date.now();
    const schedule: Schedule = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: params.name,
      agentId: params.agentId,
      modelId: params.modelId,
      prompt: params.prompt,
      cron: {
        type: params.cron.type,
        expr: params.cron.type === "cron" ? (params.cron.expr ?? "") : undefined,
        at: params.cron.type === "once" ? params.cron.at : undefined,
      },
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      // 单次计划用 remainingRuns 作为「是否已执行」标记：创建时固定为 1（待执行）
      remainingRuns: params.cron.type === "once" ? 1 : normalizeRemainingRuns(params.remainingRuns),
      features: (params.features ?? []).filter((f) => f !== "ask_user" && f !== "share_to_user"),
      mcpServers: params.mcpServers ?? [],
    };
    this.saveSchedule(schedule);
    return schedule;
  },

  deleteSchedule(scheduleId: string) {
    const dir = this.scheduleDir(scheduleId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  },

  listTasks(scheduleId: string): Task[] {
    const dir = this.tasksDir(scheduleId);
    if (!existsSync(dir)) return [];
    const dirs = readdirSync(dir);
    const list: Task[] = [];
    for (const d of dirs) {
      try {
        const raw: Task = JSON.parse(readFileSync(this.taskMetaPath(scheduleId, d), "utf-8"));
        list.push(raw);
      } catch {
        // skip
      }
    }
    list.sort((a, b) => b.startedAt - a.startedAt);
    return list;
  },

  getTask(scheduleId: string, taskId: string): Task | null {
    try {
      return JSON.parse(readFileSync(this.taskMetaPath(scheduleId, taskId), "utf-8"));
    } catch {
      return null;
    }
  },

  saveTask(scheduleId: string, task: Task) {
    const dir = this.taskDir(scheduleId, task.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.taskMetaPath(scheduleId, task.id), JSON.stringify(task, null, 2));
  },

  deleteTask(scheduleId: string, taskId: string) {
    const dir = this.taskDir(scheduleId, taskId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  },

  listTaskFiles(scheduleId: string, taskId: string): string[] {
    const dir = this.taskDir(scheduleId, taskId);
    if (!existsSync(dir)) return [];
    const entries = readdirSync(dir);
    return entries
      .filter((f) => f !== "task.json")
      .map((f) => {
        const fullPath = join(dir, f);
        const s = statSync(fullPath);
        if (s.isDirectory()) {
          return this._listDirRecursive(fullPath, f);
        }
        return f;
      })
      .flat()
      .sort();
  },

  _listDirRecursive(dir: string, prefix: string): string[] {
    const result: string[] = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        result.push(...this._listDirRecursive(full, join(prefix, entry)));
      } else {
        result.push(join(prefix, entry));
      }
    }
    return result;
  },

  readTaskFile(scheduleId: string, taskId: string, filePath: string, encoding?: "base64"): string {
    const base = this.taskDir(scheduleId, taskId);
    const fullPath = join(base, filePath);
    if (!fullPath.startsWith(base + "/") && fullPath !== base) throw new Error("Invalid file path");
    if (!existsSync(fullPath)) throw new Error("File not found");
    if (encoding === "base64") return readFileSync(fullPath).toString("base64");
    return readFileSync(fullPath, "utf-8");
  },

  writeTaskFile(scheduleId: string, taskId: string, filePath: string, content: string) {
    const base = this.taskDir(scheduleId, taskId);
    const fullPath = join(base, filePath);
    if (!fullPath.startsWith(base + "/") && fullPath !== base) throw new Error("Invalid file path");
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  },
};
