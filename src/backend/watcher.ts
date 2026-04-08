import chokidar, { type FSWatcher } from "chokidar";
import { storageOps } from "./storage";
import type { FelloIPCSchema } from "../shared/schema";
import { relative } from "path";
import { isIgnorePath, toPosixPath } from "./utils";

const watchers = new Map<string, FSWatcher>();
const MAX_BATCH_CHANGES = 1000;

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
  syncWatchers();
}

export function syncWatchers() {
  const projects = storageOps.listProjects();
  const currentProjects = new Map(projects.map((p) => [p.id, p]));

  // Remove watchers for deleted projects
  for (const [projectId, watcher] of watchers.entries()) {
    if (!currentProjects.has(projectId)) {
      watcher.close();
      watchers.delete(projectId);
    }
  }

  // Add watchers for new projects
  for (const [projectId, project] of currentProjects) {
    if (!watchers.has(projectId)) {
      createWatcher(projectId, project.cwd);
    }
  }
}

function createWatcher(projectId: string, cwd: string) {
  const watcher = chokidar.watch(cwd, {
    ignored: (fullPath: string) => {
      return isIgnorePath(fullPath, cwd);
    },
    followSymlinks: false,
    ignoreInitial: true,
    depth: 15, // Prevent infinite deep directory recursion
  });

  const changes = new Set<string>();
  let overflowed = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

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
    timeout = setTimeout(() => {
      if (changes.size > 0) {
        sendEvent("fs-changed", { projectId, changes: Array.from(changes) });
        changes.clear();
        overflowed = false;
      }
    }, 500);
  };

  watcher.on("all", (event, path) => {
    if (
      event === "add" ||
      event === "change" ||
      event === "unlink" ||
      event === "addDir" ||
      event === "unlinkDir"
    ) {
      // Map the absolute path to a relative path before emitting
      // File watcher paths are emitted using the native OS separator.
      // We normalize them to POSIX paths (using forward slashes) before sending to the frontend.
      onChange(toPosixPath(relative(cwd, path)));
    }
  });

  watcher.on("error", (error) => {
    console.error(`[Watcher] Error for ${projectId} (${cwd}):`, error);
    // On EMFILE or other fatal errors, we don't aggressively reconnect here
    // to avoid infinite loops. It can be re-synced if the project is re-added or restarted.
  });

  watchers.set(projectId, watcher);
}
