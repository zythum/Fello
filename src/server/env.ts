import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

process.rendererPath = join(__dirname, '../renderer');
process.scriptsPath = join(__dirname, '../scripts');

const resourcesPath = join(__dirname, '../../resources');

process.treeSitterWasmPath = join(resourcesPath, 'tree-sitter-wasm');