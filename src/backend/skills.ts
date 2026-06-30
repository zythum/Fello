import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import type { SkillInfo } from "../shared/schema";
import { TEMP_DIR } from "./storage";
import { toPosixPath } from "./utils";
import type { BackendContext } from "./types";

export const SKILL_FILENAME = "SKILL.md";
const SKILLS_SH_API_BASE = "https://skills.sh/api";

const scopes: { scopeName: SkillInfo["scope"]; scopePath: string }[] = [
  { scopeName: "fello", scopePath: ".fello/skills" },
  { scopeName: "agents", scopePath: ".agents/skills" },
  { scopeName: "claude", scopePath: ".claude/skills" },
];

// ── Module interface ─────────────────────────────────────────────────

export interface SkillsModule {
  getSkillsCatalog: (options?: { projectRoot?: string; all?: boolean }) => SkillInfo[];
  getSkillSystemPathFromId: (id: string, options?: { projectRoot?: string }) => string | null;
  searchSkills: (
    query: string,
  ) => Promise<{ id: string; skillId: string; name: string; installs: number; source: string }[]>;
  installSkill: (source: string, slug: string) => Promise<void>;
  listSkillFiles: (id: string, options?: { projectRoot?: string }) => string[];
  registerSkillsRoute: (
    server: {
      registry: (path: string, handler: (payload: unknown) => unknown | Promise<unknown>) => void;
    },
    projectRoot: string,
  ) => void;
  buildSkillsMcpServer: (options: { projectDir: string; socketPath: string }) => {
    name: string;
    command: string;
    args: string[];
    env: { name: string; value: string }[];
  };
}

// ── Factory ──────────────────────────────────────────────────────────

export function createSkillsModule(_ctx: BackendContext): SkillsModule {
  return {
    getSkillsCatalog,
    getSkillSystemPathFromId,
    searchSkills,
    installSkill,
    listSkillFiles,
    registerSkillsRoute,
    buildSkillsMcpServer,
  };
}

// ── Implementation (internal) ────────────────────────────────────────

function toSkillId(
  level: SkillInfo["level"],
  scope: SkillInfo["scope"],
  relativePath: string,
): string {
  return `${level}://${scope}/${toPosixPath(relativePath)}`;
}

function parseSkillId(id: string): {
  level: SkillInfo["level"];
  scope: SkillInfo["scope"];
  relativePath: string;
} | null {
  const match = id.match(/^(user|project):\/\/(fello|agents|claude)\/(.+)$/);
  if (!match) return null;
  const level = match[1] as SkillInfo["level"];
  const scope = match[2] as SkillInfo["scope"];
  const relativePath = path.join("/", match[3]).slice(1);
  if (!relativePath) return null;
  return { level, scope, relativePath };
}

export function getSkillSystemPathFromId(
  id: string,
  options: { projectRoot?: string } = {},
): string | null {
  let { projectRoot } = options;
  const parsed = parseSkillId(id);
  if (!parsed) return null;
  const { level, scope, relativePath } = parsed;
  if (level === "user") projectRoot = os.homedir();
  if (!projectRoot || !path.isAbsolute(projectRoot)) return null;
  const scopePath = scopes.find((item) => item.scopeName === scope)?.scopePath;
  if (!scopePath) return null;
  return path.join(projectRoot, scopePath, relativePath);
}

function parseSkillFrontmatter(text: string): {
  metadata: Record<string, string>;
  body: string;
} {
  try {
    if (!text.startsWith("---")) return { metadata: {}, body: text.trim() };
    const endIndex = text.indexOf("\n---", 3);
    if (endIndex === -1) return { metadata: {}, body: text.trim() };
    const frontmatterRaw = text.substring(3, endIndex).trim();
    const body = text.substring(endIndex + 4).trim();

    const metadata: Record<string, string> = {};
    const lines = frontmatterRaw.split("\n");
    let currentKey = "";
    let currentValue = "";

    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match) {
        if (currentKey) metadata[currentKey] = currentValue.trim();
        currentKey = match[1];
        currentValue = match[2];
      } else if (currentKey) {
        currentValue += " " + line.trim();
      }
    }
    if (currentKey) metadata[currentKey] = currentValue.trim();
    return { metadata, body };
  } catch {
    return { metadata: {}, body: "" };
  }
}

function listSkillFiles(id: string, options: { projectRoot?: string } = {}): string[] {
  const { projectRoot } = options;
  const dirPath = getSkillSystemPathFromId(id, { projectRoot });
  if (!dirPath) return [];
  const skillDir = dirPath;
  const files: string[] = [];
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) return files;

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(skillDir, fullPath);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (relativePath === SKILL_FILENAME) continue;
        files.push(relativePath);
      }
    }
  }

  walk(skillDir);
  return files.sort();
}

