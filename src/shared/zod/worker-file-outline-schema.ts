// Shared types between file-outline.ts and worker-file-outline/worker.ts

export interface OutlineSymbol {
  kind: string;
  name: string;
  startLine: number;
  endLine: number;
  comment?: string;
  depth: number;
  /** Supplementary info for imports/exports: binding details, specifiers, etc. */
  detail?: string;
}

export interface FileOutline {
  filename: string;
  language: string;
  totalLines: number;
  symbols: OutlineSymbol[];
  supported: boolean;
  error?: string;
}

export interface SymbolKindConfig {
  types: string[];
  label: string;
  hasName: boolean;
  maxDepth?: number;
  /** Override label based on a child node's type. e.g. { "let": "let" } */
  labelByChild?: Record<string, string>;
}

export interface WrapperConfig {
  node: string;
  prefix: string;
  createStandaloneLabel?: string;
  maxDepth?: number;
  /** When true AND covered, also create a container symbol and nest children. */
  createContainerWhenCovered?: boolean;
}

export interface NameOfConfig {
  fieldPriority: string[];
  recurseTypes: string[];
  identifierTypes: string[];
  rawTextTypes?: string[];
}

/**
 * Declarative config for extracting structured details from statement-like symbols
 * (imports, exports, package declarations, etc.).
 * The worker uses this to find source (→ name) and specifiers (→ detail)
 * without any language-specific code.
 */
export interface StatementDetailConfig {
  /**
   * Which symbol labels should use detail extraction instead of scanName.
   * e.g. ["import", "export"] or ["import", "import from", "export", "package"]
   * If omitted, defaults to all symbols with labels containing "import" or "export".
   */
  labels?: string[];
  /** AST node fields whose text is the source path (e.g. ["source", "module_name"]) */
  sourceFields?: string[];
  /**
   * AST node types that contain the source string.
   * Worker will read text directly, or recurse one level to find a string literal.
   * e.g. ["string", "string_literal", "configurable_uri"]
   */
  sourceTypes?: string[];
  /**
   * AST node types that represent binding/specifier clauses (→ detail).
   * e.g. ["import_clause", "named_imports", "export_clause", "combinator"]
   */
  clauseTypes?: string[];
  /**
   * AST node types that indicate type-only imports (prefixes detail with "type").
   * e.g. ["type"]
   */
  typeKeywordTypes?: string[];
  /**
   * When source is not found but clauses exist, treat clauses as the source name.
   * Used for languages where `import x.y.z` has no string literal source.
   * Default: false
   */
  clausesAsSource?: boolean;
  /**
   * Regex applied to nodeText to extract source (group 1) and detail (group 2)
   * as a last-resort fallback before using raw nodeText.
   * e.g. "^from\\s+(\\S+)\\s+import\\s+(.+)" for Python from-import.
   */
  textFallbackPattern?: string;
  /**
   * Patterns to trim from the end of fallback names.
   * Applied in order after keyword stripping.
   * e.g. ["\\s*\\{\\s*$"] to remove trailing `{` in C-like languages.
   */
  trimPatterns?: string[];
  /**
   * When source is not found, use detail as the name instead.
   * Useful for re-export lists like `export { a, b }` where there's no source module.
   * Default: false
   */
  detailAsNameWhenNoSource?: boolean;
}

export interface FileOutlineWorkerRequest {
  filePath: string;
  wasmFile: string;
  symbols: SymbolKindConfig[];
  wrappers: WrapperConfig[];
  nameOf: NameOfConfig;
  /** Descendants of these AST node types are not scanned for symbols. */
  symbolScanBoundaryTypes?: string[];
  /** Config for statement detail extraction (imports, exports, packages, etc.). */
  statementDetail?: StatementDetailConfig;
  /**
   * Node types whose text should be treated as docstring comments.
   * The node text must start with one of the specified prefixes to qualify.
   * e.g. [{ nodeType: "expression_statement", prefixes: ["\"\"\"", "'''"] }]
   */
  docstrings?: { nodeType: string; prefixes: string[] }[];
}

export interface FileOutlineWorkerResult {
  type: "result";
  symbols: OutlineSymbol[];
  totalLines: number;
}

export interface FileOutlineWorkerError {
  type: "error";
  error: string;
}

export type FileOutlineWorkerResponse = FileOutlineWorkerResult | FileOutlineWorkerError;
