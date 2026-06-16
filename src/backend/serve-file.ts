import { stat, readFile } from "fs/promises";
import { resolve, relative, isAbsolute } from "path";
import * as mimeTypes from "mime-types";

/**
 * Result of serving a project file.
 */
export interface ProjectFileResult {
  status: number;
  body: Uint8Array | string;
  mimeType: string;
  error?: string;
}

/**
 * Safely resolve and read a file from a directory.
 * Prevents directory traversal — any path escaping the root is rejected.
 *
 * This function is shared by:
 *   - Electron's custom `web://` protocol handler (protocol.handle)
 *   - WebUI's HTTP server route (`/project/:projectId/*`)
 */
export async function serveFile(filename: string, cwd: string): Promise<ProjectFileResult> {
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

  // 4. Read and return the file
  try {
    const content = await readFile(fullPath);
    const mimeType = mimeTypes.lookup(fullPath) || "application/octet-stream";
    return {
      status: 200,
      body: new Uint8Array(content),
      mimeType,
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
