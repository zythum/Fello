import { join } from "path";
import fixPath from "fix-path";
fixPath();

const currentDir = import.meta.dirname;

process.rendererPath = join(currentDir, "../renderer");
process.scriptsPath = join(currentDir, "../scripts");

const resourcesPath =
  process.env.NODE_ENV === "development"
    ? join(currentDir, "../../resources")
    : process.resourcesPath;

process.treeSitterWasmPath = join(resourcesPath, "tree-sitter-wasm");
