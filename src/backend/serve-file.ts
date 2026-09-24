import { createReadStream } from "fs";
import { stat, readFile } from "fs/promises";
import { resolve, relative, isAbsolute } from "path";
import * as mimeTypes from "mime-types";
import type { Readable } from "stream";

/**
 * Result of serving a project file.
 *
 * 成功时 `body` 与 `stream` 二选一：
 * - 整份内容（含错误页）走 `body`
 * - 命中 `Range` 的分片走 `stream`（音视频拖动进度条 / 长视频不必整份读进内存）
 */
export interface ServeFileResult {
  status: number;
  body?: Uint8Array | string;
  stream?: Readable;
  mimeType: string;
  /** 需要原样透传到响应上的头（`Accept-Ranges` / `Content-Range` / `Content-Length`） */
  headers?: Record<string, string>;
  error?: string;
}

export interface ServeFileOptions {
  /** 请求的 `Range` 头原文（如 `bytes=0-1023`）；缺省或不可解析时回整份内容 */
  range?: string | null;
}

/** 只支持单段 Range：`bytes=start-end` / `bytes=start-` / `bytes=-suffix`。 */
const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

/**
 * 解析单段 Range。
 *
 * 返回 `null` 表示「忽略该头、回整份内容」（语法不合法 / 多段 Range —— 按 RFC 7233
 * 就是这么处理的）；返回 `"unsatisfiable"` 表示起点越界，调用方回 416。
 */
function parseRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const raw = header?.trim();
  if (!raw) return null;

  const match = RANGE_RE.exec(raw);
  if (!match) return null;

  const [, startRaw = "", endRaw = ""] = match;
  if (!startRaw && !endRaw) return null;

  let start: number;
  let end: number;

  if (!startRaw) {
    // `bytes=-N`：最后 N 字节
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw ? Math.min(Number(endRaw), size - 1) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= size) return "unsatisfiable";
  if (end < start) return null;

  return { start, end };
}

/**
 * Safely resolve and read a file from a directory.
 * Prevents directory traversal — any path escaping the root is rejected.
 *
 * Shared by:
 *   - Electron's custom `fello://` protocol handler
 *   - WebUI/file-routes HTTP handler
 */
export async function serveFile(
  filename: string,
  cwd: string,
  options: ServeFileOptions = {},
): Promise<ServeFileResult> {
  // 1. Resolve the path relative to the root
  const safeCwd = resolve(cwd);
  const fullPath = resolve(safeCwd, filename || "");

  // 2. Prevent directory traversal
  const rel = relative(safeCwd, fullPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      status: 403,
      body: "Forbidden: path traversal detected",
      mimeType: "text/plain",
      error: `Path traversal: ${filename} is outside root`,
    };
  }

  // 3. Check the file exists and is a regular file
  let fileStat;
  try {
    fileStat = await stat(fullPath);
  } catch {
    return {
      status: 404,
      body: "Not Found",
      mimeType: "text/plain",
      error: `File not found: ${filename}`,
    };
  }

  if (!fileStat.isFile()) {
    // If it's a directory, try serving index.html inside it
    const indexPath = resolve(fullPath, "index.html");
    try {
      const indexStat = await stat(indexPath);
      if (indexStat.isFile()) {
        const content = await readFile(indexPath);
        return {
          status: 200,
          body: new Uint8Array(content),
          mimeType: mimeTypes.lookup(indexPath) || "text/html",
        };
      }
    } catch {
      // index.html not found either
    }

    return {
      status: 404,
      body: "Not Found",
      mimeType: "text/plain",
      error: `Not a file: ${filename}`,
    };
  }

  // 4. Read and return the file（或按 Range 回分片）
  const mimeType = mimeTypes.lookup(fullPath) || "application/octet-stream";
  const size = fileStat.size;
  // 空文件不做 Range：否则每个探测请求都会吃一个 416
  const range = size > 0 ? parseRange(options.range, size) : null;

  if (range === "unsatisfiable") {
    return {
      status: 416,
      body: "",
      mimeType,
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` },
      error: `Range not satisfiable: ${options.range} (size ${size})`,
    };
  }

  if (range) {
    return {
      status: 206,
      stream: createReadStream(fullPath, { start: range.start, end: range.end }),
      mimeType,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      },
    };
  }

  try {
    const content = await readFile(fullPath);
    return {
      status: 200,
      body: new Uint8Array(content),
      mimeType,
      // 声明支持 Range：媒体元素据此决定能否拖动进度条
      headers: { "Accept-Ranges": "bytes", "Content-Length": String(size) },
    };
  } catch (err) {
    return {
      status: 500,
      body: "Internal Server Error",
      mimeType: "text/plain",
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
