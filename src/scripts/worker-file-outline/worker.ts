/**
 * Disposable tree-sitter parse child process — forked per request.
 * Separate V8 instance: Zone OOM kills only this process, not Electron main.
 */
import { existsSync, readFileSync } from "fs";
import { Parser, Language, type TreeCursor, type Tree } from "web-tree-sitter";
import type {
  OutlineSymbol,
  NameOfConfig,
  FileOutlineWorkerRequest,
  FileOutlineWorkerResponse,
} from "../../shared/zod/worker-file-outline-schema";

function scanName(cursor: TreeCursor, nameOf: NameOfConfig): string {
  if (!cursor.gotoFirstChild()) return "";
  const idTypes = new Set(nameOf.identifierTypes || []);
  const recTypes = new Set(nameOf.recurseTypes || []);
  const rawTypes = new Set(nameOf.rawTextTypes || []);
  let name = "";
  do {
    for (const field of nameOf.fieldPriority || []) {
      if (cursor.currentFieldName === field) {
        name = cursor.nodeText;
        break;
      }
    }
    if (name) break;
    const t = cursor.nodeType;
    if (!name && rawTypes.has(t)) {
      name = cursor.nodeText;
    }
    if (!name && recTypes.has(t)) {
      name = scanName(cursor, nameOf);
    }
    if (!name && idTypes.has(t)) {
      if (t !== "type_identifier" || cursor.currentFieldName !== "type") {
        name = cursor.nodeText;
      }
    }
  } while (cursor.gotoNextSibling());
  cursor.gotoParent();
  return name;
}

function isPythonDocstring(cursor: TreeCursor): boolean {
  if (cursor.nodeType !== "expression_statement") return false;
  const text = cursor.nodeText.trim();
  return text.startsWith('"""') || text.startsWith("'''");
}

function collectComments(tree: Tree): { text: string; startLine: number; endLine: number }[] {
  const comments: { text: string; startLine: number; endLine: number }[] = [];
  const cursor = tree.walk();
  let descend = true;
  try {
    while (true) {
      if (cursor.currentDepth < 0) break;
      const t = cursor.nodeType;
      if (
        t === "comment" ||
        t === "line_comment" ||
        t === "multiline_comment" ||
        isPythonDocstring(cursor)
      ) {
        comments.push({
          text: cursor.nodeText.trim(),
          startLine: cursor.startPosition.row + 1,
          endLine: cursor.endPosition.row + 1,
        });
      }
      if (descend && cursor.gotoFirstChild()) continue;
      if (cursor.gotoNextSibling()) {
        descend = true;
        continue;
      }
      if (cursor.currentDepth > 0 && cursor.gotoParent()) {
        descend = false;
        continue;
      }
      break;
    }
  } finally {
    cursor.delete();
  }
  return comments;
}

