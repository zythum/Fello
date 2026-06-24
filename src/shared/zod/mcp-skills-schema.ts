import { z } from "zod";

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
