import type { BackendContext } from "../types";
import type { WatcherModule } from "../watcher";
import type { SessionModule } from "../session";
import { createFilesystemState } from "./filesystem";

export interface ProjectModule {
  // Project CRUD
  listProjects: () => Promise<ReturnType<BackendContext["storage"]["listProjects"]>>;
  addProject: (cwd: string) => Promise<ReturnType<BackendContext["storage"]["addProject"]>>;
  renameProject: (params: { projectId: string; title: string }) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  // Filesystem handlers
  getSystemFilePath: ReturnType<typeof createFilesystemState>["getSystemFilePath"];
  copyFileToWorkspace: ReturnType<typeof createFilesystemState>["copyFileToWorkspace"];
  readUrlAsDataUrl: ReturnType<typeof createFilesystemState>["readUrlAsDataUrl"];
  searchFiles: ReturnType<typeof createFilesystemState>["searchFiles"];
  readDir: ReturnType<typeof createFilesystemState>["readDir"];
  createFile: ReturnType<typeof createFilesystemState>["createFile"];
  deleteFile: ReturnType<typeof createFilesystemState>["deleteFile"];
  renameFile: ReturnType<typeof createFilesystemState>["renameFile"];
  moveFile: ReturnType<typeof createFilesystemState>["moveFile"];
  readFile: ReturnType<typeof createFilesystemState>["readFile"];
  getFileInfo: ReturnType<typeof createFilesystemState>["getFileInfo"];
  writeExternalFile: ReturnType<typeof createFilesystemState>["writeExternalFile"];
  getGitStatus: ReturnType<typeof createFilesystemState>["getGitStatus"];
  readGitHeadFile: ReturnType<typeof createFilesystemState>["readGitHeadFile"];
  getPlatform: ReturnType<typeof createFilesystemState>["getPlatform"];
}

export function createProjectModule(
  ctx: BackendContext,
  deps: {
    session: SessionModule;
    watcher: WatcherModule;
  },
): ProjectModule {
  const { sendEvent, onEvent, storage } = ctx;

  const fs = createFilesystemState(ctx);

  // React to fs-changed events to invalidate search cache
  onEvent((channel, payload) => {
    if (channel === "fs-changed") {
      fs.markProjectFsDirty((payload as { projectId: string }).projectId);
    }
  });

  // ── Project CRUD ───────────────────────────────────────────────────

  async function listProjects() {
    return storage.listProjects();
  }

  async function addProject(cwd: string) {
    const info = storage.addProject(cwd);
    fs.initProjectFsVersion(info.id);
    await deps.watcher.syncWatchers();
    sendEvent("projects-changed", undefined);
    return info;
  }

  async function renameProject({ projectId, title }: { projectId: string; title: string }) {
    storage.updateProjectTitle(projectId, title);
    sendEvent("projects-changed", undefined);
  }

  async function deleteProject(projectId: string) {
    const projectSessions = storage.listSessions().filter((s) => s.projectId === projectId);

    for (const session of projectSessions) {
      await deps.session.deleteSession(session.id);
    }

    storage.deleteProject(projectId);
    fs.clearProjectSearchState(projectId);
    await deps.watcher.syncWatchers();
    sendEvent("projects-changed", undefined);
    sendEvent("sessions-changed", undefined);
  }

  return {
    listProjects,
    addProject,
    renameProject,
    deleteProject,
    ...fs,
  };
}
