import { statSync } from "fs";
import watcher from "@parcel/watcher";
import { join, relative } from "path";
import type { BackendContext } from "./types";
import { toPosixPath } from "./utils";
import { isSelfWrite } from "./self-write";
import { assistantProjectId } from "../shared/assistant";
import { assistantWorkspacePath, listAssistantConfigs } from "../assistant/config";

const MAX_BATCH_CHANGES = 1000;

const IGNORE = [
  "**/.git/**",
  "**/.svn/**",
  "**/.hg/**",
  "**/node_modules/**",
  "**/bower_components/**",
  "**/.cache/**",
  "**/venv/**",
  "**/.venv/**",
  "**/vendor/**",
  "**/__pycache__/**",
];

export interface WatcherModule {
  syncWatchers: () => Promise<void>;
  stopAll: () => Promise<void>;
}

export function createWatcherModule(ctx: BackendContext): WatcherModule {
  const { sendEvent, storage } = ctx;
  const subscriptions = new Map<string, watcher.AsyncSubscription>();

  function isFileWatcherEnabled(): boolean {
    return storage.getSettings().fileWatcher?.enabled ?? true;
  }

  async function runSync() {
    const enabled = isFileWatcherEnabled();
    const projects = storage.listProjects();
    const currentProjects = new Map(projects.map((p) => [p.id, p]));
    // Assistant workspaces are virtual projects: watch each one so its file panel
    // receives the same fs-changed events as project sessions.
    //
    // 这里刻意不 mkdir：工作区目录由助理运行时（ensureAssistantDirectories / start）创建。
    // 同步是按磁盘列表重建视图的，若在这里建目录，一次「删除前发起的在途同步」就会把刚删掉的
    // 工作区目录重新建出来，留下没有 config.json 的孤儿目录。
    for (const assistant of listAssistantConfigs()) {
      const cwd = assistantWorkspacePath(assistant.id);
      const projectId = assistantProjectId(assistant.id);
      currentProjects.set(projectId, {
        id: projectId,
        title: assistant.name,
        cwd,
        createdAt: assistant.createdAt,
      });
    }

    if (!enabled) {
      await unsubscribeAll();
      return;
    }

    for (const projectId of [...subscriptions.keys()]) {
      if (!currentProjects.has(projectId)) {
        await unsubscribe(projectId);
      }
    }

    for (const [projectId, project] of currentProjects) {
      if (!subscriptions.has(projectId)) {
        await createWatcherSubscription(projectId, project.cwd);
      }
    }
  }

  /**
   * 停掉一个订阅：单个失败只记日志，不拖垮整轮同步；失败时保留条目，下一轮同步再试。
   */
  async function unsubscribe(projectId: string): Promise<void> {
    const subscription = subscriptions.get(projectId);
    if (!subscription) return;
    try {
      await subscription.unsubscribe();
    } catch (error) {
      console.error(`[Watcher] Failed to unsubscribe ${projectId}:`, error);
      return;
    }
    subscriptions.delete(projectId);
  }

  async function unsubscribeAll(): Promise<void> {
    for (const projectId of [...subscriptions.keys()]) {
      await unsubscribe(projectId);
    }
  }

  // 同一时间只跑一轮同步：`updateSettings`、建/删项目、建/删助理都会触发，并发同步会重复
  // subscribe（map 里只留后一个，前一个原生订阅永久泄漏，fs-changed 事件翻倍）——期间再来的
  // 调用只记一次「跑完再来一轮」，保证最终一致。
  let syncing: Promise<void> | null = null;
  let resyncRequested = false;

  async function syncWatchers(): Promise<void> {
    if (syncing) {
      resyncRequested = true;
      return syncing;
    }
    syncing = (async () => {
      try {
        do {
          resyncRequested = false;
          await runSync();
        } while (resyncRequested);
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  async function createWatcherSubscription(projectId: string, cwd: string) {
    const changes = new Set<string>();
    let overflowed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (changes.size > 0) {
        const allChanges = Array.from(changes);
        // 命中「应用自写」记录的变更单独标记，供前端区分自保存与外部修改
        const selfChanges = allChanges.filter((p) => {
          let st: ReturnType<typeof statSync> | undefined;
          try {
            st = statSync(join(cwd, p), { throwIfNoEntry: false });
          } catch {
            // stat 失败（如权限错误）时按非自写处理，避免中断整个事件派发
            st = undefined;
          }
          return isSelfWrite(projectId, p, st ? { mtimeMs: st.mtimeMs, size: st.size } : null);
        });
        sendEvent("fs-changed", {
          projectId,
          changes: allChanges,
          ...(selfChanges.length > 0 ? { selfChanges } : {}),
        });
        changes.clear();
        overflowed = false;
      }
    };

    const onChange = (path: string) => {
      if (!overflowed) {
        if (changes.size < MAX_BATCH_CHANGES) {
          changes.add(path);
        } else {
          overflowed = true;
          changes.clear();
          changes.add(".");
        }
      }
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(flush, 500);
    };

    try {
      const subscription = await watcher.subscribe(
        cwd,
        (err, events) => {
          if (err) {
            console.error(`[Watcher] Error for ${projectId} (${cwd}):`, err);
            return;
          }
          for (const event of events) {
            onChange(toPosixPath(relative(cwd, event.path)));
          }
        },
        { ignore: IGNORE },
      );
      subscriptions.set(projectId, subscription);
    } catch (err) {
      console.error(`[Watcher] Failed to subscribe for ${projectId} (${cwd}):`, err);
    }
  }

  async function stopAll() {
    await unsubscribeAll();
  }

  // Fire initial sync
  void syncWatchers();

  return { syncWatchers, stopAll };
}
