import { join } from "path";
import type { SocketServer } from "../socket-server";
import {
  grepRequestSchema,
  grepRespondSchema,
  fileOutlineRequestSchema,
  fileOutlineRespondSchema,
  globRequestSchema,
  globRespondSchema,
} from "../../shared/zod/mcp-search-schema";
import { fileOutline } from "./file-outline";
import { grep } from "./ripgrep";
import { glob } from "./glob";
import type { BackendContext } from "../types";

export type { GrepOptions } from "./ripgrep";
export type { GlobOptions } from "./glob";
export type { FileOutlineOptions } from "./file-outline";
export { grep, glob, fileOutline };

// ── Types ────────────────────────────────────────────────────────────

export interface SearchModule {
  registerSearchRoute: (server: SocketServer, projectDir: string) => void;
  buildSearchMcpServer: (options: { projectDir: string; socketPath: string }) => {
    name: string;
    command: string;
    args: string[];
    env: { name: string; value: string }[];
  };
}

// ── Factory ──────────────────────────────────────────────────────────

export function createSearchModule(_ctx: BackendContext): SearchModule {
  return { registerSearchRoute, buildSearchMcpServer };
}

// ── Implementation ───────────────────────────────────────────────────

function registerSearchRoute(server: SocketServer, projectDir: string) {
  server.registry("search/grep", async (payload: unknown) => {
    const params = grepRequestSchema.parse(payload);
    const result = await grep({ projectDir, ...params });
    return grepRespondSchema.parse(result);
  });

  server.registry("search/file_outline", async (payload: unknown) => {
    const params = fileOutlineRequestSchema.parse(payload);
    const result = await fileOutline({ projectDir, ...params });
    return fileOutlineRespondSchema.parse(result);
  });

  server.registry("search/glob", async (payload: unknown) => {
    const params = globRequestSchema.parse(payload);
    const result = await glob({ projectDir, ...params });
    return globRespondSchema.parse(result);
  });
}

function buildSearchMcpServer(options: { projectDir: string; socketPath: string }): {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
} {
  return {
    name: "search",
    command: process.execPath,
    args: [
      join(process.scriptsPath, "mcp-search/server.mjs"),
      "--project-dir",
      options.projectDir,
      "--socket-path",
      options.socketPath,
    ],
    env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  };
}
