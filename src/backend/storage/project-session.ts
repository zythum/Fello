import { basename, dirname, join } from "path";
import { omit } from "es-toolkit";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "fs";
import { createHash } from "crypto";
import type {
  ProjectInfo,
  SessionInfo,
  SessionModelState,
  SessionModeState,
  SessionThoughtLevelState,
  Feature,
} from "../../shared/schema";
import { ALL_FEATURES } from "../../shared/constants";
import type { InitializeResponse } from "@agentclientprotocol/sdk";

import { PROJECTS_DIR } from "./constant";

interface ProjectMeta {
  // === 仅内存状态 ===
  filename: string;

  // === 需要存的 ===
  id: string;
  title: string;
  cwd: string;
  created_at: number;
}

interface SessionMeta {
  // === 仅内存状态 ===
  filename: string;
  isStreaming: boolean;
  connectionStatus: "disconnected" | "connecting" | "connected";

  // === 需要存的 ===
  id: string;
  title: string;
  agent_id: string;
  resume_id: string;
  project_id: string;
  created_at: number;
  updated_at: number;
  mcp_servers?: string[];
  features?: Feature[];
  permission_mode?: "ask" | "allow-all";
  models?: SessionModelState | null;
  modes?: SessionModeState | null;
  thought_levels?: SessionThoughtLevelState | null;
  initialize_info?: InitializeResponse | null;
}

const projectMetaMemo = (() => {
  const memo = new Map<string, ProjectMeta>();
  const scopes = readdirSync(PROJECTS_DIR);
  for (const scope of scopes) {
    if (scope.startsWith(".")) {
      continue;
    }
    const filename = join(PROJECTS_DIR, scope, "project.json");
    try {
      const raw: ProjectMeta = JSON.parse(readFileSync(filename, "utf-8"));
      if (!raw) continue;
      const id = String(raw.id || "");
      const title = String(raw.title || "");
      const cwd = String(raw.cwd || "");
      const created_at = typeof raw.created_at === "number" ? raw.created_at : Date.now();
      if (!id || !title || !cwd) continue;
      const meta = {
        id,
        title,
        cwd,
        created_at,
        filename,
      };
      memo.set(id, meta);
    } catch (error) {
      console.error(`load project error ${filename}`, error);
    }
  }
  return memo;
})();

const sessionMetaMemo = (() => {
  const memo = new Map<string, SessionMeta>();

  for (const [_, project] of Array.from(projectMetaMemo)) {
    const dir = join(dirname(project.filename), "sessions");
    if (!existsSync(dir)) {
      continue;
    }
    try {
      const scopes = readdirSync(dir);
      for (const scope of scopes) {
        if (scope.startsWith(".")) {
          continue;
        }
        const filename = join(dir, scope, "session.json");
        try {
          const raw: SessionMeta = JSON.parse(readFileSync(filename, "utf-8"));
          if (!raw) continue;
          const id = String(raw.id);
          const title = String(raw.title || "");
          const agent_id = String(raw.agent_id);
          const resume_id = String(raw.resume_id);
          const project_id = String(raw.project_id);
          const created_at = typeof raw.created_at === "number" ? raw.created_at : Date.now();
          const updated_at = typeof raw.updated_at === "number" ? raw.updated_at : created_at;
          const mcp_servers = Array.isArray(raw.mcp_servers)
            ? raw.mcp_servers.filter((v) => typeof v === "string")
            : undefined;
          const permission_mode =
            raw.permission_mode === "allow-all" || raw.permission_mode === "ask"
              ? raw.permission_mode
              : "ask";
          const features: Feature[] = Array.isArray(raw.features)
            ? raw.features.filter((v): v is Feature => ALL_FEATURES.includes(v))
            : ALL_FEATURES;
          const models = raw.models ?? null;
          const modes = raw.modes ?? null;
          const initialize_info = raw.initialize_info ?? null;
          if (!id || !agent_id || !resume_id || !project_id) continue;

          const meta: SessionMeta = {
            filename,
            isStreaming: false,
            connectionStatus: "disconnected",
            id,
            title,
            agent_id,
            resume_id,
            project_id,
            created_at,
            updated_at,
            mcp_servers,
            features,
            permission_mode,
            models,
            modes,
            initialize_info,
          };
          memo.set(id, meta);
        } catch (error) {
          console.error(`[storage] load session error ${filename}`, error);
        }
      }
    } catch (error) {
      console.error(`[storage] load session error ${dir}`, error);
    }
  }
  return memo;
})();

