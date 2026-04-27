import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import {
  getSkillsCatalog,
  getSkillSystemPathFromId,
  parseSkillFrontmatter,
  listSkillFiles,
  SKILL_FILENAME,
} from "../../backend/skills";

const server = new McpServer({
  name: "Agent Skills",
  version: "1.0.0",
  description: "MCP server that exposes Agent Skills via tools.",
});

server.registerTool(
  "list_skills",
  {
    description: `List all available agent skills with their names and descriptions.

Scans project-level and user-level skill directories for SKILL.md files.
Returns a JSON array of objects with name, description, and path for each skill.`,
    inputSchema: z.object({
      project_root: z
        .string()
        .optional()
        .describe("Optional list of project root directory to scan for project-level skills."),
    }),
  },
  async ({ project_root }) => {
    const catalog = getSkillsCatalog(project_root);
    const results = [];

    for (const name of Object.keys(catalog).sort()) {
      const info = catalog[name];
      results.push({
        name: info.name,
        description: info.description,
        id: info.id,
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
                message: "No skills found. Create SKILL.md files in ~/.agents/skills/<skill-name>/",
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
      "Activate a skill by id, loading its full instructions and listing supporting files.",
    inputSchema: z.object({
      id: z.string().describe("The id of the skill to activate (as returned by list_skills)."),
      project_root: z
        .string()
        .optional()
        .describe("Optional list of project root directory to scan for project-level skills."),
    }),
  },
  async ({ id, project_root }) => {
    const catalog = getSkillsCatalog(project_root);

    if (!catalog[id]) {
      const available = Object.keys(catalog).sort();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: `Skill '${id}' not found.`,
                available_skills: available,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const info = catalog[id];
    let body = "";
    try {
      const skillDir = getSkillSystemPathFromId(info.id, project_root);
      if (!skillDir) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Failed to read skill '${id}'` }, null, 2),
            },
          ],
        };
      }
      const skillFile = path.join(skillDir, SKILL_FILENAME);
      const text = fs.readFileSync(skillFile, "utf8");
      const parsed = parseSkillFrontmatter(text);
      body = parsed.body;
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to read skill '${id}': ${e.message}` }, null, 2),
          },
        ],
      };
    }

    const supporting_files = listSkillFiles(info.id, project_root);

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
      id: z.string().describe("The id of the skill that owns the file."),
      file_path: z
        .string()
        .describe("Path to the file relative to the skill directory (e.g. 'scripts/extract.py')."),
      project_root: z.string().optional(),
    }),
  },
  async ({ id, file_path, project_root }) => {
    const skillDir = getSkillSystemPathFromId(id, project_root);
    if (!skillDir) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to read skill '${id}'` }, null, 2),
          },
        ],
      };
    }

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
      const available = listSkillFiles(id, project_root);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: `File '${file_path}' not found in skill '${id}'.`,
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
                id,
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
