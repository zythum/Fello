import Fuse from "fuse.js";
import {
  mkdir,
  readdir,
  readFile as fsReadFile,
  rename,
  rm,
  stat,
  writeFile,
  open,
  copyFile,
} from "fs/promises";
import * as mimeTypes from "mime-types";
import { dirname, join, relative, extname, basename } from "path";
import type { BackendContext } from "../types";
import { resolveSafePath, toPosixPath } from "../utils";
import * as git from "./git-utils";

// ── Constants ────────────────────────────────────────────────────────

const SEARCH_MAX_RESULTS = 10;
const SEARCH_FUSE_THRESHOLD = 0.4;
const SEARCH_CACHE_TTL_MS = 60_000;

// VCS directories that should never appear in the file tree / search results.
const IGNORE_NAME_SET = new Set([".git", ".svn", ".hg"]);

// Heavy dependency/cache directories that should never be indexed for search,
// even when they are not covered by .gitignore.
const SEARCH_IGNORE_NAME_SET = new Set(["node_modules", "vendor", "__pycache__"]);

// ── Types ────────────────────────────────────────────────────────────

/**
 * Checks whether any segment of the path relative to `cwd` belongs to one of
 * the given forbidden name sets (VCS dirs, heavy dependency dirs, ...).
 * @param fullPath The absolute path of the file or directory to check.
 * @param cwd The absolute path of the project root directory.
 * @param nameSets The sets of directory names that should be excluded.
 * @returns true if the path contains a forbidden segment, false otherwise.
 */
function hasForbiddenSegment(
  fullPath: string,
  cwd: string,
  ...nameSets: ReadonlySet<string>[]
): boolean {
  if (fullPath === cwd) return false;
  const relPath = relative(cwd, fullPath);
  if (!relPath) return false;
  const segments = relPath.split(/[\\/]+/);
  for (let i = 0; i < segments.length; i++) {
    const name = segments[i];
    if (!name || name === ".") continue;
    if (nameSets.some((set) => set.has(name))) return true;
  }
  return false;
}

// ── Types ────────────────────────────────────────────────────────────

type SearchFileItem = { id: string; filename: string; isFolder: boolean };
type SearchFileCacheEntry = {
  version: number;
  builtAt: number;
  files: SearchFileItem[];
  fuse: Fuse<SearchFileItem>;
};

export interface FilesystemState {
  markProjectFsDirty: (projectId: string) => void;
  initProjectFsVersion: (projectId: string) => void;
  clearProjectSearchState: (projectId: string) => void;
}

