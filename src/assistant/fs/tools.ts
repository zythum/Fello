import {
  appendFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { dirname } from "path";
import { tool } from "ai";
import { z } from "zod";
import type { ToolCallContent } from "@agentclientprotocol/sdk";
import { assertDeletablePath, assertWritablePath, resolveAssistantPath } from "./path";
import { runWithToolUpdates, toolText, type ToolUpdateSender } from "../tool-updates";

const MAX_LIST_ENTRIES = 200;
/** Hard ceiling on the file: anything bigger is refused before it is read into memory. */
const MAX_READ_BYTES = 4 * 1024 * 1024;
/** A read without offset/limit returns the whole file, so it gets the tighter budget. */
const MAX_READ_FULL_BYTES = 100 * 1024;
/** Byte budget for the text returned in one call, long lines included. */
const MAX_READ_OUTPUT_BYTES = 300 * 1024;
/**
 * Per-line cut: the same 1024 as ripgrep's `-M` default, but counted in characters rather than
 * bytes, so one minified line cannot flood the context.
 */
const MAX_READ_LINE_CHARS = 1024;
const MAX_WRITE_BYTES = 256 * 1024;
const MAX_READ_LINES = 400;
/**
 * A diff is rendered in the chat bubble and persisted with the message, so it gets its own
 * budget: past this size the edit still happens, it just reports text instead of a diff.
 */
const MAX_DIFF_BYTES = 300 * 1024;

export type GrepFn = (options: {
  projectDir: string;
  pattern: string;
  path: string;
  ignoreCase?: boolean;
  regex?: boolean;
  glob?: string;
  maxResults?: number;
  maxColumns?: number;
}) => Promise<{ output: string; code: number }>;

export type GlobFn = (options: {
  projectDir: string;
  pattern: string;
  path?: string;
  limit?: number;
}) => Promise<{ filePaths: string[]; totalFiles: number; truncated: boolean }>;

export type FileSystemTools = {
  grep: GrepFn;
  glob: GlobFn;
  /**
   * Moves a path to the operating system's trash. Absent on headless servers, where
   * `fs_delete` falls back to a permanent removal.
   */
  trashItem?: (path: string) => Promise<void>;
};

export type FileSystemToolDeps = {
  workspace: string;
  sendUpdate: ToolUpdateSender;
  grep: GrepFn;
  glob: GlobFn;
  trashItem?: (path: string) => Promise<void>;
};

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Cuts one over-long line and leaves a marker, so the model knows the line is partial. */
function capLine(line: string): string {
  if (line.length <= MAX_READ_LINE_CHARS) return line;
  // Never split a surrogate pair: a lone surrogate would reach the model as garbage.
  let cut = line.slice(0, MAX_READ_LINE_CHARS);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…[${line.length - cut.length} more chars]`;
}

/**
 * Keeps whole lines from the head until the byte budget is spent. A single line is already
 * capped by capLine, so the first line always fits and the result is never empty by accident.
 */
function keepLinesWithinByteLimit(lines: string[], byteLimit: number): string[] {
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const size = Buffer.byteLength(line, "utf8") + (kept.length ? 1 : 0);
    if (kept.length > 0 && bytes + size > byteLimit) break;
    kept.push(line);
    bytes += size;
  }
  return kept;
}

/** Creates the assistant's filesystem tools. All paths are absolute after resolution. */
export function createFileSystemTools({
  workspace,
  sendUpdate,
  grep,
  glob,
  trashItem,
}: FileSystemToolDeps) {
  return {
    fs_list: tool({
      description:
        "List one directory. Directories come first. Paths may be absolute or relative to your workspace. Hidden entries are included.",
      inputSchema: z.object({
        path: z.string().optional().describe("Directory to list. Defaults to your workspace root."),
      }),
      execute: async ({ path }, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          {
            toolCallId,
            title: `List ${path ?? "."}`,
            kind: "read",
            rawInput: { path },
          },
          async () => {
            const target = resolveAssistantPath(path ?? ".", workspace);
            const entries = await readdir(target, { withFileTypes: true });
            const sorted = entries
              .map((entry) => ({
                name: entry.name,
                type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
              }))
              .sort((a, b) =>
                a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
              )
              .slice(0, MAX_LIST_ENTRIES);
            return {
              path: toPosix(target),
              entries: sorted,
              truncated: entries.length > sorted.length,
            };
          },
          (result) =>
            `${result.entries.length} entr${result.entries.length === 1 ? "y" : "ies"} in ${result.path}`,
        ),
    }),

    fs_read: tool({
      description:
        "Read a UTF-8 text file by line. Use offset/limit to continue reading a long file. Binary files and files larger than 4 MB are rejected; a read without offset/limit is capped at 100 KB and 400 lines, unless force is true (whole file, still capped by a 300 KB output budget). Lines longer than 1024 characters are cut.",
      inputSchema: z.object({
        path: z.string().describe("File to read, absolute or relative to your workspace."),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("First line to return, 1-based. Default 1."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_READ_LINES)
          .optional()
          .describe(`Maximum lines to return. Default ${MAX_READ_LINES}.`),
        force: z
          .boolean()
          .optional()
          .describe(
            "Bypass the 100 KB / 400-line limits on a full read and return the whole file, up to a 300 KB output budget. Only use when you genuinely need the whole file.",
          ),
      }),
      execute: async ({ path, offset, limit, force }, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          {
            toolCallId,
            title: `Read ${path}`,
            kind: "read",
            rawInput: { path, offset, limit, force },
          },
          async () => {
            const target = resolveAssistantPath(path, workspace);
            const info = await stat(target);
            if (!info.isFile()) throw new Error(`Not a file: ${target}`);
            if (info.size > MAX_READ_BYTES)
              throw new Error(
                `File is ${info.size} bytes, over the ${MAX_READ_BYTES}-byte limit. Use fs_grep to locate the part you need.`,
              );
            // Same rule as the ACP ReadFile tool: a whole-file read has the tighter budget,
            // while offset/limit reads may use the full output budget. force only lifts this
            // gate; MAX_READ_BYTES and the 300 KB output budget still apply.
            if (
              !force &&
              offset === undefined &&
              limit === undefined &&
              info.size > MAX_READ_FULL_BYTES
            )
              throw new Error(
                `File is ${(info.size / 1024).toFixed(1)}KB, over the ${MAX_READ_FULL_BYTES / 1024}KB limit for a full read. Pass offset/limit to read specific lines, use fs_grep to locate the part you need, or set force=true if you need the whole file.`,
              );
            const content = await readFile(target, "utf8");
            if (content.includes("\u0000")) throw new Error(`Binary file: ${target}`);
            const lines = content.split("\n");
            const from = Math.max(1, offset ?? 1);
            if (from > lines.length)
              throw new Error(
                `Line ${from} is past the end of ${target}, which has ${lines.length} line(s).`,
              );
            // force means "I need the whole file", so it also drops the default line count;
            // the 300 KB output budget is what actually bounds the result.
            const count = limit ?? (force ? lines.length : MAX_READ_LINES);
            const slice = lines.slice(from - 1, from - 1 + count).map(capLine);
            const kept = keepLinesWithinByteLimit(slice, MAX_READ_OUTPUT_BYTES);
            return {
              path: toPosix(target),
              content: kept.join("\n"),
              fromLine: from,
              toLine: from + kept.length - 1,
              truncated: from - 1 + kept.length < lines.length,
            };
          },
          (result) =>
            `${result.path} lines ${result.fromLine}-${result.toLine}${result.truncated ? " (more lines available)" : ""}`,
        ),
    }),

    fs_write: tool({
      description:
        "Write a UTF-8 text file, creating parent directories. Relative paths resolve to your workspace. Never write into the assistant runtime directories.",
      inputSchema: z.object({
        path: z.string().describe("File to write, absolute or relative to your workspace."),
        content: z.string().describe(`File content. At most ${MAX_WRITE_BYTES} bytes per call.`),
        mode: z
          .enum(["overwrite", "append"])
          .optional()
          .describe("overwrite (default) replaces the file; append adds to the end."),
      }),
      execute: async ({ path, content, mode }, { toolCallId }) => {
        // The diff goes to the UI only: it is not part of the result the model receives.
        let diff: ToolCallContent | null = null;
        return runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `Write ${path}`, kind: "edit", rawInput: { path, mode } },
          async () => {
            const target = resolveAssistantPath(path, workspace);
            assertWritablePath(target);
            const bytes = Buffer.byteLength(content, "utf8");
            if (bytes > MAX_WRITE_BYTES)
              throw new Error(
                `Content is ${bytes} bytes, over the ${MAX_WRITE_BYTES}-byte limit. Split it across calls.`,
              );
            const append = mode === "append";
            const existing = await lstat(target).catch(() => null);
            const previousSize = existing?.isFile() === true ? existing.size : null;
            const showDiff =
              previousSize !== null &&
              previousSize <= MAX_DIFF_BYTES &&
              (!append || previousSize + bytes <= MAX_DIFF_BYTES);
            if (showDiff) {
              const previous = await readFile(target, "utf8");
              diff = {
                type: "diff",
                path: toPosix(target),
                oldText: previous,
                newText: append ? previous + content : content,
              };
            }
            await mkdir(dirname(target), { recursive: true });
            if (append) await appendFile(target, content, "utf8");
            else await writeFile(target, content, "utf8");
            return { path: toPosix(target), bytes, mode: mode ?? "overwrite" };
          },
          (result) => {
            const summary = `Wrote ${result.bytes} bytes to ${result.path}`;
            return diff ? [diff, toolText(summary)] : summary;
          },
        );
      },
    }),

    fs_edit: tool({
      description:
        "Edit an existing UTF-8 text file by replacing exact text (StrReplace style). Prefer it over fs_write when changing part of a file: it leaves the rest untouched and fails instead of writing when the match is missing or ambiguous.",
      inputSchema: z.object({
        path: z.string().describe("File to edit, absolute or relative to your workspace."),
        oldText: z
          .string()
          .min(1)
          .describe("Exact text to replace. Include enough context to make it match once."),
        newText: z.string().describe("Replacement text. Use an empty string to delete the match."),
        replaceAll: z.boolean().optional().describe("Replace every occurrence. Default false."),
      }),
      execute: async ({ path, oldText, newText, replaceAll }, { toolCallId }) => {
        // The diff goes to the UI only: it is not part of the result the model receives.
        let diff: ToolCallContent | null = null;
        return runWithToolUpdates(
          sendUpdate,
          {
            toolCallId,
            title: `Edit ${path}`,
            kind: "edit",
            rawInput: { path, oldText, newText, replaceAll: replaceAll ?? false },
          },
          async () => {
            const target = resolveAssistantPath(path, workspace);
            assertWritablePath(target);
            const info = await stat(target);
            if (!info.isFile()) throw new Error(`Not a file: ${target}`);
            if (info.size > MAX_READ_BYTES)
              throw new Error(
                `File is ${info.size} bytes, over the ${MAX_READ_BYTES}-byte limit. fs_edit needs the whole file in memory; ask the user how to proceed.`,
              );
            const current = await readFile(target, "utf8");
            if (current.includes("\u0000")) throw new Error(`Binary file: ${target}`);
            let matches = 0;
            for (
              let index = current.indexOf(oldText);
              index >= 0;
              index = current.indexOf(oldText, index + oldText.length)
            )
              matches += 1;
            if (matches === 0)
              throw new Error(
                `oldText was not found in ${toPosix(target)}. Read the file with fs_read and copy the exact text, whitespace included.`,
              );
            if (matches > 1 && replaceAll !== true)
              throw new Error(
                `oldText matches ${matches} places in ${toPosix(target)}. Add surrounding context to make it unique, or set replaceAll=true.`,
              );
            // split/join rather than replace(): a string replacement would interpret dollar
            // patterns (dollar-ampersand, dollar-quote, dollar-backtick) inside newText.
            // matches is >= 1 here, and > 1 only when replaceAll is true.
            const updated = current.split(oldText).join(newText);
            if (info.size <= MAX_DIFF_BYTES)
              diff = { type: "diff", path: toPosix(target), oldText: current, newText: updated };
            await writeFile(target, updated, "utf8");
            return { path: toPosix(target), matches, replacedAll: replaceAll === true };
          },
          (result) => {
            const summary = `Replaced ${result.matches} occurrence${result.matches === 1 ? "" : "s"} in ${result.path}`;
            return diff ? [diff, toolText(summary)] : summary;
          },
        );
      },
    }),

    fs_move: tool({
      description:
        "Move or rename a file or directory. An existing destination is kept unless force is true. Never move the assistant runtime directories.",
      inputSchema: z.object({
        from: z.string().describe("Source path."),
        to: z.string().describe("Destination path."),
        force: z.boolean().optional().describe("Replace an existing destination. Default false."),
      }),
      execute: async ({ from, to, force }, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `Move ${from}`, kind: "edit", rawInput: { from, to, force } },
          async () => {
            const source = resolveAssistantPath(from, workspace);
            const target = resolveAssistantPath(to, workspace);
            assertWritablePath(source);
            assertWritablePath(target);
            const info = await stat(source);
            if (source === target) return { from: toPosix(source), to: toPosix(target) };
            const existing = await lstat(target).catch(() => null);
            if (existing && !force)
              throw new Error(
                `Destination already exists: ${target}. Pass force: true to overwrite it.`,
              );
            await mkdir(dirname(target), { recursive: true });
            try {
              await rename(source, target);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
              // Different volume: copy first, then remove the source.
              if (info.isDirectory()) await cp(source, target, { recursive: true });
              else await cp(source, target);
              await rm(source, { recursive: info.isDirectory(), force: true });
            }
            return { from: toPosix(source), to: toPosix(target) };
          },
          (result) => `Moved to ${result.to}`,
        ),
    }),

    fs_delete: tool({
      description:
        "Delete a file or directory inside your workspace. In the desktop app the target moves to the system trash and the user can restore it; on a headless server it is deleted permanently. Paths outside your workspace are refused: ask the user to delete those.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("File or directory to delete, absolute or relative to your workspace."),
      }),
      execute: async ({ path }, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `Delete ${path}`, kind: "edit", rawInput: { path } },
          async () => {
            const target = resolveAssistantPath(path, workspace);
            assertDeletablePath(target, workspace);
            const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            });
            if (!info) throw new Error(`No such file or directory: ${target}`);
            if (trashItem) {
              try {
                await trashItem(target);
              } catch (error) {
                throw new Error(
                  `Could not move ${target} to the system trash: ${
                    error instanceof Error ? error.message : String(error)
                  }. Nothing was deleted.`,
                );
              }
              return { path: toPosix(target), method: "trash" as const };
            }
            await rm(target, { recursive: info.isDirectory(), force: false });
            return { path: toPosix(target), method: "permanent" as const };
          },
          (result) =>
            result.method === "trash"
              ? `Moved to the system trash: ${result.path}`
              : `Permanently deleted: ${result.path}`,
        ),
    }),

    fs_glob: tool({
      description:
        "Find files by glob pattern, for example **/*.md. Hidden files and directories are skipped unless the pattern starts with a dot.",
      inputSchema: z.object({
        pattern: z.string().min(1).describe("Glob pattern, relative to path."),
        path: z
          .string()
          .optional()
          .describe("Directory to search in. Defaults to your workspace root."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum paths to return."),
      }),
      execute: async ({ pattern, path, limit }, { toolCallId }) =>
        runWithToolUpdates(
          sendUpdate,
          {
            toolCallId,
            title: `Find ${pattern}`,
            kind: "read",
            rawInput: { pattern, path, limit },
          },
          async () => {
            const root = resolveAssistantPath(path ?? ".", workspace);
            const result = await glob({
              projectDir: workspace,
              pattern,
              path: root,
              limit: limit ?? 200,
            });
            return {
              path: toPosix(root),
              files: result.filePaths,
              totalFiles: result.totalFiles,
              truncated: result.truncated,
            };
          },
          (result) =>
            `${result.files.length} file(s)${result.truncated ? ` of ${result.totalFiles}` : ""}`,
        ),
    }),

    fs_grep: tool({
      description:
        "Search file contents for a text fragment or regular expression. Returns matching file, line number and line. Long matching lines are cut to 1024 bytes by default. Use short, specific patterns.",
      inputSchema: z.object({
        pattern: z.string().min(1).describe("Text or regular expression to search for."),
        path: z
          .string()
          .optional()
          .describe("File or directory to search. Defaults to your workspace root."),
        glob: z.string().optional().describe("Restrict to matching files, for example *.md."),
        ignoreCase: z.boolean().optional().describe("Case-insensitive search."),
        regex: z.boolean().optional().describe("Treat pattern as a regular expression."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum matching lines per file. Default 100."),
        maxColumns: z
          .number()
          .int()
          .min(0)
          .max(4096)
          .optional()
          .describe("Cut each matching line to this many bytes; 0 disables the cut. Default 1024."),
      }),
      execute: async (
        { pattern, path, glob: fileGlob, ignoreCase, regex, maxResults, maxColumns },
        { toolCallId },
      ) =>
        runWithToolUpdates(
          sendUpdate,
          { toolCallId, title: `Search ${pattern}`, kind: "read", rawInput: { pattern, path } },
          async () => {
            const target = resolveAssistantPath(path ?? ".", workspace);
            const exists = await stat(target).then(
              () => true,
              () => false,
            );
            if (!exists) throw new Error(`No such file or directory: ${target}`);
            const result = await grep({
              projectDir: workspace,
              pattern,
              path: target,
              ...(fileGlob ? { glob: fileGlob } : {}),
              ...(ignoreCase ? { ignoreCase } : {}),
              ...(regex ? { regex } : {}),
              maxResults: maxResults ?? 100,
              // Unset keeps ripgrep's own 1024-byte default, so the cap holds either way.
              ...(maxColumns !== undefined ? { maxColumns } : {}),
            });
            return {
              path: toPosix(target),
              matches: result.output.trim(),
              noMatches: result.code === 1,
            };
          },
          (result) =>
            result.noMatches ? "No matches" : `${result.matches.split("\n").length} line(s)`,
        ),
    }),
  };
}
