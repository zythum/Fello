import { z } from "zod";

// ── MCP Server ───────────────────────────────────────────────────────

export const SKILLS_SERVER_DESCRIPTION = "MCP server that exposes Agent Skills via tools.";

// ── list_skills ──────────────────────────────────────────────────────

/**
 * list_skills 工具的模型可见说明。初始 catalog 由主进程在启动参数中给出，
 * 故以函数形式生成，避免说明文案与注入逻辑分散在两处。
 */
export function buildListSkillsToolDescription(catalog: SkillCatalog = []): string {
  const initialCatalog =
    catalog.length <= 0
      ? ""
      : `\nInitial Catalog:\n\`\`\`json${JSON.stringify(catalog, null, "  ")}\n\`\`\``;

  return (
    "Get available **Agent Skills** Catalog with their id, name and description. " +
    "If the user message contains a skill mention in the form `@skill:xxxxx`, call this tool to find the matching skill before proceeding, then use the returned skill id with `activate_skill`." +
    initialCatalog
  );
}

/**
 * Schema for the skill catalog response returned by list_skills.
 */
export const skillCatalogSchema = z.array(
  z.object({
    id: z.string().describe("Unique identifier for the skill, e.g. 'user://agents/skill-name'."),
    name: z.string().describe("Human-readable name of the skill, e.g. 'skill-name'."),
    description: z.string().describe("Short summary of what the skill does and when to use it."),
  }),
);

export type SkillCatalog = z.infer<typeof skillCatalogSchema>;

// ── activate_skill ───────────────────────────────────────────────────

export const ACTIVATE_SKILL_TOOL_DESCRIPTION =
  "Activate a **Agent Skill** by id, loading its full instructions and listing supporting files.";

/**
 * Request schema for fetching a single skill's detail (activate_skill).
 */
export const skillDetailRequestSchema = z.object({
  id: z.string().describe("The id of the skill to activate (as returned by list_skills)."),
});

export type SkillDetailRequest = z.infer<typeof skillDetailRequestSchema>;

/**
 * Schema for the detailed skill response returned by activate_skill.
 */
export const skillDetailSchema = z.object({
  id: z.string().describe("Unique identifier for the skill."),
  name: z.string().describe("Human-readable name of the skill."),
  description: z.string().describe("Full description of the skill's purpose and usage."),
  instructions: z
    .string()
    .describe("System prompt / instructions loaded when the skill is activated."),
  root_path: z.string().describe("Absolute path to the skill's root directory on disk."),
  supporting_files: z
    .array(z.string())
    .describe("List of absolute file paths to supporting files (docs, templates, etc.)."),
});

export type SkillDetail = z.infer<typeof skillDetailSchema>;
