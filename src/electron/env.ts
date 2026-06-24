import { dirname, join } from "path";
import { fileURLToPath } from "url";
import fixPath from "fix-path";
fixPath();

const __dirname = dirname(fileURLToPath(import.meta.url));

process.rendererPath = join(__dirname, "../renderer");
process.scriptsPath = join(__dirname, "../scripts");

const resourcesPath =
  process.env.NODE_ENV === "development"
    ? join(__dirname, "../../resources")
    : process.resourcesPath;

process.treeSitterWasmPath = join(resourcesPath, "tree-sitter-wasm");
