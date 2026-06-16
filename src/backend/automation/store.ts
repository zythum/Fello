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
        list.push(raw);
      } catch {
        // skip invalid
      }
    }
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  },

  getSchedule(scheduleId: string): Schedule | null {
    try {
      return JSON.parse(readFileSync(this.scheduleConfigPath(scheduleId), "utf-8"));
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
    prompt: Schedule["prompt"];
    cron: Schedule["cron"];
    features?: Schedule["features"];
    mcpServers?: Schedule["mcpServers"];
  }): Schedule {
    const now = Date.now();
    const schedule: Schedule = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: params.name,
      agentId: params.agentId,
      prompt: params.prompt,
      cron: { type: params.cron.type, expr: params.cron.expr ?? "" },
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      features: (params.features ?? []).filter((f) => f !== "ask_user"),
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
