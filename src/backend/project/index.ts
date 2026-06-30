import type { BackendContext } from "../types";
import type { ACPBridge } from "../agent/agent-bridge";
import type { WatcherModule } from "../watcher";
import { createFilesystemState } from "./filesystem";
import { createGitHandlers } from "./git";

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
  getPlatform: ReturnType<typeof createFilesystemState>["getPlatform"];
  // Git handlers
  getGitStatus: ReturnType<typeof createGitHandlers>["getGitStatus"];
  readGitHeadFile: ReturnType<typeof createGitHandlers>["readGitHeadFile"];
}

export function createProjectModule(
  ctx: BackendContext,
  deps: {
    bridgePool: Map<string, Promise<ACPBridge>>;
    watcher: WatcherModule;
  },
): ProjectModule {
  const { sendEvent, onEvent, storage } = ctx;

  const fs = createFilesystemState(ctx);
  const git = createGitHandlers(ctx);

  // React to fs-changed events to invalidate search cache
  onEvent((channel, payload) => {
    if (channel === "fs-changed") {
      fs.markProjectFsDirty((payload as { projectId: string }).projectId);
    }
  });

  async function ensureBridge(agentId: string): Promise<ACPBridge> {
    const p = deps.bridgePool.get(agentId);
    if (!p) throw new Error(`No bridge for agent ${agentId}`);
    return p;
  }

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
    storage.deleteProject(projectId);

    for (const session of projectSessions) {
      try {
        const b = await ensureBridge(session.agentId);
        if (b.isSessionLoaded(session.resumeId)) await b.closeSession(session.resumeId);
        await b.deleteSession(session.resumeId);
      } catch (error) {
        console.warn(
          `[backend] Failed to close/delete session on agent for ${session.agentId}:${session.resumeId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

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
    ...git,
  };
}
