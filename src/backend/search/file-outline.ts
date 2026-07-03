import { extname, join, isAbsolute, resolve, relative } from "path";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { fork } from "child_process";
import type {
  OutlineSymbol,
  FileOutline,
  SymbolKindConfig,
  WrapperConfig,
  NameOfConfig,
  StatementDetailConfig,
  FileOutlineWorkerRequest,
  FileOutlineWorkerResponse,
} from "../../shared/zod/worker-file-outline-schema";

export type { OutlineSymbol, FileOutline } from "../../shared/zod/worker-file-outline-schema";

// ─── Path Normalization ──────────────────────────────────────────────────────

function normalizePath(inputPath: string, cwd: string): string {
  if (inputPath.startsWith("file://")) {
    return fileURLToPath(inputPath);
  }
  if (isAbsolute(inputPath)) {
    return inputPath;
  }
  return resolve(cwd, inputPath);
}

// ─── Language Config ─────────────────────────────────────────────────────────

interface LangConfig {
  name: string;
  extensions: string[];
  wasmFile: string;
  symbols: SymbolKindConfig[];
  wrappers: WrapperConfig[];
  nameOf: NameOfConfig;
  statementDetail?: StatementDetailConfig;
  docstrings?: { nodeType: string; prefixes: string[] }[];
}

