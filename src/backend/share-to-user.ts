import { randomUUID } from "crypto";
import { join, relative, resolve, isAbsolute, sep } from "path";
import { fileURLToPath } from "url";
import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import * as mimeTypes from "mime-types";
import {
  shareToUserRequestSchema,
  type ShareToUserRespond,
} from "../shared/zod/mcp-share-to-user-schema";
import type { SocketServer } from "./socket-server";
import type { BackendContext } from "./types";
import type { IlinkState } from "./ilink";

// ── Types ────────────────────────────────────────────────────────────

export interface ShareToUserContext {
  /** Working directory used for project-relative shares. */
  cwd: string;
  /** Directory that receives link/base64 shares. Omitted for project-only callers. */
  shareDir?: string;
  /** Reject link/base64 shares and only allow workspace-relative project paths. */
  projectOnly?: boolean;
}

export interface ShareToUserOptions {
  sessionId: string;
  /** Overrides session lookup for non-session callers such as workers. */
  context?: ShareToUserContext;
  type: "link" | "base64" | "project";
  uri?: string;
  data?: string;
  name: string;
  mimeType?: string;
}

export interface ShareToUserResult {
  name: string;
  sharePath?: string;
  projectPath?: string;
  mimeType?: string;
}

export interface ShareToUserModule {
  shareToUser: (options: ShareToUserOptions) => Promise<ShareToUserResult>;
  registerShareToUserRoute: (
    server: SocketServer,
    sessionId: string,
    context?: ShareToUserContext,
  ) => void;
  buildShareToUserMcpServer: (options: {
    projectDir: string;
    socketPath: string;
    projectOnly?: boolean;
  }) => {
    name: string;
    command: string;
    args: string[];
    env: { name: string; value: string }[];
  };
}

// ── Factory ──────────────────────────────────────────────────────────

function resolveMimeType(name: string, hint?: string): string | undefined {
  if (hint) return hint;
  return mimeTypes.lookup(name) || undefined;
}

export function createShareToUserModule(
  ctx: BackendContext,
  deps: { ilink: IlinkState },
): ShareToUserModule {
  const { storage } = ctx;

  async function shareToUser(options: ShareToUserOptions): Promise<ShareToUserResult> {
    const { sessionId, context, type, uri, data, name, mimeType } = options;
    const resolvedMimeType = resolveMimeType(name, mimeType);
    const session = context ? null : storage.getSession(sessionId);
    const cwd = context?.cwd ?? session?.cwd;

    // ── type='project': zero-copy, reference project file directly ──
    if (type === "project" && uri) {
      if (!cwd) throw new Error(`Session not found: ${sessionId}`);

      // Normalize `uri` to a project-relative path. Callers may pass an
      // absolute path or a file:// URI; the frontend /project/<id>/<path>
      // route and reveal/preview actions all expect a relative path.
      let projectPath = uri.startsWith("file://") ? fileURLToPath(uri) : uri;
      if (isAbsolute(projectPath)) {
        const rel = relative(cwd, projectPath);
        if (!rel.startsWith("..") && !isAbsolute(rel)) {
          projectPath = rel;
        }
      }
      if (context?.projectOnly) {
        const absolute = isAbsolute(projectPath) ? projectPath : resolve(cwd, projectPath);
        const rel = relative(cwd, absolute);
        if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
          throw new Error("Shared project paths must stay inside the assistant workspace.");
        }
        projectPath = rel;
      }

      const ilinkBridge = deps.ilink.getBridge();
      const ilinkActiveSessionId = deps.ilink.getActiveSessionId();
      if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
        const toUserId = ilinkBridge.userId;
        if (toUserId) {
          deps.ilink.appendMediaBuffer({
            filePath: join(cwd, projectPath),
            name,
            toUserId,
            mimeType: resolvedMimeType,
          });
        }
      }
      return { name, projectPath, mimeType: resolvedMimeType };
    }

    // ── type='link' or 'base64': copy to share directory ──
    if (context?.projectOnly) {
      throw new Error(
        "This share tool only accepts workspace-relative project files. Write the file into the workspace first and use type='project'.",
      );
    }
    const shareId = randomUUID();
    const shareDir = context?.shareDir ?? storage.sessionShareDir(sessionId);
    if (!shareDir) throw new Error(`Session not found: ${sessionId}`);

    const targetDir = join(shareDir, shareId);
    const targetPath = join(targetDir, name);

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    let buffer: Buffer;
    if (type === "link" && uri) {
      try {
        if (uri.startsWith("https://") || uri.startsWith("http://")) {
          const response = await fetch(uri);
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          buffer = Buffer.from(await response.arrayBuffer());
        } else {
          const sourcePath = uri.startsWith("file://") ? fileURLToPath(uri) : uri;
          buffer = await readFile(sourcePath);
        }
      } catch (err) {
        throw new Error(
          `Failed to read file from "${uri}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (type === "base64" && data) {
      buffer = Buffer.from(data, "base64");
    } else {
      throw new Error(
        `Invalid shareToUser request: type="${type}" but no ${type === "link" ? "uri" : "data"} provided`,
      );
    }

    await writeFile(targetPath, buffer);

    // Queue for iLink forwarding
    const ilinkBridge = deps.ilink.getBridge();
    const ilinkActiveSessionId = deps.ilink.getActiveSessionId();
    if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
      const toUserId = ilinkBridge.userId;
      if (toUserId) {
        deps.ilink.appendMediaBuffer({
          filePath: targetPath,
          name,
          toUserId,
          mimeType: resolvedMimeType,
        });
      }
    }

    return { name, sharePath: `${shareId}/${name}`, mimeType: resolvedMimeType };
  }

  function registerShareToUserRoute(
    server: SocketServer,
    sessionId: string,
    context?: ShareToUserContext,
  ) {
    server.registry("share-to-user/share", async (payload) => {
      const request = shareToUserRequestSchema.parse(payload);
      const result: ShareToUserRespond = await shareToUser({ sessionId, context, ...request });
      return result;
    });
  }

  function buildShareToUserMcpServer(options: {
    projectDir: string;
    socketPath: string;
    projectOnly?: boolean;
  }) {
    return {
      name: "share-to-user",
      command: process.execPath,
      args: [
        join(process.scriptsPath, "mcp-share-to-user/server.mjs"),
        "--project-dir",
        options.projectDir,
        "--socket-path",
        options.socketPath,
        ...(options.projectOnly ? ["--project-only"] : []),
      ],
      env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
    };
  }

  return { shareToUser, registerShareToUserRoute, buildShareToUserMcpServer };
}