function safeSessionDirName(sessionId: string): string {
  return sessionId.replace(/[\\/:<>"|?*]/g, "_");
}

function writeProjectMeta(meta: ProjectMeta) {
  mkdirSync(dirname(meta.filename), { recursive: true });
  writeFileSync(meta.filename, JSON.stringify(omit(meta, ["filename"]), null, 2));
  projectMetaMemo.set(meta.id, meta);
}

function writeSessionMeta(meta: SessionMeta) {
  mkdirSync(dirname(meta.filename), { recursive: true });
  writeFileSync(
    meta.filename,
    JSON.stringify(omit(meta, ["filename", "isStreaming", "connectionStatus"]), null, 2),
  );
  sessionMetaMemo.set(meta.id, meta);
}

export function listProjects(): ProjectInfo[] {
  return Array.from(projectMetaMemo.values())
    .sort((a, b) => b.created_at - a.created_at)
    .map((p) => ({
      id: p.id,
      title: p.title,
      cwd: p.cwd,
      createdAt: p.created_at,
    }));
}

export function addProject(cwd: string): ProjectInfo {
  cwd = cwd.trim();
  const projectId = createHash("sha1").update(cwd).digest("hex");
  const existing = projectMetaMemo.get(projectId);
  if (existing) {
    return {
      id: existing.id,
      title: existing.title,
      cwd: existing.cwd,
      createdAt: existing.created_at,
    };
  }
  const now = Date.now();
  const title = basename(cwd) || cwd;
  const filename = join(PROJECTS_DIR, projectId, "project.json");
  const meta: ProjectMeta = { filename, id: projectId, title, cwd, created_at: now };
  writeProjectMeta(meta);
  return {
    id: meta.id,
    title: meta.title,
    cwd: meta.cwd,
    createdAt: meta.created_at,
  };
}

export function updateProjectTitle(projectId: string, title: string) {
  const project = projectMetaMemo.get(projectId);
  if (!project) return;
  const nextTitle = title.trim();
  if (!nextTitle) return;
  project.title = nextTitle;
  writeProjectMeta(project);
}

export function deleteProject(projectId: string) {
  const projectMeta = projectMetaMemo.get(projectId);
  if (projectMeta) rmSync(dirname(projectMeta.filename), { recursive: true, force: true });
  projectMetaMemo.delete(projectId);
  // 清理属于该 project 的 session 缓存
  for (const [id, meta] of sessionMetaMemo.entries()) {
    if (meta.project_id === projectId) {
      sessionMetaMemo.delete(id);
    }
  }
}

export function getProject(projectId: string): ProjectInfo | null {
  const project = projectMetaMemo.get(projectId);
  if (!project) return null;
  return {
    id: project.id,
    title: project.title,
    cwd: project.cwd,
    createdAt: project.created_at,
  };
}

export function createSession(
  projectId: string,
  resumeId: string,
  agentId: string,
  updates?: Partial<{
    title: string;
    mcpServers: string[];
    features: Feature[];
    permissionMode: "ask" | "allow-all";
    models: SessionModelState | null;
    modes: SessionModeState | null;
    thoughtLevels: SessionThoughtLevelState | null;
    initializeInfo: InitializeResponse | null;
  }>,
): SessionInfo {
  const projectMeta = projectMetaMemo.get(projectId);
  if (!projectMeta) throw new Error("Project does not exist");
  const now = Date.now();
  const id = `${agentId}:${resumeId}`;
  const sessionMeta: SessionMeta = {
    filename: join(
      dirname(projectMeta.filename),
      "sessions",
      safeSessionDirName(id),
      "session.json",
    ),
    isStreaming: false,
    connectionStatus: "disconnected",
    id: id,
    title: updates?.title ?? "",
    agent_id: agentId,
    resume_id: resumeId,
    project_id: projectId,
    created_at: now,
    updated_at: now,
    mcp_servers: updates?.mcpServers ?? [],
    features: updates?.features ?? ALL_FEATURES,
    permission_mode: updates?.permissionMode ?? "ask",
    models: updates?.models ?? null,
    modes: updates?.modes ?? null,
    thought_levels: updates?.thoughtLevels ?? null,
    initialize_info: updates?.initializeInfo ?? null,
  };
  writeSessionMeta(sessionMeta);
  return getSession(id)!;
}

export function updateSession(
  sessionId: string,
  updates: Partial<{
    title: string;
    mcpServers: string[];
    features: Feature[];
    permissionMode: "ask" | "allow-all";
    models: SessionModelState | null;
    modes: SessionModeState | null;
    thoughtLevels: SessionThoughtLevelState | null;
    initializeInfo: InitializeResponse | null;
    isStreaming: boolean;
    connectionStatus: "disconnected" | "connecting" | "connected";
  }>,
  updateTime: boolean = true,
) {
  const meta = sessionMetaMemo.get(sessionId);
  if (!meta) return;
  if (updates.isStreaming !== undefined) meta.isStreaming = updates.isStreaming;
  if (updates.connectionStatus !== undefined) meta.connectionStatus = updates.connectionStatus;
  if (updates.title !== undefined) meta.title = updates.title;
  if (updates.mcpServers !== undefined) meta.mcp_servers = updates.mcpServers;
  if (updates.features !== undefined) meta.features = updates.features;
  if (updates.permissionMode !== undefined) meta.permission_mode = updates.permissionMode;
  if (updates.models !== undefined) meta.models = updates.models;
  if (updates.modes !== undefined) meta.modes = updates.modes;
  if (updates.thoughtLevels !== undefined) meta.thought_levels = updates.thoughtLevels;
  if (updates.initializeInfo !== undefined) meta.initialize_info = updates.initializeInfo;

  if (updateTime) {
    meta.updated_at = Date.now();
  }
  writeSessionMeta(meta);
}

export function deleteSession(sessionId: string) {
  const sessionMeta = sessionMetaMemo.get(sessionId);
  if (!sessionMeta) return;
  const dir = dirname(sessionMeta.filename);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  sessionMetaMemo.delete(sessionId);
}

export function listSessions(): SessionInfo[] {
  const sessionMetas = Array.from(sessionMetaMemo.values()).sort(
    (a, b) => b.updated_at - a.updated_at,
  );

  const result: SessionInfo[] = [];
  for (const meta of sessionMetas) {
    const project = projectMetaMemo.get(meta.project_id);
    if (project) {
      result.push({
        id: meta.id,
        title: meta.title,
        cwd: project.cwd,
        projectId: meta.project_id,
        projectTitle: project.title,
        agentId: meta.agent_id,
        resumeId: meta.resume_id,
        createdAt: meta.created_at,
        updatedAt: meta.updated_at,
        mcpServers: meta.mcp_servers ?? [],
        features: meta.features ?? ALL_FEATURES,
        permissionMode: meta.permission_mode ?? "ask",
        models: meta.models ?? null,
        modes: meta.modes ?? null,
        thoughtLevels: meta.thought_levels ?? null,
        initializeInfo: meta.initialize_info ?? null,
        isStreaming: meta.isStreaming,
        connectionStatus: meta.connectionStatus,
      });
    }
  }
  return result;
}

export function getSession(sessionId: string): SessionInfo | null {
  const meta = sessionMetaMemo.get(sessionId);
  if (!meta) return null;

  const project = projectMetaMemo.get(meta.project_id);
  if (!project) return null;

  return {
    id: meta.id,
    title: meta.title,
    cwd: project.cwd,
    projectId: meta.project_id,
    projectTitle: project.title,
    agentId: meta.agent_id,
    resumeId: meta.resume_id,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
    mcpServers: meta.mcp_servers ?? [],
    features: meta.features ?? ALL_FEATURES,
    permissionMode: meta.permission_mode ?? "ask",
    models: meta.models ?? null,
    modes: meta.modes ?? null,
    thoughtLevels: meta.thought_levels ?? null,
    initializeInfo: meta.initialize_info ?? null,
    isStreaming: meta.isStreaming,
    connectionStatus: meta.connectionStatus,
  };
}

export function touchSession(sessionId: string) {
  const meta = sessionMetaMemo.get(sessionId);
  if (!meta) return;
  meta.updated_at = Date.now();
  writeSessionMeta(meta);
}

export function sessionDir(sessionId: string) {
  const meta = sessionMetaMemo.get(sessionId);
  if (!meta) return null;
  return dirname(meta.filename);
}

export function sessionTerminalDir(sessionId: string) {
  const dir = sessionDir(sessionId);
  if (!dir) return null;
  return join(dir, "terminals");
}

export function sessionShareDir(sessionId: string) {
  const dir = sessionDir(sessionId);
  if (!dir) return null;
  return join(dir, "share");
}
