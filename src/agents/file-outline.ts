import { extname, join } from "path";
import { fork } from "node:child_process";

export interface OutlineSymbol {
  kind: string;
  name: string;
  startLine: number;
  endLine: number;
  comment?: string;
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

// ─── Language Config ─────────────────────────────────────────────────────────

interface SymbolKindConfig {
  types: string[];
  label: string;
  hasName: boolean;
  maxDepth?: number;
}

interface WrapperConfig {
  /** AST node type to detect, e.g. "export_statement", "ambient_declaration" */
  node: string;
  /** Prefix to add to wrapped declarations, e.g. "export ", "declare " */
  prefix: string;
  /** If no wrapped child is found, create a standalone entry with this label (e.g. "export") */
  createStandaloneLabel?: string;
  /** Only process symbols at depth <= this value. Default: Infinity (all depths). 0 = top-level only. */
  maxDepth?: number;
}

interface NameOfConfig {
  /** Field names to check first, in priority order (e.g. "name", "source", "module_name") */
  fieldPriority: string[];
  /** AST node types to recursively descend into to find a name (e.g. declarator chains) */
  recurseTypes: string[];
  /** AST node types that ARE identifiers (e.g. "identifier", "simple_identifier") */
  identifierTypes: string[];
  /** Special node types whose raw text IS the name (e.g. "destructor_name", "operator_name") */
  rawTextTypes?: string[];
}

const DEFAULT_NAME_OF: NameOfConfig = {
  fieldPriority: ["name"],
  recurseTypes: [],
  identifierTypes: ["identifier"],
};

interface LangConfig {
  name: string;
  extensions: string[];
  wasmFile: string;
  symbols: SymbolKindConfig[];
  wrappers: WrapperConfig[];
  nameOf: NameOfConfig;
}

const LANGUAGES: LangConfig[] = [
  {
    name: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-javascript.wasm"),
    symbols: [
      { types: ["function_declaration", "generator_function_declaration"], label: "function", hasName: true },
      { types: ["method_definition"], label: "method", hasName: true },
      { types: ["class_declaration"], label: "class", hasName: true },
      { types: ["lexical_declaration", "variable_declaration"], label: "const", hasName: true, maxDepth: 0 },
      { types: ["import_statement"], label: "import", hasName: true },
    ],
    wrappers: [
      { node: "export_statement", prefix: "export ", createStandaloneLabel: "export" },
    ],
    nameOf: {
      fieldPriority: ["name", "source"],
      recurseTypes: ["variable_declarator", "export_clause", "named_exports", "wildcard_export", "export_specifier"],
      identifierTypes: ["identifier", "type_identifier"],
    },
  },
  {
    name: "TypeScript",
    extensions: [".ts"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-typescript.wasm"),
    symbols: [
      { types: ["function_declaration", "generator_function_declaration"], label: "function", hasName: true },
      { types: ["method_definition"], label: "method", hasName: true },
      { types: ["class_declaration", "abstract_class_declaration"], label: "class", hasName: true },
      { types: ["interface_declaration"], label: "interface", hasName: true },
      { types: ["type_alias_declaration"], label: "type", hasName: true },
      { types: ["enum_declaration"], label: "enum", hasName: true },
      { types: ["internal_module"], label: "namespace", hasName: true },
      { types: ["property_signature"], label: "property", hasName: true },
      { types: ["lexical_declaration", "variable_declaration"], label: "const", hasName: true, maxDepth: 0 },
      { types: ["import_statement"], label: "import", hasName: true },
    ],
    wrappers: [
      { node: "export_statement", prefix: "export ", createStandaloneLabel: "export" },
      { node: "ambient_declaration", prefix: "declare ", maxDepth: 0 },
    ],
    nameOf: {
      fieldPriority: ["name", "source"],
      recurseTypes: ["variable_declarator", "export_clause", "named_exports", "wildcard_export", "export_specifier"],
      identifierTypes: ["identifier", "type_identifier"],
    },
  },
  {
    name: "TSX",
    extensions: [".tsx"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-tsx.wasm"),
    symbols: [
      { types: ["function_declaration", "generator_function_declaration"], label: "function", hasName: true },
      { types: ["method_definition"], label: "method", hasName: true },
      { types: ["class_declaration", "abstract_class_declaration"], label: "class", hasName: true },
      { types: ["interface_declaration"], label: "interface", hasName: true },
      { types: ["type_alias_declaration"], label: "type", hasName: true },
      { types: ["enum_declaration"], label: "enum", hasName: true },
      { types: ["internal_module"], label: "namespace", hasName: true },
      { types: ["lexical_declaration", "variable_declaration"], label: "const", hasName: true, maxDepth: 0 },
      { types: ["import_statement"], label: "import", hasName: true },
    ],
    wrappers: [
      { node: "export_statement", prefix: "export ", createStandaloneLabel: "export" },
    ],
    nameOf: {
      fieldPriority: ["name", "source"],
      recurseTypes: ["variable_declarator", "export_clause", "named_exports", "wildcard_export", "export_specifier"],
      identifierTypes: ["identifier", "type_identifier"],
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
  },
  {
    name: "Go",
    extensions: [".go"],
    wasmFile: join(process.treeSitterWasmPath, "tree-sitter-go.wasm"),
    symbols: [
      { types: ["function_declaration"], label: "function", hasName: true },
      { types: ["method_declaration"], label: "method", hasName: true },
      { types: ["type_spec"], label: "type", hasName: true },
      { types: ["field_declaration"], label: "field", hasName: true },
      { types: ["import_declaration"], label: "import", hasName: false },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: [],
      identifierTypes: ["identifier", "type_identifier", "field_identifier"],
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
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: ["declarator", "function_declarator", "array_declarator", "pointer_declarator", "variable_declarator"],
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
      { types: ["namespace_definition"], label: "namespace", hasName: true },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: ["declarator", "function_declarator", "array_declarator", "pointer_declarator", "reference_declarator", "variable_declarator"],
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
      { types: ["typealias_declaration"], label: "typealias", hasName: true },
      { types: ["import_declaration"], label: "import", hasName: true },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: [],
      identifierTypes: ["identifier", "type_identifier"],
    },
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
      { types: ["import_header"], label: "import", hasName: true },
      { types: ["package_header"], label: "package", hasName: true },
    ],
    wrappers: [],
    nameOf: {
      fieldPriority: ["name"],
      recurseTypes: [],
      identifierTypes: ["simple_identifier", "type_identifier"],
    },
  },
];

// ─── Child Process Management ────────────────────────────────────────────────
// Uses fork() instead of Worker() because V8 Zone OOM triggers process-level
// abort() — even a Worker thread kills the whole process.
// A child process has its own V8 instance and can safely crash.

let _child: ReturnType<typeof fork> | null = null;
let _reqId = 0;
const _pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let _childReady = false;
let _childInitPromise: Promise<void> | null = null;

function ensureChild(): Promise<void> {
  if (_childReady) return Promise.resolve();
  if (_childInitPromise) return _childInitPromise;

  _childInitPromise = new Promise<void>((resolve, reject) => {
    try {
      const modulePath = join(process.scriptsPath, "/worker-file-outline/worker.mjs");
      const child = fork(modulePath, [], { execArgv: [] });

      // Register handler BEFORE setting _child — prevent race with init_done message
      let timer: any = setTimeout(() => {
        child.kill();
        _childInitPromise = null; // allow retry on next request
        reject(new Error("Child init timed out"));
      }, 15000);

      child.on("message", function onMsg(msg: any) {
        if (msg.type === "init_done") {
          clearTimeout(timer);
          _childReady = true;
          resolve();
          return;
        }
        if (msg.type === "init_error") {
          clearTimeout(timer);
          reject(new Error(msg.error));
          return;
        }
        const p = _pending.get(msg.id);
        if (!p) return;
        _pending.delete(msg.id);
        if (msg.type === "result") p.resolve(msg.symbols);
        else if (msg.type === "error") p.reject(new Error(msg.error));
      });

      child.on("exit", (code: number) => {
        clearTimeout(timer);
        if (!_childReady) {
          _childInitPromise = null;
          reject(new Error("Child process crashed before init (code=" + code + "). This may indicate a missing WASM grammar file."));
        }
        _child = null;
        _childReady = false;
        for (const [id, p] of _pending) {
          p.reject(new Error("Parse worker process crashed (code=" + code + "). Retry the request to restart it."));
          _pending.delete(id);
        }
      });

      _child = child; // now safe — handler is registered
      child.send({ type: "init" }); // ← THIS was missing! Worker waits for init
    } catch (e: any) {
      _childInitPromise = null;
      reject(e);
    }
  });

  return _childInitPromise;
}

async function parseInChild(config: LangConfig, source: string): Promise<any[]> {
  await ensureChild();

  return new Promise((resolve, reject) => {
    const id = ++_reqId;
    const timer = setTimeout(() => {
      _pending.delete(id);
      if (_child) _child.kill(); // kill hung worker
      _child = null;
      _childReady = false;
      reject(new Error("Parse request timed out (30s)"));
    }, 30000);

    _pending.set(id, {
      resolve: (v: any) => { clearTimeout(timer); resolve(v); },
      reject: (e: Error) => { clearTimeout(timer); reject(e); },
    });

    if (!_child) {
      clearTimeout(timer);
      _pending.delete(id);
      reject(new Error("Parse process not available"));
      return;
    }

    _child.send({
      type: "parse",
      id,
      source,
      wasmFile: config.wasmFile,
      symbols: config.symbols,
      wrappers: config.wrappers,
      nameOf: config.nameOf,
    } as any);
  });
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function extractOutline(filePath: string, content: string): Promise<FileOutline> {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const ext = extname(filePath).toLowerCase();

  const config = LANGUAGES.find((c) => c.extensions.includes(ext));
  if (config) {
    try {
      const symbols = await parseInChild(config, content);
      return {
        filename: filePath,
        language: config.name,
        totalLines,
        symbols,
        supported: true,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[file-outline] parse failed: ${filePath} (${config.name}): ${msg}`);
      return {
        filename: filePath,
        language: config.name,
        totalLines,
        symbols: [],
        supported: false,
        error: `AST parse error: ${msg}`,
      };
    }
  }

  return {
    filename: filePath,
    language: ext.slice(1) || "unknown",
    totalLines,
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
    const cmt = sym.comment ? `  // ${sym.comment}` : "";
    const namePart = sym.name ? ` ${sym.name}` : "";
    l.push(`${indent}${sym.kind}${namePart} (${lr})${cmt}`);
  }
  if (outline.symbols.length > maxSymbols)
    l.push(`  ... and ${outline.symbols.length - maxSymbols} more symbols`);
  return l.join("\n");
}
