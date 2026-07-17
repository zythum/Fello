/**
 * Disposable tree-sitter parse child process — forked per request.
 * Separate V8 instance: Zone OOM kills only this process, not Electron main.
 */
import { existsSync, readFileSync } from "fs";
import { Parser, Language, type TreeCursor, type Tree } from "web-tree-sitter";
import type {
  OutlineSymbol,
  SymbolKindConfig,
  NameOfConfig,
  StatementDetailConfig,
  FileOutlineWorkerRequest,
  FileOutlineWorkerResponse,
} from "../../shared/zod/worker-file-outline-schema";

/** Labels that represent import/export statements needing detail extraction */
const DEFAULT_DETAIL_LABELS = new Set(["import", "import from", "export"]);

/**
 * Strip surrounding quotes from a string literal node text.
 */
function stripQuotes(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, "");
}

/**
 * Recursively search children (one level deep) for a string literal.
 * Used when sourceTypes point to a container node (e.g. configurable_uri > string_literal).
 */
function findNestedString(cursor: TreeCursor, sourceTypes: Set<string>): string {
  if (!cursor.gotoFirstChild()) return "";
  let found = "";
  do {
    const type = cursor.nodeType;
    if (type === "string" || type === "string_literal" || type === "interpreted_string_literal") {
      found = stripQuotes(cursor.nodeText);
      break;
    }
    // If this child is also a declared sourceType, recurse one more level
    if (sourceTypes.has(type)) {
      found = findNestedString(cursor, sourceTypes);
      if (found) break;
    }
  } while (cursor.gotoNextSibling());
  cursor.gotoParent();
  return found;
}

/**
 * Config-driven extraction of import/export details.
 * Uses StatementDetailConfig to determine how to find source (→ name) and clauses (→ detail).
 * No language-specific logic — all behavior comes from the config.
 */
function extractImportExportDetail(
  cursor: TreeCursor,
  nodeText: string,
  label: string,
  config: StatementDetailConfig,
): { name: string; detail?: string } {
  const sourceFields = new Set(config.sourceFields || []);
  const sourceTypes = new Set(config.sourceTypes || []);
  const clauseTypes = new Set(config.clauseTypes || []);
  const typeKeywordTypes = new Set(config.typeKeywordTypes || []);

  let source = "";
  let clauses: string[] = [];
  let hasTypeKeyword = false;

  if (!cursor.gotoFirstChild()) {
    return { name: nodeText.trim() };
  }

  do {
    const field = cursor.currentFieldName;
    const type = cursor.nodeType;
    const text = cursor.nodeText;

    if (field && sourceFields.has(field)) {
      // Field-based source extraction (e.g. field "source" → strip quotes)
      source = stripQuotes(text);
    } else if (sourceTypes.has(type)) {
      // Type-based source extraction — try direct text first, then recurse
      if (!source) {
        if (
          type === "string" ||
          type === "string_literal" ||
          type === "interpreted_string_literal"
        ) {
          source = stripQuotes(text);
        } else {
          // Container type (e.g. configurable_uri): recurse to find string
          const nested = findNestedString(cursor, sourceTypes);
          source = nested || stripQuotes(text);
        }
      }
    } else if (clauseTypes.has(type)) {
      clauses.push(text);
    } else if (typeKeywordTypes.has(type)) {
      hasTypeKeyword = true;
    }
  } while (cursor.gotoNextSibling());
  cursor.gotoParent();

  // Config option: treat clauses as source when no string source found
  if (!source && config.clausesAsSource && clauses.length > 0) {
    source = clauses.join(", ");
    clauses = [];
  }

  // Regex fallback from nodeText (e.g. Python "from x import y")
  if (!source && config.textFallbackPattern) {
    const match = nodeText.match(new RegExp(config.textFallbackPattern));
    if (match) {
      source = match[1] || "";
      if (match[2]) clauses = [match[2].trim()];
    }
  }

  // Build detail string (collapse multiline to single line)
  let detail: string | undefined;
  if (clauses.length > 0) {
    const clauseText = clauses
      .join(", ")
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s{2,}/g, " ");
    detail = hasTypeKeyword && !clauseText.startsWith("type") ? `type ${clauseText}` : clauseText;
  }

  // When source not found and config says detail should become name
  if (!source && config.detailAsNameWhenNoSource) {
    const keyword = label.split(" ")[0];
    const pattern = new RegExp(`^${keyword}\\s*`);
    let firstLine = nodeText.split("\n")[0].replace(pattern, "").trim();
    if (config.trimPatterns) {
      for (const tp of config.trimPatterns) {
        firstLine = firstLine.replace(new RegExp(tp), "").trim();
      }
    }
    return { name: detail || firstLine, detail: undefined };
  }

  // Fallback: strip the leading keyword (same as label) from nodeText
  if (!source) {
    const keyword = label.split(" ")[0]; // "import from" → "import"
    const pattern = new RegExp(`^${keyword}\\s+`);
    let firstLine = nodeText.split("\n")[0].replace(pattern, "").trim();
    // Apply trimPatterns from config
    if (config.trimPatterns) {
      for (const tp of config.trimPatterns) {
        firstLine = firstLine.replace(new RegExp(tp), "").trim();
      }
    }
    const cleanDetail = detail && firstLine.includes(detail) ? undefined : detail;
    return { name: firstLine, detail: cleanDetail };
  }

  return { name: source, detail };
}

