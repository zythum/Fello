/**
 * tree-sitter parse child process — forked by file-outline.ts
 * Separate V8 instance: Zone OOM kills only this process, not Electron main.
 */
import { existsSync } from "fs";
import { Parser, Language } from "web-tree-sitter";

let _initDone = false;

async function init(): Promise<void> {
  if (_initDone) return;
  await Parser.init();
  _initDone = true;
}

const _parsers = new Map<string, any>();
const _loadPromises = new Map<string, Promise<any>>();

async function getParser(wasmFile: string): Promise<any> {
  const c = _parsers.get(wasmFile);
  if (c) return c;
  if (!_loadPromises.has(wasmFile)) {
    _loadPromises.set(
      wasmFile,
      (async () => {
        try {
          if (!existsSync(wasmFile)) throw new Error(`Grammar not found: ${wasmFile}`);
          const lang = await Language.load(wasmFile);
          const parser = new Parser();
          parser.setLanguage(lang);
          _parsers.set(wasmFile, parser);
          return parser;
        } catch (err) {
          _loadPromises.delete(wasmFile); // allow retry
          throw err;
        }
      })(),
    );
  }
  return _loadPromises.get(wasmFile)!;
}

function scanName(cursor: any, nameOf: any): string {
  if (!cursor.gotoFirstChild()) return "";
  const idTypes = new Set(nameOf.identifierTypes || []);
  const recTypes = new Set(nameOf.recurseTypes || []);
  const rawTypes = new Set(nameOf.rawTextTypes || []);
  let name = "";
  do {
    // 1) Check field names by priority
    for (const field of nameOf.fieldPriority || []) {
      if (cursor.currentFieldName === field) {
        name = cursor.nodeText;
        break;
      }
    }
    if (name) break;
    const t = cursor.nodeType;
    // 2) Raw text types (e.g. destructor "~Foo", operator overloads)
    if (!name && rawTypes.has(t)) {
      name = cursor.nodeText;
    }
    // 3) Recurse into known container types (e.g. declarator chains, export clauses)
    if (!name && recTypes.has(t)) {
      name = scanName(cursor, nameOf);
    }
    // 4) Direct identifier match (skip type_identifier when it's a return type)
    if (!name && idTypes.has(t)) {
      if (t !== "type_identifier" || cursor.currentFieldName !== "type") {
        name = cursor.nodeText;
      }
    }
  } while (cursor.gotoNextSibling());
  cursor.gotoParent();
  return name;
}

/**
 * Check if a cursor points to a Python docstring expression.
 * Heuristic: expression_statement with a single string child that starts with triple quotes.
 */
function isPythonDocstring(cursor: any): boolean {
  if (cursor.nodeType !== "expression_statement") return false;
  const text = cursor.nodeText.trim();
  return text.startsWith('"""') || text.startsWith("'''");
}

/**
 * Collect all comment nodes from the tree (including language-specific variants).
 * Supports: comment (C/C++/TS/Swift), line_comment/multiline_comment (Kotlin),
 *           expression_statement as docstring (Python).
 */
function collectComments(tree: any): { text: string; startLine: number; endLine: number }[] {
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

/**
 * Clean up comment text for display.
 * Supports JSDoc, single-line (//, ///, #), and Python docstrings.
 */
function cleanComment(text: string): string {
  let cleaned = text
    .replace(/^\/\*\*?/, "") // strip opening /* or /**
    .replace(/\*\/$/, "") // strip closing */
    .replace(/^\s*\* ?/gm, "") // strip leading * in JSDoc
    .replace(/^\/+/, "") // strip // or ///...
    .replace(/^#/, "") // strip #
    .replace(/^'''/, "") // strip opening '''
    .replace(/'''$/, "") // strip closing '''
    .replace(/^"""/, "") // strip opening """
    .replace(/"""$/, "") // strip closing """
    .trim();
  // Take first non-empty line
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[0] : "";
}

/**
 * Match comments to depth-0 symbols based on proximity.
 * For most languages: comment is directly before the symbol (gap 1-2 lines).
 * For Python docstrings: the docstring is the first statement INSIDE the class/function body.
 */
function attachComments(
  symbols: any[],
  comments: { text: string; startLine: number; endLine: number }[],
): void {
  let ci = 0;
  for (const sym of symbols) {
    if (sym.depth > 0) continue;
    // Strategy 1: comment right before the symbol (most languages)
    while (ci < comments.length && comments[ci].endLine < sym.startLine - 2) ci++;
    if (ci < comments.length) {
      const c = comments[ci];
      const gap = sym.startLine - c.endLine;
      if (gap === 1 || gap === 2) {
        sym.comment = cleanComment(c.text);
        continue;
      }
    }
    // Strategy 2: Python docstring inside the symbol (first statement in body)
    const inner = comments.find((c) => {
      // Docstring starts at least 1 line after the symbol signature
      const startsAfter = c.startLine >= sym.startLine + 1;
      // Docstring starts within the first 3 lines of the symbol
      const closeToStart = c.startLine <= sym.startLine + 3;
      // Docstring is before the symbol ends
      const inside = c.startLine < sym.endLine;
      // Not already assigned to a previous symbol
      return startsAfter && closeToStart && inside;
    });
    if (inner) {
      sym.comment = cleanComment(inner.text);
    }
  }
}

async function parse(req: any): Promise<any[]> {
  const parser = await getParser(req.wasmFile);
  const tree = parser.parse(req.source);
  if (!tree) throw new Error("Failed to parse");
  let result: any[] = [];
  const typeSet = new Set(req.symbols.flatMap((s: any) => s.types));
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
    result.sort((a: any, b: any) => a.startLine - b.startLine);

    // Generic wrapper detection: walk tree for each configured wrapper node type,
    // then prefix or create standalone entries.
    // Wrappers are processed in config order so that nested wrappers (e.g.
    // export_statement wrapping ambient_declaration) produce correct prefix
    // ordering (e.g. "export declare const").
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
                // This wrapper wraps a tracked declaration — apply prefix
                for (const r of result) {
                  if (r.startLine >= wStart && r.endLine <= wEnd && r.depth <= maxDepth) {
                    // Skip standalone entries created by other wrappers (e.g.
                    // an "export" inside an "ambient_declaration" block).
                    // A standalone entry has kind matching any wrapper's createStandaloneLabel
                    // (e.g. "export"), and should only get its depth adjusted.
                    const isStandalone = req.wrappers.some(
                      (w: any) => w.createStandaloneLabel && r.kind === w.createStandaloneLabel,
                    );
                    if (isStandalone) {
                      r.depth = 1;
                      continue;
                    }
                    if (r.kind.startsWith(wrapper.prefix)) continue;
                    // Insert prefix, respecting previously applied prefixes
                    // e.g. "export const" + "declare " → "export declare const"
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
                // Standalone re-export — extract name via scanName
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
    result.sort((a: any, b: any) => a.startLine - b.startLine);
    // Attach comments
    const comments = collectComments(tree);
    attachComments(result, comments);
    return result;
  } finally {
    cursor.delete();
    tree.delete();
  }
}

process.on("message", async (msg: any) => {
  if (msg.type === "init") {
    try {
      await init();
      process.send!({ type: "init_done" });
    } catch (e: any) {
      process.send!({ type: "init_error", error: e.message || String(e) });
    }
    return;
  }
  if (msg.type === "parse") {
    try {
      const symbols = await parse(msg);
      process.send!({ type: "result", id: msg.id, symbols });
    } catch (e: any) {
      process.send!({ type: "error", id: msg.id, error: e.message || String(e) });
    }
    return;
  }
});
