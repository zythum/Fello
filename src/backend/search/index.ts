import { join } from "path";
import type { SocketServer } from "../socket-server";
import {
  searchRequestSchema,
  searchRespondSchema,
  rgRequestSchema,
  rgRespondSchema,
  fileOutlineRequestSchema,
  fileOutlineRespondSchema,
} from "../../shared/zod/mcp-search-schema";
import { fileOutline } from "./file-outline";
import { search, rg } from "./ripgrep";
import type { BackendContext } from "../types";

export type { SearchOptions, RgOptions } from "./ripgrep";
export type { FileOutlineOptions } from "./file-outline";
export { search, rg, fileOutline };

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
  server.registry("search/search", async (payload: unknown) => {
    const params = searchRequestSchema.parse(payload);
    const result = await search({ projectDir, ...params });
    return searchRespondSchema.parse(result);
  });

  server.registry("search/rg", async (payload: unknown) => {
    const params = rgRequestSchema.parse(payload);
    const result = await rg({ projectDir, ...params });
    return rgRespondSchema.parse(result);
  });

  server.registry("search/file_outline", async (payload: unknown) => {
    const params = fileOutlineRequestSchema.parse(payload);
    const result = await fileOutline({ projectDir, ...params });
    return fileOutlineRespondSchema.parse(result);
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
