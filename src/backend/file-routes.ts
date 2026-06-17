import { storageOps } from "./storage";
import { serveFile } from "./serve-file";
import { store as autoStore } from "./automation/store";
import type { ProjectFileResult } from "./serve-file";

// ── Route Types ──────────────────────────────────────────────────────

export type FileRoute =
  | { type: "project"; projectId: string; relativePath: string }
  | { type: "share"; projectId: string; sessionId: string; sharePath: string }
  | { type: "automation"; scheduleId: string; taskId: string; relativePath: string };

// ── 统一 URL 解析 ────────────────────────────────────────────────────
//
// 支持两种入口，pathname 格式完全一致：
//   Electron: fello://web/<resourceType>/...
//   WebUI:    http://host/<resourceType>/...
//
// 资源类型:
//   /project/<projectId>/<relativePath>
//   /share/<projectId>/<sessionId>/<sharePath>
//   /automation/<scheduleId>/<taskId>/<relativePath>

function decodePath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function parseFileRoute(url: URL): FileRoute | null {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const [resourceType, ...rest] = parts;

  if (resourceType === "project") {
    const [projectId, ...pathRest] = rest;
    const relativePath = decodePath(pathRest.join("/"));
    if (!projectId || !relativePath) return null;
    return { type: "project", projectId, relativePath };
  }

  if (resourceType === "share") {
    const [projectId, sessionId, ...pathRest] = rest;
    const sharePath = decodePath(pathRest.join("/"));
    if (!projectId || !sessionId || !sharePath) return null;
    return { type: "share", projectId, sessionId, sharePath };
  }

  if (resourceType === "automation") {
    const [scheduleId, taskId, ...pathRest] = rest;
    const relativePath = decodePath(pathRest.join("/"));
    if (!scheduleId || !taskId || !relativePath) return null;
    return { type: "automation", scheduleId, taskId, relativePath };
  }

  return null;
}

// ── Route 执行 ───────────────────────────────────────────────────────

export async function serveRoute(route: FileRoute): Promise<ProjectFileResult> {
  switch (route.type) {
    case "project": {
      const project = storageOps.getProject(route.projectId);
      if (!project) {
        return {
          status: 404,
          body: "Project Not Found",
          mimeType: "text/plain",
          error: "Project Not Found",
        };
      }
      return serveFile(route.relativePath, project.cwd);
    }

    case "share": {
      const shareDir = storageOps.sessionShareDir(route.sessionId);
      if (!shareDir) {
        return {
          status: 404,
          body: "Session Not Found",
          mimeType: "text/plain",
          error: "Session Not Found",
        };
      }
      return serveFile(route.sharePath, shareDir);
    }

    case "automation": {
      const task = autoStore.getTask(route.scheduleId, route.taskId);
      if (!task) {
        return {
          status: 404,
          body: "Task Not Found",
          mimeType: "text/plain",
          error: "Task Not Found",
        };
      }
      const taskDir = autoStore.taskDir(route.scheduleId, route.taskId);
      return serveFile(route.relativePath, taskDir);
    }
  }
}
