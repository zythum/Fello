import { randomUUID } from "crypto";
import { join } from "path";
import { fileURLToPath } from "url";
import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import * as mimeTypes from "mime-types";
import { storageOps } from "./storage";
import {
  shareToUserRequestSchema,
  type ShareToUserRespond,
} from "../shared/zod/mcp-share-to-user-schema";
import type { SocketServer } from "./socket-server";
import { getIlinkBridge, getIlinkActiveSessionId, appendIlinkMediaBuffer } from "./ilink-state";

// ── Types ────────────────────────────────────────────────────────────

export interface ShareToUserOptions {
  sessionId: string;
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

// ── MIME helpers ─────────────────────────────────────────────────────

function resolveMimeType(name: string, hint?: string): string | undefined {
  if (hint) return hint;
  return mimeTypes.lookup(name) || undefined;
}

// ── Core ─────────────────────────────────────────────────────────────

/**
 * 处理 shareToUser 请求：
 * - type='project': 零拷贝，直接引用项目内文件
 * - type='link'/'base64': 读取/解码后存入 share 目录
 */
export async function shareToUser(options: ShareToUserOptions): Promise<ShareToUserResult> {
  const { sessionId, type, uri, data, name, mimeType } = options;

  const resolvedMimeType = resolveMimeType(name, mimeType);

  // ── type='project': zero-copy, reference project file directly ──
  if (type === "project" && uri) {
    // Queue for iLink forwarding
    const ilinkBridge = getIlinkBridge();
    const ilinkActiveSessionId = getIlinkActiveSessionId();
    if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
      const toUserId = ilinkBridge.userId;
      if (toUserId) {
        const session = storageOps.getSession(sessionId);
        if (session) {
          appendIlinkMediaBuffer({
            filePath: join(session.cwd, uri),
            name,
            toUserId,
            mimeType: resolvedMimeType,
          });
        }
      }
    }

    return {
      name,
      projectPath: uri,
      mimeType: resolvedMimeType,
    };
  }

  // ── type='link' or 'base64': copy to share directory ──
  const shareId = randomUUID();
  const shareDir = storageOps.sessionShareDir(sessionId);
  if (!shareDir) {
    throw new Error(`Session not found: ${sessionId}`);
  }

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
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
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
  const ilinkBridge = getIlinkBridge();
  const ilinkActiveSessionId = getIlinkActiveSessionId();
  if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
    const toUserId = ilinkBridge.userId;
    if (toUserId) {
      appendIlinkMediaBuffer({ filePath: targetPath, name, toUserId, mimeType: resolvedMimeType });
    }
  }

  return {
    name,
    sharePath: `${shareId}/${name}`,
    mimeType: resolvedMimeType,
  };
}

// ── Route Registration ──────────────────────────────────────────────

export function registerShareToUserRoute(server: SocketServer, sessionId: string) {
  server.registry("share-to-user/share", async (payload) => {
    const request = shareToUserRequestSchema.parse(payload);
    const result: ShareToUserRespond = await shareToUser({
      sessionId,
      ...request,
    });
    return result;
  });
}

// ── MCP Server Config ───────────────────────────────────────────────

export function buildShareToUserMcpServer(options: { projectDir: string; socketPath: string }): {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
} {
  return {
    name: "share-to-user",
    command: process.execPath,
    args: [
      join(process.scriptsPath, "mcp-share-to-user/server.mjs"),
      "--project-dir",
      options.projectDir,
      "--socket-path",
      options.socketPath,
    ],
    env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  };
}
