// Shared types between file-outline.ts and worker-file-outline/worker.ts

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

export interface SymbolKindConfig {
  types: string[];
  label: string;
  hasName: boolean;
  maxDepth?: number;
}

export interface WrapperConfig {
  node: string;
  prefix: string;
  createStandaloneLabel?: string;
  maxDepth?: number;
}

export interface NameOfConfig {
  fieldPriority: string[];
  recurseTypes: string[];
  identifierTypes: string[];
  rawTextTypes?: string[];
}

export interface FileOutlineWorkerRequest {
  filePath: string;
  wasmFile: string;
  symbols: SymbolKindConfig[];
  wrappers: WrapperConfig[];
  nameOf: NameOfConfig;
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