/**
 * Resolve the effective label for a symbol, checking labelByChild if configured.
 * Scans direct children, matching by node type first, then by text content.
 */
function resolveLabel(cursor: TreeCursor, sym: SymbolKindConfig): string {
  if (!sym.labelByChild) return sym.label;
  if (!cursor.gotoFirstChild()) return sym.label;
  let resolved: string | undefined;
  do {
    const childType = cursor.nodeType;
    const childText = cursor.nodeText.trim();
    resolved = sym.labelByChild[childType] ?? sym.labelByChild[childText];
    if (resolved) break;
  } while (cursor.gotoNextSibling());
  cursor.gotoParent();
  return resolved ?? sym.label;
}

function scanName(cursor: TreeCursor, nameOf: NameOfConfig): string {
  if (!cursor.gotoFirstChild()) return "";
  const idTypes = new Set(nameOf.identifierTypes || []);
  const recTypes = new Set(nameOf.recurseTypes || []);
  const rawTypes = new Set(nameOf.rawTextTypes || []);
  let name = "";
  // Pass 1: find by field priority and recurse types
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
  } while (!name && cursor.gotoNextSibling());
  // Pass 2: fallback to identifierTypes if no name found
  if (!name) {
    cursor.gotoParent();
    if (!cursor.gotoFirstChild()) {
      return "";
    }
    do {
      const t = cursor.nodeType;
      if (idTypes.has(t)) {
        if (t !== "type_identifier" || cursor.currentFieldName !== "type") {
          name = cursor.nodeText;
          break;
        }
      }
    } while (cursor.gotoNextSibling());
  }
  cursor.gotoParent();
  return name;
}

