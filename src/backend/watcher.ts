import watcher from "@parcel/watcher";
import { relative } from "path";
import type { BackendContext } from "./types";
import { toPosixPath } from "./utils";

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
        sendEvent("fs-changed", { projectId, changes: Array.from(changes) });
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
