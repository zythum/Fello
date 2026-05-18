import { extname } from "path";
import { parse, Lang } from "@ast-grep/napi";
// SgNode type has complex generics; we use `any` for walk function
// since we only need basic traversal (kind, field, children, range)

// ─── Language Configuration ───────────────────────────────────────────────────

/**
 * @ast-grep/napi ships with these built-in languages:
 * TypeScript, JavaScript, Tsx, Html, Css
 *
 * Additional languages can be loaded via registerDynamicLanguage()
 * with a native dynamic library (.so/.dylib/.dll).
 * See: https://ast-grep.github.io/guide/api-usage/js-api.html
 */

interface SymbolKindConfig {
  /** ast-grep node kind name(s) to match */
  types: string[];
  /** Human-readable label */
  label: string;
  /** Whether to extract the name from a child "name" node */
  hasName: boolean;
}

interface LanguageConfig {
  lang: Lang;
  name: string;
  extensions: string[];
  symbols: SymbolKindConfig[];
}

const LANGUAGES: LanguageConfig[] = [
  {
    lang: Lang.TypeScript,
    name: "TypeScript",
    extensions: [".ts"],
    symbols: [
      { types: ["function_declaration"], label: "function", hasName: true },
      { types: ["method_definition"], label: "method", hasName: true },
      { types: ["class_declaration"], label: "class", hasName: true },
      { types: ["interface_declaration"], label: "interface", hasName: true },
      { types: ["type_alias_declaration"], label: "type", hasName: true },
      { types: ["enum_declaration"], label: "enum", hasName: true },
      { types: ["abstract_class_declaration"], label: "abstract class", hasName: true },
      { types: ["module"], label: "module", hasName: true },
      { types: ["ambient_declaration"], label: "declare", hasName: true },
      // Property signatures inside type/interface bodies
      { types: ["property_signature"], label: "property", hasName: true },
    ],
  },
  {
    lang: Lang.Tsx,
    name: "TSX",
    extensions: [".tsx"],
    symbols: [
      { types: ["function_declaration"], label: "function", hasName: true },
      { types: ["method_definition"], label: "method", hasName: true },
      { types: ["class_declaration"], label: "class", hasName: true },
      { types: ["interface_declaration"], label: "interface", hasName: true },
      { types: ["type_alias_declaration"], label: "type", hasName: true },
      { types: ["enum_declaration"], label: "enum", hasName: true },
    ],
  },
  {
    lang: Lang.JavaScript,
    name: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    symbols: [
      { types: ["function_declaration"], label: "function", hasName: true },
      { types: ["method_definition"], label: "method", hasName: true },
      { types: ["class_declaration"], label: "class", hasName: true },
      { types: ["arrow_function"], label: "arrow function", hasName: false },
    ],
  },
];

// ─── Outline Extraction ───────────────────────────────────────────────────────

export interface OutlineSymbol {
  kind: string;
  name: string;
  startLine: number;
  endLine: number;
  /** First line of the preceding JSDoc/comment block, if any */
  comment?: string;
  /** Nesting depth: 0 = top-level declaration, 1 = direct property of type/interface, etc. */
  depth: number;
}

export interface FileOutline {
  filename: string;
  language: string;
  totalLines: number;
  symbols: OutlineSymbol[];
  supported: boolean;
  error?: string;
}

function getConfig(filePath: string): { config: LanguageConfig; langName: string } | null {
  const ext = extname(filePath).toLowerCase();
  for (const config of LANGUAGES) {
    if (config.extensions.includes(ext)) {
      return { config, langName: config.name };
    }
  }
  return null;
}

/**
 * Extract a structural outline from source code using ast-grep AST parsing.
 * Returns function/class/interface/type signatures with line ranges.
 */