function collectComments(
  tree: Tree,
  docstrings?: { nodeType: string; prefixes: string[] }[],
): { text: string; startLine: number; endLine: number }[] {
  const comments: { text: string; startLine: number; endLine: number }[] = [];
  const cursor = tree.walk();
  let descend = true;
  try {
    while (true) {
      if (cursor.currentDepth < 0) break;
      const t = cursor.nodeType;
      let isComment =
        t === "comment" ||
        t === "line_comment" ||
        t === "multiline_comment" ||
        t === "documentation_comment";
      // Config-driven docstring detection
      if (!isComment && docstrings) {
        for (const ds of docstrings) {
          if (t === ds.nodeType) {
            const text = cursor.nodeText.trim();
            if (ds.prefixes.some((p) => text.startsWith(p))) {
              isComment = true;
              break;
            }
          }
        }
      }
      if (isComment) {
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
    .replace(/^\s*\/\/\/? ?/gm, "")
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
    while (ci < comments.length && comments[ci].endLine < sym.startLine - 2) ci++;
    if (ci < comments.length) {
      const c = comments[ci];
      const gap = sym.startLine - c.endLine;
      if (gap === 1 || gap === 2) {
        sym.comment = cleanComment(c.text);
        ci++;
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
  const totalLines = source.endsWith("\n")
    ? source.split("\n").length - 1
    : source.split("\n").length;
  const tree = parser.parse(source);
  if (!tree) throw new Error("Failed to parse");

  let result: OutlineSymbol[] = [];
  const typeSet = new Set(req.symbols.flatMap((s) => s.types));
  const detailLabels = req.statementDetail
    ? new Set(req.statementDetail.labels || DEFAULT_DETAIL_LABELS)
    : null;
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
            const kind = resolveLabel(cursor, sym);
            let name = "";
            let detail: string | undefined;
            let useContentEndLine = false;
            if (sym.hasName) {
              if (detailLabels?.has(kind)) {
                const info = extractImportExportDetail(
                  cursor,
                  cursor.nodeText,
                  kind,
                  req.statementDetail!,
                );
                name = info.name;
                detail = info.detail;
                useContentEndLine = true;
              } else {
                name = scanName(cursor, req.nameOf);
              }
            }
            const startLine = cursor.startPosition.row + 1;
            // For statement-like symbols (import/export/package), compute endLine from
            // consecutive non-empty lines in nodeText. Some grammars (e.g. Kotlin) include
            // trailing whitespace/comments in the AST node span.
            let endLine: number;
            if (useContentEndLine) {
              const lines = cursor.nodeText.split("\n");
              let count = 0;
              for (const line of lines) {
                if (line.trim() === "") break;
                count++;
              }
              endLine = startLine + Math.max(count, 1) - 1;
            } else {
              endLine = cursor.endPosition.row + 1;
            }
            result.push({
              kind,
              name: sym.hasName ? name || `(anonymous ${kind})` : "",
              startLine,
              endLine,
              depth: declDepth,
              ...(detail ? { detail } : {}),
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
              // Detect if the wrapper node contains a "default" modifier keyword
              // (e.g. "export default function greet" → prefix becomes "export default ")
              let effectivePrefix = wrapper.prefix;
              const wNodeFirstLine = wCursor.nodeText.split("\n")[0];
              const prefixKeyword = wrapper.prefix.trim();
              const afterKeyword = wNodeFirstLine
                .slice(wNodeFirstLine.indexOf(prefixKeyword) + prefixKeyword.length)
                .trimStart();
              if (afterKeyword.startsWith("default ") || afterKeyword.startsWith("default\n")) {
                effectivePrefix = wrapper.prefix + "default ";
              }
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
                    if (r.kind.startsWith(effectivePrefix)) continue;
                    let inserted = false;
                    for (const existing of appliedPrefixes) {
                      if (r.kind.startsWith(existing)) {
                        r.kind = existing + effectivePrefix + r.kind.slice(existing.length);
                        inserted = true;
                        break;
                      }
                    }
                    if (!inserted) {
                      r.kind = effectivePrefix + r.kind;
                    }
                  }
                }
                // If wrapper has createContainerWhenCovered, create a container symbol
                // and nest the covered children under it
                if (wrapper.createContainerWhenCovered && wrapper.createStandaloneLabel) {
                  const label = wrapper.createStandaloneLabel;
                  let containerName: string;
                  let containerDetail: string | undefined;
                  if (detailLabels?.has(label)) {
                    const info = extractImportExportDetail(
                      wCursor,
                      wCursor.nodeText,
                      label,
                      req.statementDetail!,
                    );
                    containerName = info.name;
                    containerDetail = info.detail;
                  } else {
                    containerName = scanName(wCursor, req.nameOf);
                  }
                  // Increase depth of all covered children to nest under container
                  for (const r of result) {
                    if (r.startLine >= wStart && r.endLine <= wEnd) {
                      r.depth++;
                    }
                  }
                  result.push({
                    kind: label,
                    name: containerName || "{...}",
                    startLine: wStart,
                    endLine: wEnd,
                    depth: 0,
                    ...(containerDetail ? { detail: containerDetail } : {}),
                  });
                }
              } else if (wrapper.createStandaloneLabel) {
                const label = wrapper.createStandaloneLabel;
                let exportName: string;
                let exportDetail: string | undefined;
                if (detailLabels?.has(label)) {
                  const info = extractImportExportDetail(
                    wCursor,
                    wCursor.nodeText,
                    label,
                    req.statementDetail!,
                  );
                  exportName = info.name;
                  exportDetail = info.detail;
                } else {
                  exportName = scanName(wCursor, req.nameOf);
                }
                result.push({
                  kind: label,
                  name: exportName || "{...}",
                  startLine: wStart,
                  endLine: wEnd,
                  depth: 0,
                  ...(exportDetail ? { detail: exportDetail } : {}),
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
    const comments = collectComments(tree, req.docstrings);
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
