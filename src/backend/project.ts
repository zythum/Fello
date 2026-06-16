import { storageOps } from "./storage";
import { bridgePool } from "./session-agent-bridge";
import { clearProjectSearchState, initProjectFsVersion } from "./project-filesystem";
import { syncWatchers } from "./watcher";
import { deletePersistedSessionDirectory } from "../agents/storage";
import type { FelloIPCSchema } from "../shared/schema";

let sendEvent: <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => boolean = () => false;

export function initProject(emitter: typeof sendEvent) {
  sendEvent = emitter;
}

export async function listProjects() {
  return storageOps.listProjects();
}

export async function addProject(cwd: string) {
  const info = storageOps.addProject(cwd);
  initProjectFsVersion(info.id);
  await syncWatchers();
  sendEvent("projects-changed", undefined);
  return info;
}

export async function renameProject({ projectId, title }: { projectId: string; title: string }) {
  storageOps.updateProjectTitle(projectId, title);
  sendEvent("projects-changed", undefined);
}

export async function deleteProject(projectId: string) {
  const projectSessions = storageOps.listSessions().filter((s) => s.projectId === projectId);
  storageOps.deleteProject(projectId);

  for (const session of projectSessions) {
    try {
      const connectPromise = bridgePool.get(session.agentId);
      if (connectPromise) {
        const b = await connectPromise;
        if (b.isSessionLoaded(session.resumeId)) await b.closeSession(session.resumeId);
      }
    } catch (error) {
      console.warn(
        `[backend] Failed to close session on agent for ${session.agentId}:${session.resumeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      deletePersistedSessionDirectory({ agentId: session.agentId, sessionId: session.resumeId });
    } catch (error) {
      console.warn(
        `[backend] Failed to delete persisted session directory for ${session.agentId}:${session.resumeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  clearProjectSearchState(projectId);
  await syncWatchers();
  sendEvent("projects-changed", undefined);
  sendEvent("sessions-changed", undefined);
}
