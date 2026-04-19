import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { getSkillsCatalog, parseSkillFrontmatter, listSkillFiles } from "./skills";

const server = new McpServer({
  name: "Agent Skills",
  version: "1.0.0",
  description: "MCP server that exposes Agent Skills via tools.",
});

server.registerTool(
  "list_skills",
  {
    description:
      "List all available agent skills with their names and descriptions.\n\nScans project-level and user-level skill directories for SKILL.md files.\nReturns a JSON array of objects with name, description, and path for each skill.",
    inputSchema: z.object({
      project_roots: z
        .array(z.string())
        .optional()
        .describe("Optional list of project root directories to scan for project-level skills."),
    }),
  },
  async ({ project_roots }) => {
    const catalog = getSkillsCatalog(project_roots);
    const results = [];

    for (const name of Object.keys(catalog).sort()) {
      const info = catalog[name];
      results.push({
        name: info.name,
        description: info.description,
        path: info.path,
      });
    }

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                skills: [],
                message:
                  "No skills found. Create SKILL.md files in ~/.agents/skills/<skill-name>/ or .agents/skills/<skill-name>/ in your project.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    return {
      content: [
        { type: "text", text: JSON.stringify({ skills: results, count: results.length }, null, 2) },
      ],
    };
  },
);

server.registerTool(
  "activate_skill",
  {
    description:
      "Activate a skill by name, loading its full instructions and listing supporting files.",
    inputSchema: z.object({
      name: z.string().describe("The name of the skill to activate (as returned by list_skills)."),
      project_roots: z.array(z.string()).optional(),
    }),
  },
  async ({ name, project_roots }) => {
    const catalog = getSkillsCatalog(project_roots);

    if (!catalog[name]) {
      const available = Object.keys(catalog).sort();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: `Skill '${name}' not found.`,
                available_skills: available,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const info = catalog[name];
    let body = "";
    try {
      const parsed = parseSkillFrontmatter(info.path);
      body = parsed.body;
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: `Failed to read skill '${name}': ${e.message}` },
              null,
              2,
            ),
          },
        ],
      };
    }

    const supporting_files = listSkillFiles(info.base_dir);

    const result: any = {
      name: info.name,
      description: info.description,
      instructions: body,
    };

    if (supporting_files.length > 0) {
      result.supporting_files = supporting_files;
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  "read_skill_file",
  {
    description: "Read a supporting file from a skill's directory.",
    inputSchema: z.object({
      skill_name: z.string().describe("The name of the skill that owns the file."),
      file_path: z
        .string()
        .describe("Path to the file relative to the skill directory (e.g. 'scripts/extract.py')."),
      project_roots: z.array(z.string()).optional(),
    }),
  },
  async ({ skill_name, file_path, project_roots }) => {
    const catalog = getSkillsCatalog(project_roots);

    if (!catalog[skill_name]) {
      const available = Object.keys(catalog).sort();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: `Skill '${skill_name}' not found.`,
                available_skills: available,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const info = catalog[skill_name];
    const skillDir = path.resolve(info.base_dir);

    let requested;
    try {
      requested = path.resolve(skillDir, file_path);
      if (!requested.startsWith(skillDir + path.sep) && requested !== skillDir) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "Access denied: path traversal outside skill directory is not allowed.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    } catch (e: any) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: `Invalid path: ${e.message}` }, null, 2) },
        ],
      };
    }

    if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) {
      const available = listSkillFiles(info.base_dir);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: `File '${file_path}' not found in skill '${skill_name}'.`,
                available_files: available,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    try {
      const content = fs.readFileSync(requested, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                skill_name,
                file_path,
                content,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to read file: ${e.message}` }, null, 2),
          },
        ],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