function cleanComment(text: string): string {
  let cleaned = text
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .replace(/^\s*\* ?/gm, "")
    .replace(/^\/+/, "")
    .replace(/^#/, "")
    .replace(/^'''/, "")
    .replace(/'''$/, "")
    .replace(/^"""/, "")
    .replace(/"""$/, "")
    .trim();
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[0] : "";
}

function attachComments(
  symbols: OutlineSymbol[],
  comments: { text: string; startLine: number; endLine: number }[],
): void {
  let ci = 0;
  for (const sym of symbols) {
    if (sym.depth > 0) continue;
    while (ci < comments.length && comments[ci].endLine < sym.startLine - 2) ci++;
    if (ci < comments.length) {
      const c = comments[ci];
      const gap = sym.startLine - c.endLine;
      if (gap === 1 || gap === 2) {
        sym.comment = cleanComment(c.text);
        continue;
      }
    }
    const inner = comments.find((c) => {
      const startsAfter = c.startLine >= sym.startLine + 1;
      const closeToStart = c.startLine <= sym.startLine + 3;
      const inside = c.startLine < sym.endLine;
      return startsAfter && closeToStart && inside;
    });
    if (inner) {
      sym.comment = cleanComment(inner.text);
    }
  }
}

async function parse(
  req: FileOutlineWorkerRequest,
): Promise<{ symbols: OutlineSymbol[]; totalLines: number }> {
  await Parser.init();
  if (!existsSync(req.wasmFile)) throw new Error(`Grammar not found: ${req.wasmFile}`);
  const lang = await Language.load(req.wasmFile);
  const parser = new Parser();
  parser.setLanguage(lang);

  const source = readFileSync(req.filePath, "utf8");
  const totalLines = source.split("\n").length;
  const tree = parser.parse(source);
  if (!tree) throw new Error("Failed to parse");

  let result: OutlineSymbol[] = [];
  const typeSet = new Set(req.symbols.flatMap((s) => s.types));
  const cursor = tree.walk();
  try {
    let descend = true,
      declDepth = -1;
    while (true) {
      if (cursor.currentDepth < 0) break;
      const t = cursor.nodeType;
      const isDecl = typeSet.has(t);
      if (descend && isDecl) declDepth++;
      else if (!descend && isDecl) declDepth--;
      if (descend && isDecl) {
        for (const sym of req.symbols) {
          if (sym.types.includes(t) && (sym.maxDepth === undefined || declDepth <= sym.maxDepth)) {
            let name = "";
            if (sym.hasName) name = scanName(cursor, req.nameOf);
            result.push({
              kind: sym.label,
              name: sym.hasName ? name || `(anonymous ${sym.label})` : "",
              startLine: cursor.startPosition.row + 1,
              endLine: cursor.endPosition.row + 1,
              depth: declDepth,
            });
            break;
          }
        }
      }
      if (descend && cursor.gotoFirstChild()) continue;
      if (cursor.gotoNextSibling()) {
        descend = true;
        continue;
      }
      if (cursor.currentDepth > 0 && cursor.gotoParent()) {
        descend = false;
        continue;
      }
      break;
    }
    result.sort((a, b) => a.startLine - b.startLine);

    if (req.wrappers?.length) {
      const appliedPrefixes = new Set<string>();
      for (const wrapper of req.wrappers) {
        const wCursor = tree.walk();
        try {
          let descend = true;
          while (true) {
            if (wCursor.currentDepth < 0) break;
            if (descend && wCursor.nodeType === wrapper.node) {
              const wStart = wCursor.startPosition.row + 1;
              const wEnd = wCursor.endPosition.row + 1;
              const maxDepth = wrapper.maxDepth ?? Infinity;
              const covered = result.some(
                (r) => r.startLine >= wStart && r.endLine <= wEnd && r.depth <= maxDepth,
              );
              if (covered) {
                for (const r of result) {
                  if (r.startLine >= wStart && r.endLine <= wEnd && r.depth <= maxDepth) {
                    const isStandalone = req.wrappers.some(
                      (w) => w.createStandaloneLabel && r.kind === w.createStandaloneLabel,
                    );
                    if (isStandalone) {
                      r.depth = 1;
                      continue;
                    }
                    if (r.kind.startsWith(wrapper.prefix)) continue;
                    let inserted = false;
                    for (const existing of appliedPrefixes) {
                      if (r.kind.startsWith(existing)) {
                        r.kind = existing + wrapper.prefix + r.kind.slice(existing.length);
                        inserted = true;
                        break;
                      }
                    }
                    if (!inserted) {
                      r.kind = wrapper.prefix + r.kind;
                    }
                  }
                }
              } else if (wrapper.createStandaloneLabel) {
                const exportName = scanName(wCursor, req.nameOf);
                result.push({
                  kind: wrapper.createStandaloneLabel,
                  name: exportName || "{...}",
                  startLine: wStart,
                  endLine: wEnd,
                  depth: 0,
                });
              }
            }
            if (descend && wCursor.gotoFirstChild()) continue;
            if (wCursor.gotoNextSibling()) {
              descend = true;
              continue;
            }
            if (wCursor.currentDepth > 0 && wCursor.gotoParent()) {
              descend = false;
              continue;
            }
            break;
          }
        } finally {
          wCursor.delete();
        }
        appliedPrefixes.add(wrapper.prefix);
      }
    }
    result.sort((a, b) => a.startLine - b.startLine);
    const comments = collectComments(tree);
    attachComments(result, comments);
    return { symbols: result, totalLines };
  } finally {
    cursor.delete();
    tree.delete();
  }
}

process.once("message", async (msg: FileOutlineWorkerRequest) => {
  try {
    const { symbols, totalLines } = await parse(msg);
    const response: FileOutlineWorkerResponse = { type: "result", symbols, totalLines };
    process.send!(response, () => process.exit(0));
  } catch (e: unknown) {
    const response: FileOutlineWorkerResponse = {
      type: "error",
      error: e instanceof Error ? e.message : String(e),
    };
    process.send!(response, () => process.exit(1));
  }
});
