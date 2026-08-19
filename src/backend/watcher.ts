import { statSync } from "fs";
import watcher from "@parcel/watcher";
import { join, relative } from "path";
import type { BackendContext } from "./types";
import { toPosixPath } from "./utils";
import { isSelfWrite } from "./self-write";

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

  async function syncWatchers() {
    const enabled = isFileWatcherEnabled();
    const projects = storage.listProjects();
    const currentProjects = new Map(projects.map((p) => [p.id, p]));

    if (!enabled) {
      for (const [projectId, subscription] of subscriptions.entries()) {
        await subscription.unsubscribe();
        subscriptions.delete(projectId);
      }
      return;
    }

    for (const [projectId, subscription] of subscriptions.entries()) {
      if (!currentProjects.has(projectId)) {
        await subscription.unsubscribe();
        subscriptions.delete(projectId);
      }
    }

    for (const [projectId, project] of currentProjects) {
      if (!subscriptions.has(projectId)) {
        await createWatcherSubscription(projectId, project.cwd);
      }
    }
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
    for (const [projectId, subscription] of subscriptions.entries()) {
      await subscription.unsubscribe();
      subscriptions.delete(projectId);
    }
  }

  // Fire initial sync
  void syncWatchers();

  return { syncWatchers, stopAll };
}