export function createFilesystemState(ctx: BackendContext) {
  const { storage } = ctx;
  const projectFsVersions = new Map<string, number>();
  const searchFileCache = new Map<string, SearchFileCacheEntry>();

  function markProjectFsDirty(projectId: string) {
    const nextVersion = (projectFsVersions.get(projectId) ?? 0) + 1;
    projectFsVersions.set(projectId, nextVersion);
    searchFileCache.delete(projectId);
  }

  function initProjectFsVersion(projectId: string) {
    if (!projectFsVersions.has(projectId)) {
      projectFsVersions.set(projectId, 0);
    }
  }

  function getProjectFsVersion(projectId: string) {
    return projectFsVersions.get(projectId) ?? 0;
  }

  function clearProjectSearchState(projectId: string) {
    projectFsVersions.delete(projectId);
    searchFileCache.delete(projectId);
  }

  async function buildSearchIndex(cwd: string): Promise<SearchFileItem[]> {
    const fileScene = new Set<string>();
    const allFiles: SearchFileItem[] = [];

    async function collect(dir: string) {
      if (fileScene.has(dir)) return;
      fileScene.add(dir);
      const entries = await readdir(dir).catch(() => []);
      for (const name of entries) {
        const full = join(dir, name);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        if (hasForbiddenSegment(full, cwd, IGNORE_NAME_SET, SEARCH_IGNORE_NAME_SET)) continue;
        if (fileScene.has(full)) continue;
        const rel = relative(cwd, full);
        const posixRel = toPosixPath(rel);
        allFiles.push({ id: posixRel, filename: rel, isFolder: s.isDirectory() });
        if (s.isDirectory()) await collect(full);
      }
    }

    await collect(cwd);
    return allFiles;
  }

  // ── Handlers ─────────────────────────────────────────────────────

  async function getSystemFilePath({
    projectId,
    path: inputPath,
    isAbsolute,
  }: {
    projectId: string;
    path: string;
    isAbsolute?: boolean;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    if (isAbsolute) return resolveSafePath(project.cwd, inputPath);
    return relative(project.cwd, resolveSafePath(project.cwd, inputPath));
  }

  async function copyFileToWorkspace({
    projectId,
    sourcePath,
    destDir,
  }: {
    projectId: string;
    sourcePath: string;
    destDir?: string;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const cwd = destDir || project.cwd;

    const fileName = basename(sourcePath);
    let destPath = join(cwd, fileName);
    let counter = 1;

    while (true) {
      const info = await stat(destPath).catch(() => null);
      if (!info) break;
      const ext = extname(fileName);
      const name = basename(fileName, ext);
      destPath = join(cwd, `${name}(${counter})${ext}`);
      counter++;
    }

    await copyFile(sourcePath, destPath);
    markProjectFsDirty(projectId);
    return { success: true, destPath: toPosixPath(relative(cwd, destPath)) };
  }

  async function readUrlAsDataUrl({ url: inputUrl, mimeType }: { url: string; mimeType?: string }) {
    const MAX_FILE_SIZE = 20 * 1024 * 1024;

    if (inputUrl.startsWith("http://") || inputUrl.startsWith("https://")) {
      try {
        const res = await fetch(inputUrl, { method: "HEAD" });
        if (res.ok) {
          const contentLength = res.headers.get("content-length");
          if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
            throw new Error(`File is too large (exceeds 20MB)`);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("exceeds 20MB")) throw err;
      }

      const getRes = await fetch(inputUrl);
      if (!getRes.ok) throw new Error(`Failed to fetch URL: ${getRes.statusText}`);

      const arrayBuffer = await getRes.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_FILE_SIZE)
        throw new Error(`File is too large (exceeds 20MB)`);

      const buffer = Buffer.from(arrayBuffer);
      const data = buffer.toString("base64");
      const mime = mimeType || getRes.headers.get("content-type") || "application/octet-stream";
      return `data:${mime};base64,${data}`;
    }

    let inputPath = "";
    if (inputUrl.startsWith("file://")) {
      inputPath = decodeURIComponent(inputUrl.slice(7));
    } else {
      throw new Error(`Unsupported protocol or path format: ${inputUrl}`);
    }

    const safePath = inputPath;
    const fileStat = await stat(safePath);
    if (fileStat.size > MAX_FILE_SIZE) throw new Error(`File is too large (exceeds 20MB)`);

    const data = await fsReadFile(safePath, "base64");
    let mime = mimeType;
    if (!mime) mime = mimeTypes.lookup(safePath) || "application/octet-stream";
    return `data:${mime};base64,${data}`;
  }

  async function searchFiles({ projectId, query }: { projectId: string; query?: string }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const cwd = project.cwd;
    const fileScene = new Set<string>();

    if (!query || query.trim() === "") {
      const entries = await readdir(cwd).catch(() => []);
      const results: Array<{ id: string; filename: string; isFolder: boolean }> = [];
      for (const name of entries) {
        const full = join(cwd, name);
        if (hasForbiddenSegment(full, cwd, IGNORE_NAME_SET, SEARCH_IGNORE_NAME_SET)) continue;
        if (fileScene.has(full)) continue;
        fileScene.add(full);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        const rel = relative(cwd, full);
        results.push({ id: toPosixPath(rel), filename: rel, isFolder: s.isDirectory() });
        if (results.length >= SEARCH_MAX_RESULTS) break;
      }
      results.sort((a, b) => a.filename.localeCompare(b.filename));
      return results;
    }

    const normalizedQuery = toPosixPath(query);
    const currentVersion = getProjectFsVersion(projectId);
    const cached = searchFileCache.get(projectId);
    let entry: SearchFileCacheEntry;
    if (
      cached &&
      cached.version === currentVersion &&
      Date.now() - cached.builtAt <= SEARCH_CACHE_TTL_MS
    ) {
      entry = cached;
    } else {
      const files = await buildSearchIndex(cwd);
      entry = {
        version: currentVersion,
        builtAt: Date.now(),
        files,
        fuse: new Fuse(files, { keys: ["filename"], threshold: SEARCH_FUSE_THRESHOLD }),
      };
      searchFileCache.set(projectId, entry);
    }

    return entry.fuse.search(normalizedQuery, { limit: SEARCH_MAX_RESULTS }).map((r) => r.item);
  }

  async function readDir({
    projectId,
    relativePath = "",
  }: {
    projectId: string;
    relativePath?: string;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const cwd = project.cwd;
    const startPath = resolveSafePath(cwd, relativePath);

    const entries = await readdir(startPath).catch(() => []);
    const results: { id: string; name: string; isFolder: boolean; ignored: boolean }[] = [];
    for (const name of entries) {
      const full = join(startPath, name);
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      if (hasForbiddenSegment(full, cwd, IGNORE_NAME_SET)) continue;
      const relId = toPosixPath(relative(cwd, full));
      results.push({ id: relId, name, isFolder: s.isDirectory(), ignored: false });
    }

    results.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Mark entries excluded by .gitignore so the file tree can dim them.
    const ignoredPaths = await git.getGitIgnoredPaths(
      cwd,
      results.map((r) => r.id),
    );
    if (ignoredPaths.size > 0) {
      for (const r of results) {
        if (ignoredPaths.has(r.id)) r.ignored = true;
      }
    }
    return results;
  }

  async function createFile({
    projectId,
    relativePath,
    isFolder,
  }: {
    projectId: string;
    relativePath: string;
    isFolder?: boolean;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);
    if (isFolder) {
      await mkdir(targetPath, { recursive: true });
    } else {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, "");
    }
    markProjectFsDirty(projectId);
  }

  async function deleteFile({
    projectId,
    relativePath,
  }: {
    projectId: string;
    relativePath: string;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);
    await rm(targetPath, { recursive: true, force: true });
    markProjectFsDirty(projectId);
  }

  async function renameFile({
    projectId,
    oldRelativePath,
    newRelativePath,
  }: {
    projectId: string;
    oldRelativePath: string;
    newRelativePath: string;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    await rename(
      resolveSafePath(project.cwd, oldRelativePath),
      resolveSafePath(project.cwd, newRelativePath),
    );
    markProjectFsDirty(projectId);
  }

  async function moveFile({
    projectId,
    oldRelativePath,
    newRelativePath,
  }: {
    projectId: string;
    oldRelativePath: string;
    newRelativePath: string;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    await rename(
      resolveSafePath(project.cwd, oldRelativePath),
      resolveSafePath(project.cwd, newRelativePath),
    );
    markProjectFsDirty(projectId);
  }

  async function readFile({
    projectId,
    relativePath,
    encoding,
  }: {
    projectId: string;
    relativePath: string;
    encoding?: BufferEncoding;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);
    return fsReadFile(targetPath, encoding ?? "utf8");
  }

  async function getFileInfo({
    projectId,
    relativePath,
  }: {
    projectId: string;
    relativePath: string;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);
    try {
      const s = await stat(targetPath);
      let isBinary = false;
      if (s.isFile() && s.size > 0) {
        const fd = await open(targetPath, "r");
        try {
          const buffer = Buffer.alloc(512);
          const { bytesRead } = await fd.read(buffer, 0, 512, 0);
          for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) {
              isBinary = true;
              break;
            }
          }
        } finally {
          await fd.close();
        }
      }
      return { size: s.size, isFile: s.isFile(), isBinary };
    } catch {
      return null;
    }
  }

  async function writeExternalFile({
    projectId,
    fileName,
    base64,
    destRelativeDir,
  }: {
    projectId: string;
    fileName: string;
    base64: string;
    destRelativeDir?: string;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const destDir = resolveSafePath(project.cwd, destRelativeDir || "");

    const ext = extname(fileName);
    const base = basename(fileName, ext);
    let counter = 0;
    let currentDest = join(destDir, fileName);

    while (true) {
      const existing = await stat(currentDest).catch(() => null);
      if (!existing) break;
      if (counter === 0 && existing.isDirectory())
        throw new Error("Cannot overwrite a folder with a file");
      counter++;
      currentDest = join(destDir, `${base}(${counter})${ext}`);
    }

    const buffer = Buffer.from(base64, "base64");
    await mkdir(destDir, { recursive: true });
    await writeFile(currentDest, buffer);
    markProjectFsDirty(projectId);
  }

  async function getGitStatus({ projectId, cwd }: { projectId: string; cwd?: string }) {
    const project = storage.getProject(projectId);
    if (!project) return null;
    const targetCwd = cwd ? resolveSafePath(project.cwd, cwd) : project.cwd;
    return git.getGitStatus(targetCwd);
  }

  async function readGitHeadFile({
    projectId,
    relativePath,
    encoding,
  }: {
    projectId: string;
    relativePath: string;
    encoding?: string;
  }) {
    const project = storage.getProject(projectId);
    if (!project) return "";
    const targetPath = resolveSafePath(project.cwd, relativePath);
    return git.readGitHeadFile(targetPath, encoding);
  }

  async function getPlatform() {
    return process.platform;
  }

  return {
    markProjectFsDirty,
    initProjectFsVersion,
    clearProjectSearchState,
    getSystemFilePath,
    copyFileToWorkspace,
    readUrlAsDataUrl,
    searchFiles,
    readDir,
    createFile,
    deleteFile,
    renameFile,
    moveFile,
    readFile,
    getFileInfo,
    writeExternalFile,
    getGitStatus,
    readGitHeadFile,
    getPlatform,
  };
}
