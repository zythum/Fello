import watcher from "@parcel/watcher";
import { storageOps } from "./storage";
import type { FelloIPCSchema } from "../shared/schema";
import { relative } from "path";
import { toPosixPath } from "./utils";

const subscriptions = new Map<string, watcher.AsyncSubscription>();
const MAX_BATCH_CHANGES = 1000;

/**
 * Glob patterns for paths that should be excluded from watching.
 * Mirrors the ignore set previously defined in utils.ts isIgnorePath().
 * @parcel/watcher uses picomatch globs matched against relative paths from the
 * watched root.
 */
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

let sendEvent: <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => boolean = () => false;

export function initWatcher(
  emitter: <K extends keyof FelloIPCSchema["events"]>(
    channel: K,
    payload: FelloIPCSchema["events"][K],
  ) => boolean,
) {
  sendEvent = emitter;
  // Fire-and-forget: at init time there are no stale subscriptions to clean
  // up, only new ones to create. Subscriptions are native and set up quickly.
  void syncWatchers();
}

export async function syncWatchers() {
  const projects = storageOps.listProjects();
  const currentProjects = new Map(projects.map((p) => [p.id, p]));

  // Remove watchers for deleted projects
  for (const [projectId, subscription] of subscriptions.entries()) {
    if (!currentProjects.has(projectId)) {
      await subscription.unsubscribe();
      subscriptions.delete(projectId);
    }
  }

  // Add watchers for new projects
  for (const [projectId, project] of currentProjects) {
    if (!subscriptions.has(projectId)) {
      await createWatcher(projectId, project.cwd);
    }
  }
}

async function createWatcher(projectId: string, cwd: string) {
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
          // @parcel/watcher uses native OS backends. Common errors:
          // - EMFILE (Linux): inotify watch limit reached.
          //   → Install Watchman (`brew install watchman` / `apt install watchman`)
          //     and @parcel/watcher will auto-detect it.
          //   → Or increase `fs.inotify.max_user_watches` via sysctl.
          // - EBADF (macOS): watched directory was deleted/moved externally.
          //   → The subscription is dead; it will be cleaned up on next
          //     syncWatchers() call (e.g. when user re-adds the project).
          console.error(`[Watcher] Error for ${projectId} (${cwd}):`, err);
          return;
        }

        for (const event of events) {
          // @parcel/watcher event types: 'create', 'update', 'delete'
          // 'create' covers both files and directories (add + addDir).
          // 'delete' covers both files and directories (unlink + unlinkDir).
          onChange(toPosixPath(relative(cwd, event.path)));
        }
      },
      { ignore: IGNORE },
    );

    subscriptions.set(projectId, subscription);
  } catch (err) {
    console.error(
      `[Watcher] Failed to subscribe for ${projectId} (${cwd}):`,
      err,
    );
  }
}
