import { randomUUID } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { storageOps } from "./storage";
import {
  shareToUserRequestSchema,
  type ShareToUserRespond,
} from "../shared/zod/mcp-share-to-user-schema";
import type { SocketServer } from "./socket-server";
import {
  getIlinkBridge,
  getIlinkActiveSessionId,
  appendIlinkImageBuffer,
} from "./ilink-state";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ────────────────────────────────────────────────────────────

export interface ShareToUserOptions {
  sessionId: string;
  type: "link" | "base64";
  uri?: string;
  data?: string;
  name: string;
  mimeType?: string;
}

export interface ShareToUserResult {
  /** 相对 share 目录的路径，格式为 `<shareId>/<filename>` */
  name: string;
  sharePath: string;
  mimeType?: string;
}

// ── 支持的图片 MIME 类型 ────────────────────────────────────────────

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/avif",
]);

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

function resolveImageMimeType(name: string, hint?: string): string | undefined {
  if (hint && IMAGE_MIME_TYPES.has(hint)) return hint;
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? EXTENSION_TO_MIME[ext] : undefined;
}

// ── Core ─────────────────────────────────────────────────────────────

/**
 * 处理 shareToUser 请求：
 * 1. 读取文件（link 类型）或解码 base64（base64 类型）
 * 2. 存入 ~/.fello/projects/<projectId>/sessions/<sessionId>/share/<shareId>/<name>
 * 3. 返回 { ok: true, sharePath, name, mimeType }
 */
export async function shareToUser(options: ShareToUserOptions): Promise<ShareToUserResult> {
  const { sessionId, type, uri, data, name, mimeType } = options;
  const shareId = randomUUID();

  // 获取 share 目录
  const shareDir = storageOps.sessionShareDir(sessionId);
  if (!shareDir) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // 解析并校验图片 MIME 类型
  const resolvedMimeType = resolveImageMimeType(name, mimeType);

  // 目标目录: <shareDir>/<shareId>/
  const targetDir = join(shareDir, shareId);
  const targetPath = join(targetDir, name);

  // 创建目录
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // 读取/生成图片 buffer
  let buffer: Buffer;
  if (type === "link" && uri) {
    try {
      if (uri.startsWith("https://") || uri.startsWith("http://")) {
        // 远程 URL → fetch 下载
        const response = await fetch(uri);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        buffer = Buffer.from(await response.arrayBuffer());
      } else {
        // 本地文件 → file:// URI 或绝对路径
        const sourcePath = uri.startsWith("file://") ? fileURLToPath(uri) : uri;
        buffer = await readFile(sourcePath);
      }
    } catch (err) {
      throw new Error(
        `Failed to read image from "${uri}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (type === "base64" && data) {
    // base64 类型：直接解码
    buffer = Buffer.from(data, "base64");
  } else {
    throw new Error(
      `Invalid shareToUser request: type="${type}" but no ${type === "link" ? "uri" : "data"} provided`,
    );
  }

  // 写入文件
  await writeFile(targetPath, buffer);

  // ── Forward to WeChat via iLink ──
  const ilinkBridge = getIlinkBridge();
  const ilinkActiveSessionId = getIlinkActiveSessionId();
  if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
    const toUserId = ilinkBridge.userId;
    if (toUserId) {
      appendIlinkImageBuffer({ filePath: targetPath, name, toUserId });
    }
  }

  // 返回结果
  return {
    name,
    sharePath: `${shareId}/${name}`,
    mimeType: resolvedMimeType,
  };
}

// ── Route Registration ──────────────────────────────────────────────

/**
 * 注册 share-to-user 路由到 socket server。
 */
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

/**
 * 构建内置 share-to-user MCP server 配置。
 */
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
      join(__dirname, "../scripts/mcp-share-to-user/server.mjs"),
      "--project-dir",
      options.projectDir,
      "--socket-path",
      options.socketPath,
    ],
    env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  };
}