const LANGUAGES: LangConfig[] = [
  {
    name: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-javascript.wasm"),
    symbols: [
      {
        types: ["function_declaration", "generator_function_declaration"],
        label: "function",
        hasName: true,
      },
      { types: ["method_definition"], label: "method", hasName: true },
      { types: ["class_declaration"], label: "class", hasName: true },
      {
        types: ["lexical_declaration"],
        label: "variable",
        hasName: true,
        maxDepth: 0,
        labelByChild: { const: "const", let: "let" },
      },
      { types: ["variable_declaration"], label: "var", hasName: true, maxDepth: 0 },
      { types: ["import_statement"], label: "import", hasName: true },
    ],
    wrappers: [{ node: "export_statement", prefix: "export ", createStandaloneLabel: "export" }],
    nameOf: {
      fieldPriority: ["name", "source"],
      recurseTypes: [
        "variable_declarator",
        "export_clause",
        "named_exports",
        "wildcard_export",
        "export_specifier",
      ],
      identifierTypes: ["identifier", "type_identifier"],
    },
    statementDetail: {
      sourceFields: ["source"],
      sourceTypes: ["string"],
      clauseTypes: ["import_clause", "named_imports", "named_exports", "export_clause", "namespace_import"],
      typeKeywordTypes: ["type"],
      detailAsNameWhenNoSource: true,
    },
  },
  {
    name: "TypeScript",
    extensions: [".ts"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-typescript.wasm"),
    symbols: [
      {
        types: ["function_declaration", "generator_function_declaration", "function_signature"],
        label: "function",
        hasName: true,
      },
      { types: ["method_definition", "abstract_method_signature"], label: "method", hasName: true },
      { types: ["class_declaration", "abstract_class_declaration"], label: "class", hasName: true },
      { types: ["interface_declaration"], label: "interface", hasName: true },
      { types: ["type_alias_declaration"], label: "type", hasName: true },
      { types: ["enum_declaration"], label: "enum", hasName: true },
      { types: ["internal_module"], label: "namespace", hasName: true },
      { types: ["property_signature"], label: "property", hasName: true, maxDepth: 1 },
      // object_type acts as a depth barrier to prevent property_signature inside
      // generic constraints or type arguments from being misidentified as real properties
      { types: ["object_type"], label: "_", hasName: false, maxDepth: -1 },
      {
        types: ["lexical_declaration"],
        label: "variable",
        hasName: true,
        maxDepth: 0,
        labelByChild: { const: "const", let: "let" },
      },
      { types: ["variable_declaration"], label: "var", hasName: true, maxDepth: 0 },
      { types: ["import_statement"], label: "import", hasName: true },
    ],
    wrappers: [
      { node: "export_statement", prefix: "export ", createStandaloneLabel: "export" },
      { node: "ambient_declaration", prefix: "declare ", maxDepth: 0, createStandaloneLabel: "declare", createContainerWhenCovered: true },
    ],
    nameOf: {
      fieldPriority: ["name", "source"],
      recurseTypes: [
        "variable_declarator",
        "export_clause",
        "named_exports",
        "wildcard_export",
        "export_specifier",
      ],
      identifierTypes: ["identifier", "type_identifier"],
    },
    statementDetail: {
      labels: ["import", "export", "declare"],
      sourceFields: ["source"],
      sourceTypes: ["string"],
      clauseTypes: ["import_clause", "named_imports", "named_exports", "export_clause", "namespace_import"],
      typeKeywordTypes: ["type"],
      trimPatterns: ["\\s*\\{\\s*$"],
      detailAsNameWhenNoSource: true,
    },
  },
  {
    name: "TSX",
    extensions: [".tsx"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-tsx.wasm"),
    symbols: [
      {
        types: ["function_declaration", "generator_function_declaration", "function_signature"],
        label: "function",
        hasName: true,
      },
      { types: ["method_definition"], label: "method", hasName: true },
      { types: ["class_declaration", "abstract_class_declaration"], label: "class", hasName: true },
      { types: ["interface_declaration"], label: "interface", hasName: true },
      { types: ["type_alias_declaration"], label: "type", hasName: true },
      { types: ["enum_declaration"], label: "enum", hasName: true },
      { types: ["internal_module"], label: "namespace", hasName: true },
      {
        types: ["lexical_declaration"],
        label: "variable",
        hasName: true,
        maxDepth: 0,
        labelByChild: { const: "const", let: "let" },
      },
      { types: ["variable_declaration"], label: "var", hasName: true, maxDepth: 0 },
      { types: ["import_statement"], label: "import", hasName: true },
    ],
    wrappers: [{ node: "export_statement", prefix: "export ", createStandaloneLabel: "export" }],
    nameOf: {
      fieldPriority: ["name", "source"],
      recurseTypes: [
        "variable_declarator",
        "export_clause",
        "named_exports",
        "wildcard_export",
        "export_specifier",
      ],
      identifierTypes: ["identifier", "type_identifier"],
    },
    statementDetail: {
      sourceFields: ["source"],
      sourceTypes: ["string"],
      clauseTypes: ["import_clause", "named_imports", "named_exports", "export_clause", "namespace_import"],
      typeKeywordTypes: ["type"],
      detailAsNameWhenNoSource: true,
    },
  },
  {
    name: "Python",
    extensions: [".py"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-python.wasm"),
    symbols: [
      { types: ["function_definition"], label: "function", hasName: true },
      { types: ["class_definition"], label: "class", hasName: true },
      { types: ["import_statement"], label: "import", hasName: true },
      { types: ["import_from_statement"], label: "import from", hasName: true },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name", "module_name"],
      recurseTypes: [],
      identifierTypes: ["identifier"],
    },
    statementDetail: {
      sourceFields: ["module_name"],
      clauseTypes: ["dotted_name", "aliased_import", "wildcard_import"],
      clausesAsSource: true,
      textFallbackPattern: "^from\\s+(\\S+)\\s+import\\s+(.+)",
    },
    docstrings: [{ nodeType: "expression_statement", prefixes: ['"""', "'''"] }],
  },
  {
    name: "Go",
    extensions: [".go"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-go.wasm"),
    symbols: [
      { types: ["package_clause"], label: "package", hasName: true },
      { types: ["function_declaration"], label: "function", hasName: true },
      { types: ["method_declaration"], label: "method", hasName: true },
      { types: ["type_spec"], label: "type", hasName: true },
      { types: ["field_declaration"], label: "field", hasName: true },
      { types: ["const_spec"], label: "const", hasName: true },
      { types: ["import_declaration"], label: "import", hasName: false },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: [],
      identifierTypes: ["identifier", "type_identifier", "field_identifier", "package_identifier"],
    },
  },
  {
    name: "C",
    extensions: [".c", ".h"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-c.wasm"),
    symbols: [
      { types: ["function_definition"], label: "function", hasName: true },
      { types: ["struct_specifier"], label: "struct", hasName: true, maxDepth: 0 },
      { types: ["union_specifier"], label: "union", hasName: true, maxDepth: 0 },
      { types: ["enum_specifier"], label: "enum", hasName: true, maxDepth: 0 },
      { types: ["type_definition"], label: "typedef", hasName: true },
      { types: ["declaration"], label: "var", hasName: true, maxDepth: 0 },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: [
        "declarator",
        "function_declarator",
        "array_declarator",
        "pointer_declarator",
        "parenthesized_declarator",
        "variable_declarator",
      ],
      identifierTypes: ["identifier", "type_identifier", "field_identifier"],
    },
  },
  {
    name: "C++",
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".hh"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-cpp.wasm"),
    symbols: [
      { types: ["function_definition"], label: "function", hasName: true },
      { types: ["class_specifier"], label: "class", hasName: true },
      { types: ["struct_specifier"], label: "struct", hasName: true, maxDepth: 0 },
      { types: ["union_specifier"], label: "union", hasName: true, maxDepth: 0 },
      { types: ["enum_specifier"], label: "enum", hasName: true, maxDepth: 0 },
      { types: ["type_definition"], label: "typedef", hasName: true },
      { types: ["alias_declaration"], label: "using", hasName: true },
      { types: ["declaration"], label: "var", hasName: true, maxDepth: 0 },
      { types: ["namespace_definition"], label: "namespace", hasName: true },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: [
        "declarator",
        "function_declarator",
        "array_declarator",
        "pointer_declarator",
        "parenthesized_declarator",
        "reference_declarator",
        "variable_declarator",
        "init_declarator",
      ],
      identifierTypes: ["identifier", "type_identifier", "field_identifier"],
      rawTextTypes: ["destructor_name", "operator_name"],
    },
  },
  {
    name: "Swift",
    extensions: [".swift"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-swift.wasm"),
    symbols: [
      { types: ["class_declaration"], label: "declaration", hasName: true },
      { types: ["protocol_declaration"], label: "protocol", hasName: true },
      { types: ["function_declaration"], label: "function", hasName: true },
      { types: ["method_declaration"], label: "method", hasName: true },
      { types: ["init_declaration"], label: "init", hasName: false },
      { types: ["subscript_declaration"], label: "subscript", hasName: false },
      { types: ["typealias_declaration"], label: "typealias", hasName: true },
      {
        types: ["property_declaration"],
        label: "property",
        hasName: true,
        labelByChild: { "let": "let", "var": "var" },
      },
      { types: ["import_declaration"], label: "import", hasName: true },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: [],
      identifierTypes: ["identifier", "type_identifier"],
    },
    statementDetail: {},
  },
  {
    name: "Kotlin",
    extensions: [".kt", ".kts"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-kotlin.wasm"),
    symbols: [
      { types: ["class_declaration"], label: "declaration", hasName: true },
      { types: ["function_declaration"], label: "function", hasName: true },
      { types: ["object_declaration"], label: "object", hasName: true },
      { types: ["type_alias"], label: "typealias", hasName: true },
      {
        types: ["property_declaration"],
        label: "property",
        hasName: true,
        labelByChild: { val: "val", var: "var" },
      },
      { types: ["import_header"], label: "import", hasName: true },
      { types: ["package_header"], label: "package", hasName: true },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: ["variable_declaration"],
      identifierTypes: ["simple_identifier", "type_identifier"],
    },
    statementDetail: {
      labels: ["import", "package"],
    },
  },
  {
    name: "Dart",
    extensions: [".dart"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-dart.wasm"),
    symbols: [
      { types: ["class_definition"], label: "class", hasName: true },
      { types: ["enum_declaration"], label: "enum", hasName: true },
      { types: ["mixin_declaration"], label: "mixin", hasName: true },
      { types: ["extension_declaration"], label: "extension", hasName: true },
      { types: ["extension_type_declaration"], label: "extension type", hasName: true },
      { types: ["function_signature"], label: "function", hasName: true, maxDepth: 0 },
      { types: ["method_signature"], label: "method", hasName: true, labelByChild: { factory_constructor_signature: "factory" } },
      { types: ["getter_signature"], label: "getter", hasName: true },
      { types: ["setter_signature"], label: "setter", hasName: true },
      { types: ["constructor_signature", "constant_constructor_signature"], label: "constructor", hasName: true },
      { types: ["type_alias"], label: "typedef", hasName: true },
      { types: ["library_import"], label: "import", hasName: true },
      { types: ["library_export"], label: "export", hasName: true },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: [
        "function_signature",
        "factory_constructor_signature",
        "getter_signature",
        "setter_signature",
        "library_import",
        "library_export",
        "import_specification",
        "configurable_uri",
        "uri",
      ],
      identifierTypes: ["identifier", "type_identifier"],
      rawTextTypes: ["string_literal"],
    },
    statementDetail: {
      labels: ["import", "export", "factory"],
      sourceTypes: ["configurable_uri", "uri", "import_specification", "string_literal"],
      clauseTypes: ["combinator"],
      trimPatterns: ["\\(.*$"],
    },
  },
];

// ─── Child Process (disposable, one fork per request) ────────────────────────

async function parseInChild(
  filePath: string,
  config: LangConfig,
  cwd: string,
  timeout = 30000,
): Promise<{ symbols: OutlineSymbol[]; totalLines: number }> {
  return new Promise((resolve, reject) => {
    const modulePath = join(process.scriptsPath, "/worker-file-outline/worker.mjs");
    const child = fork(modulePath, [], { execArgv: [], cwd });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Parse request timed out (${timeout}ms)`));
    }, timeout);

    child.on("message", (msg: FileOutlineWorkerResponse) => {
      clearTimeout(timer);
      if (msg.type === "result") resolve({ symbols: msg.symbols, totalLines: msg.totalLines });
      else reject(new Error(msg.error));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code && code !== 0) reject(new Error(`Parse worker exit ${code}`));
    });

    const request: FileOutlineWorkerRequest = {
      filePath,
      wasmFile: config.wasmFile,
      symbols: config.symbols,
      wrappers: config.wrappers,
      nameOf: config.nameOf,
      statementDetail: config.statementDetail,
      docstrings: config.docstrings,
    };
    child.send(request);
  });
}

// ─── Markdown Parser (built-in, no WASM needed) ──────────────────────────────

function parseMarkdown(content: string): { symbols: OutlineSymbol[]; totalLines: number } {
  const lines = content.split("\n");
  const totalLines = content.endsWith("\n") ? lines.length - 1 : lines.length;
  const symbols: OutlineSymbol[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Toggle fenced code block state
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // ATX headings
    const headingMatch = line.match(/^ {0,3}(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].replace(/\s+#+\s*$/, "").trim();
      symbols.push({
        kind: `h${level}`,
        name: text,
        startLine: i + 1,
        endLine: i + 1,
        depth: level - 1,
      });
    }
  }

  // Compute endLine: each heading extends until the next heading of same or higher level (or EOF)
  for (let i = 0; i < symbols.length; i++) {
    const level = symbols[i].depth;
    let endLine = lines.length;
    for (let j = i + 1; j < symbols.length; j++) {
      if (symbols[j].depth <= level) {
        endLine = symbols[j].startLine - 1;
        break;
      }
    }
    symbols[i].endLine = endLine;
  }

  return { symbols, totalLines };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

const MARKDOWN_EXTENSIONS = [".md", ".mdx", ".markdown"];

export interface FileOutlineOptions {
  projectDir: string;
  path: string;
  timeout?: number;
}

export async function extractOutline(options: FileOutlineOptions): Promise<FileOutline> {
  let filename = normalizePath(options.path, options.projectDir);
  const relativeFilename = relative(options.projectDir, filename);
  if (relativeFilename && !relativeFilename.startsWith("..")) {
    filename = relativeFilename;
  }

  const ext = extname(filename).toLowerCase();

  // Markdown: use built-in parser (tree-sitter-markdown WASM has known limitations)
  if (MARKDOWN_EXTENSIONS.includes(ext)) {
    const content = await readFile(normalizePath(filename, options.projectDir), "utf8");
    const { symbols, totalLines } = parseMarkdown(content);
    return {
      filename: filename,
      language: "Markdown",
      totalLines,
      symbols,
      supported: true,
    };
  }

  const config = LANGUAGES.find((c) => c.extensions.includes(ext));
  if (config) {
    try {
      const { symbols, totalLines } = await parseInChild(
        filename,
        config,
        options.projectDir,
        options.timeout,
      );
      return {
        filename: filename,
        language: config.name,
        totalLines,
        symbols,
        supported: true,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[file-outline] parse failed: ${filename} (${config.name}): ${msg}`);
      return {
        filename: filename,
        language: config.name,
        totalLines: 0,
        symbols: [],
        supported: false,
        error: `AST parse error: ${msg}`,
      };
    }
  }

  return {
    filename: filename,
    language: ext.slice(1) || "unknown",
    totalLines: 0,
    symbols: [],
    supported: false,
  };
}

// ─── Summary Formatter ────────────────────────────────────────────────────────

export function outlineToSummary(outline: FileOutline, maxSymbols = 128): string {
  const l: string[] = [];
  l.push(`File: ${outline.filename}`);
  l.push(`Language: ${outline.language}`);
  l.push(`Total lines: ${outline.totalLines}`);

  if (!outline.supported && outline.symbols.length === 0) {
    l.push(
      outline.error ? `Note: ${outline.error}` : "Note: Language not supported for AST parsing.",
    );
    if (outline.error?.includes("Grammar not found")) {
      l.push("  Run 'npm run download:grammars' to install language parsers.");
    }
    return l.join("\n");
  }
  if (outline.symbols.length === 0) {
    l.push("No top-level symbols found in this file.");
    return l.join("\n");
  }

  l.push("─── Symbols ───");
  const shown = outline.symbols.slice(0, maxSymbols);
  for (const sym of shown) {
    const indent = "    ".repeat(sym.depth);
    const lr =
      sym.startLine === sym.endLine
        ? `line ${sym.startLine}`
        : `lines ${sym.startLine}-${sym.endLine}`;
    const namePart = sym.name ? ` ${sym.name}` : "";
    const detailPart = sym.detail ? `: ${sym.detail}` : "";
    if (sym.comment) {
      l.push(`${indent}# ${sym.comment}`);
    }
    l.push(`${indent}${sym.kind}${namePart}${detailPart} (${lr})`);
  }
  if (outline.symbols.length > maxSymbols)
    l.push(`  ... and ${outline.symbols.length - maxSymbols} more symbols`);
  return l.join("\n");
}

// ─── Public Interface ────────────────────────────────────────────────────────

export async function fileOutline(options: FileOutlineOptions): Promise<{ outline: string }> {
  const outline = await extractOutline(options);
  const summary = outlineToSummary(outline);
  return { outline: summary };
}
