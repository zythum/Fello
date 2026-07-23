import type { McpServer } from "@agentclientprotocol/sdk";
import type { BackendContext } from "../types";
import type { Feature, ProjectInfo } from "../../shared/schema";
import { ALL_FEATURES } from "../../shared/constants";
import type { SkillsModule } from "../skills";
import type { AskUserModule } from "../ask-user";
import type { ShareToUserModule } from "../share-to-user";
import type { SearchModule } from "../search";
import type { MemoryModule } from "../memory";
import type { ImageGenerationModule } from "../image-generation";

export interface McpConfigDeps {
  skills: SkillsModule;
  askUser: AskUserModule;
  shareToUser: ShareToUserModule;
  search: SearchModule;
  memory: MemoryModule;
  imageGeneration: ImageGenerationModule;
}

export function buildMcpServersConfig(
  sessionMcpIds: string[],
  options: { project: ProjectInfo; socketPath: string | null; features?: Feature[] },
  ctx: BackendContext,
  deps: McpConfigDeps,
): McpServer[] {
  const { project, socketPath, features = ALL_FEATURES } = options;
  const servers: McpServer[] = [];

  if (socketPath && features.includes("skills")) {
    servers.push(deps.skills.buildSkillsMcpServer({ projectDir: project.cwd, socketPath }));
  }

  if (socketPath && features.includes("ask_user")) {
    servers.push(deps.askUser.buildAskUserMcpServer({ projectDir: project.cwd, socketPath }));
  }

  if (socketPath && features.includes("share_to_user")) {
    servers.push(
      deps.shareToUser.buildShareToUserMcpServer({ projectDir: project.cwd, socketPath }),
    );
  }

  if (socketPath && features.includes("search")) {
    servers.push(deps.search.buildSearchMcpServer({ projectDir: project.cwd, socketPath }));
  }

  if (socketPath && features.includes("memory")) {
    servers.push(deps.memory.buildMemoryMcpServer({ projectDir: project.cwd, socketPath }));
  }

  if (socketPath && features.includes("image_generation")) {
    servers.push(
      deps.imageGeneration.buildImageGenerationMcpServer({ projectDir: project.cwd, socketPath }),
    );
  }

  const globalSettings = ctx.storage.getSettings();
  for (const id of sessionMcpIds) {
    const config = globalSettings.mcpServers?.find((s) => s.id === id);
    if (config) {
      if (config.type === "stdio") {
        servers.push({
          name: id,
          command: config.command,
          args: config.args,
          env: Object.entries(config.env).map(([k, v]) => ({ name: k, value: v })),
        });
      } else if (config.type === "http") {
        servers.push({
          type: "http",
          name: id,
          url: config.url,
          headers: Object.entries(config.headers).map(([k, v]) => ({ name: k, value: v })),
        });
      } else if (config.type === "sse") {
        servers.push({
          type: "sse",
          name: id,
          url: config.url,
          headers: Object.entries(config.headers).map(([k, v]) => ({ name: k, value: v })),
        });
      }
    }
  }
  return servers;
}