export async function extractOutline(filePath: string, content: string): Promise<FileOutline> {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const detected = getConfig(filePath);

  if (!detected) {
    return {
      filename: filePath,
      language: extname(filePath).slice(1) || "unknown",
      totalLines,
      symbols: [],
      supported: false,
    };
  }

  const { config, langName } = detected;

  try {
    const ast = parse(config.lang, content);
    const root = ast.root();
    const symbols: OutlineSymbol[] = [];

    // Build a flat set of all target node types for fast lookup
    const typeSet = new Set<string>();
    for (const sym of config.symbols) {
      for (const t of sym.types) {
        typeSet.add(t);
      }
    }

    // Helper: find leading comment for a node.
    // In `export interface Foo {}`, the comment is before `export_statement`, not before `interface_declaration`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function findLeadingComment(node: any): string | null {
      // Try direct previous sibling first
      const prev = node.prev();
      if (prev && prev.kind() === "comment") return prev.text();
      // If parent is export_statement/export, try the parent's previous sibling
      const parent = node.parent();
      if (parent && (parent.kind() === "export_statement" || parent.kind() === "export")) {
        const parentPrev = parent.prev();
        if (parentPrev && parentPrev.kind() === "comment") return parentPrev.text();
      }
      return null;
    }

    // Recursively walk the AST, tracking nesting depth for tree view.
    // `insideProp` tracks whether we're inside a property_signature's value type.
    // We only collect property_signature nodes that are direct children of
    // type_alias_declaration or interface_declaration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function walk(node: any, depth = 0, insideProp = false): void {
      const kind = node.kind();
      const isTopType = kind === "type_alias_declaration" || kind === "interface_declaration";
      const isProperty = kind === "property_signature";
      // Collect property_signature only when directly inside a top-level type (not inside a nested object type)
      const shouldCollect = isProperty && depth >= 1 && !insideProp;
      // Collect top-level declarations (not property_signature)
      const isDeclaration = typeSet.has(kind) && !isProperty;

      if (isDeclaration || shouldCollect) {
        for (const sym of config.symbols) {
          if (sym.types.includes(kind)) {
            let name = "";
            if (sym.hasName) {
              const nameNode = node.field("name");
              if (nameNode) {
                name = nameNode.text();
              } else {
                // Fallback: first identifier child
                for (const child of node.children()) {
                  if (child.kind() === "identifier") {
                    name = child.text();
                    break;
                  }
                }
              }
            }
            const range = node.range();
            const commentText = findLeadingComment(node);
            const comment = commentText ? extractCommentSummary(commentText) : undefined;

            symbols.push({
              kind: sym.label,
              name: name || `(anonymous ${sym.label})`,
              startLine: range.start.line + 1, // 1-based
              endLine: range.end.line + 1,
              comment,
              depth: isDeclaration ? 0 : depth,
            });
            break;
          }
        }
      }
      // Recurse into children.
      // - Top-level type/interface: children are at depth 1, insideProp remains as-is
      // - Property signature: children are inside its type value, mark insideProp=true to skip nested properties
      const nextDepth = isTopType ? 1 : isProperty ? depth + 1 : depth;
      const nextInsideProp = isProperty ? true : insideProp;
      for (const child of node.children()) {
        walk(child, nextDepth, nextInsideProp);
      }
    }

    walk(root);

    // Sort by line
    symbols.sort((a, b) => a.startLine - b.startLine);

    return {
      filename: filePath,
      language: langName,
      totalLines,
      symbols,
      supported: true,
    };
  } catch (error) {
    return {
      filename: filePath,
      language: langName,
      totalLines,
      symbols: [],
      supported: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Extract the first meaningful line from a comment block.
 */
function extractCommentSummary(comment: string): string {
  // Strip comment markers: /*, */, //, *, and leading/trailing whitespace
  const lines = comment
    .split("\n")
    .map((line) =>
      line
        .replace(/^\/\*+/gm, "")
        .replace(/\*+\/$/gm, "")
        .replace(/^\s*\*[ \t]?/gm, "")
        .replace(/^\/\/[ \t]?/gm, "")
        .trim(),
    )
    .filter((line) => line.length > 0);

  if (lines.length === 0) return "";
  const first = lines[0]!;
  // Truncate long first lines to keep the outline compact
  return first.length > 60 ? first.slice(0, 57) + "..." : first;
}

/**
 * Get a human-readable summary string for the outline (for LLM consumption).
 */
export function outlineToSummary(outline: FileOutline, maxSymbols = 80): string {
  const lines: string[] = [];
  lines.push(`File: ${outline.filename}`);
  lines.push(`Language: ${outline.language}`);
  lines.push(`Total lines: ${outline.totalLines}`);

  if (!outline.supported && outline.symbols.length === 0) {
    lines.push(
      outline.error
        ? `Note: ${outline.error}`
        : "Note: Language not supported for AST parsing. Use ReadFile with line/limit parameters.",
    );
    return lines.join("\n");
  }

  if (outline.symbols.length === 0) {
    lines.push("No top-level symbols found in this file.");
    return lines.join("\n");
  }

  lines.push("─── Symbols ───");
  const shown = outline.symbols.slice(0, maxSymbols);
  for (const sym of shown) {
    const indent = "    ".repeat(sym.depth);
    const lineRange =
      sym.startLine === sym.endLine
        ? `line ${sym.startLine}`
        : `lines ${sym.startLine}-${sym.endLine}`;
    const comment = sym.comment ? `  // ${sym.comment}` : "";
    lines.push(`${indent}${sym.kind} ${sym.name} (${lineRange})${comment}`);
  }
  if (outline.symbols.length > maxSymbols) {
    lines.push(`  ... and ${outline.symbols.length - maxSymbols} more symbols`);
  }

  return lines.join("\n");
}