function getSkillsCatalog(options: { projectRoot?: string; all?: boolean } = {}): SkillInfo[] {
  const { projectRoot, all = false } = options;
  const roots: { level: SkillInfo["level"]; rootPath: string }[] = [];
  if (projectRoot) roots.push({ level: "project", rootPath: projectRoot });
  roots.push({ level: "user", rootPath: os.homedir() });

  const skillScene = new Set<string>();
  const skills: SkillInfo[] = [];

  for (const { level, rootPath } of roots) {
    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) continue;
    for (const { scopeName: scope, scopePath } of scopes) {
      const skillsDir = path.join(rootPath, scopePath);
      if (!fs.existsSync(skillsDir)) continue;
      const skillsDirStat = fs.statSync(skillsDir);
      if (!skillsDirStat.isDirectory()) continue;
      const children = fs.readdirSync(skillsDir, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name));

      for (const child of children) {
        if (!child.isDirectory()) continue;
        const skillId = child.name;
        if (all === false && skillScene.has(skillId)) continue;
        skillScene.add(skillId);
        const skillDir = path.join(skillsDir, skillId);
        const skillFile = path.join(skillDir, SKILL_FILENAME);
        if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) continue;

        let metadata: Record<string, string> = {};
        try {
          const text = fs.readFileSync(skillFile, "utf8");
          const parsed = parseSkillFrontmatter(text);
          metadata = parsed.metadata;
        } catch {
          continue;
        }

        const name = metadata["name"] || path.basename(skillDir);
        const description = metadata["description"] || "";
        const id = toSkillId(level, scope, skillId);
        skills.push({ id, name, description, level, scope });
      }
    }
  }
  return skills;
}

async function searchSkills(query: string) {
  if (query.length <= 2) return [];
  const url = `${SKILLS_SH_API_BASE}/search?q=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = (await response.json()) as {
    query: string;
    searchType: string;
    skills: { id: string; skillId: string; name: string; installs: number; source: string }[];
  };
  return data.skills || [];
}

async function installSkill(source: string, slug: string) {
  const parts = source.split("/");
  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) throw new Error(`Invalid source format: ${source}`);

  const url = `${SKILLS_SH_API_BASE}/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download skill: ${response.statusText}`);

  const data = (await response.json()) as {
    files: { path: string; contents: string }[];
    hash: string;
  };
  if (!data.files || !Array.isArray(data.files))
    throw new Error("Invalid download response format");

  const targetDir = path.join(os.homedir(), ".fello", "skills", slug);
  await fs.promises.rm(targetDir, { recursive: true, force: true }).catch(() => {});
  await fs.promises.mkdir(targetDir, { recursive: true });

  for (const file of data.files) {
    const filePath = path.join(targetDir, file.path);
    if (!filePath.startsWith(targetDir)) continue;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, file.contents, "utf-8");
  }
}

function registerSkillsRoute(
  server: {
    registry: (path: string, handler: (payload: unknown) => unknown | Promise<unknown>) => void;
  },
  projectRoot: string,
) {
  server.registry("skills/catalog", async () => {
    return getSkillsCatalog({ projectRoot }).map(({ id, name, description }) => ({
      id,
      name,
      description,
    }));
  });

  server.registry("skills/detail", async (payload) => {
    const { id } = payload as { id: string };
    const catalog = getSkillsCatalog({ projectRoot });
    const skill = catalog.find((s) => s.id === id);
    if (!skill) return { error: `Skill '${id}' not found.`, available_skills: catalog };
    const skillDir = getSkillSystemPathFromId(skill.id, { projectRoot });
    if (!skillDir) return { error: `Failed to read skill '${id}'` };
    let body = "";
    try {
      const text = fs.readFileSync(path.join(skillDir, SKILL_FILENAME), "utf8");
      body = parseSkillFrontmatter(text).body;
    } catch {
      return { error: `Failed to read skill '${id}'` };
    }
    let supportingFiles: string[] = [];
    try {
      supportingFiles = listSkillFiles(skill.id, { projectRoot });
    } catch {}
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: body,
      root_path: skillDir,
      supporting_files: supportingFiles,
    };
  });
}

function buildSkillsMcpServer(options: { projectDir: string; socketPath: string }): {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
} {
  const catalog = getSkillsCatalog({ projectRoot: options.projectDir }).map(
    ({ id, name, description }) => ({ id, name, description }),
  );
  const catalogFilename = path.join(TEMP_DIR, `skills-catalog-${randomUUID()}.json`);
  fs.writeFileSync(catalogFilename, JSON.stringify(catalog), "utf8");

  const __dir = path.dirname(fileURLToPath(import.meta.url));
  return {
    name: "skills",
    command: process.execPath,
    args: [
      path.join(__dir, "../scripts/mcp-skills/server.mjs"),
      "--project-dir",
      options.projectDir,
      "--socket-path",
      options.socketPath,
      "--catalog",
      catalogFilename,
    ],
    env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  };
}
