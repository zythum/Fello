import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SKILL_FILENAME = "SKILL.md";

export interface SkillInfo {
  name: string;
  description: string;
  path: string; // Full path to the SKILL.md file
  base_dir: string; // Parent directory containing SKILL.md
}

export function parseSkillFrontmatter(filePath: string): {
  metadata: Record<string, string>;
  body: string;
} {
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    if (!text.startsWith("---")) {
      return { metadata: {}, body: text.trim() };
    }
    const endIndex = text.indexOf("\n---", 3);
    if (endIndex === -1) {
      return { metadata: {}, body: text.trim() };
    }
    const frontmatterRaw = text.substring(3, endIndex).trim();
    const body = text.substring(endIndex + 4).trim();

    const metadata: Record<string, string> = {};
    const lines = frontmatterRaw.split("\n");
    let currentKey = "";
    let currentValue = "";

    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match) {
        if (currentKey) {
          metadata[currentKey] = currentValue.trim();
        }
        currentKey = match[1];
        currentValue = match[2];
      } else if (currentKey) {
        currentValue += " " + line.trim();
      }
    }
    if (currentKey) {
      metadata[currentKey] = currentValue.trim();
    }

    return { metadata, body };
  } catch {
    return { metadata: {}, body: "" };
  }
}

export function listSkillFiles(skillDir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    return files;
  }

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

function skillRoots(): string[] {
  const cwd = process.cwd();
  const home = os.homedir();
  return [
    path.join(cwd, ".agents", "skills"),
    path.join(cwd, ".claude", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".claude", "skills"),
  ];
}

function tryRegisterSkill(skillDir: string, skills: Record<string, SkillInfo>): boolean {
  const skillFile = path.join(skillDir, SKILL_FILENAME);
  if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) {
    return false;
  }

  let metadata: Record<string, string> = {};
  try {
    const parsed = parseSkillFrontmatter(skillFile);
    metadata = parsed.metadata;
  } catch {
    return true; // File exists but unreadable
  }

  const name = metadata["name"] || path.basename(skillDir);
  const description = metadata["description"] || "";

  if (skills[name]) {
    return true;
  }

  skills[name] = {
    name,
    description,
    path: skillFile,
    base_dir: skillDir,
  };
  return true;
}

export function discoverSkills(roots?: string[]): Record<string, SkillInfo> {
  const actualRoots = roots || skillRoots();
  const skills: Record<string, SkillInfo> = {};

  for (const root of actualRoots) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      continue;
    }

    const children = fs.readdirSync(root, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));

    for (const child of children) {
      if (!child.isDirectory()) continue;

      const childPath = path.join(root, child.name);
      if (tryRegisterSkill(childPath, skills)) {
        continue;
      }

      const grandchildren = fs.readdirSync(childPath, { withFileTypes: true });
      grandchildren.sort((a, b) => a.name.localeCompare(b.name));

      for (const grandchild of grandchildren) {
        if (!grandchild.isDirectory()) continue;
        const grandchildPath = path.join(childPath, grandchild.name);
        tryRegisterSkill(grandchildPath, skills);
      }
    }
  }

  return skills;
}

export function buildSkillRoots(projectRoots?: string[]): string[] {
  const roots: string[] = [];

  // Project-level: prefer explicit roots from the caller, fall back to CWD
  if (projectRoots && projectRoots.length > 0) {
    for (const root of projectRoots) {
      roots.push(path.join(root, ".agents", "skills"));
      roots.push(path.join(root, ".claude", "skills"));
    }
  }

  // User-level: always included
  const home = os.homedir();
  roots.push(path.join(home, ".fello", "skills"));
  roots.push(path.join(home, ".agents", "skills"));
  roots.push(path.join(home, ".claude", "skills"));

  return roots;
}

export function getSkillsCatalog(projectRoots?: string[]): Record<string, SkillInfo> {
  return discoverSkills(buildSkillRoots(projectRoots));
}
