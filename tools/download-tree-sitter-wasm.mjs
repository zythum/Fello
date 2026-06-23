#!/usr/bin/env node

/**
 * Download tree-sitter .wasm grammar files for supported languages.
 *
 * Downloads from GitHub releases of each grammar repository.
 * Places them in resources/tree-sitter-wasm/ for:
 *   - Development: accessible at project root
 *   - Production (Electron): bundled via extraResources
 *
 * Uses fetch() with automatic fallback to curl if fetch fails.
 */

import { mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "resources", "tree-sitter-wasm");

const LANGUAGES = [
  { name: "JavaScript",      wasmFile: "tree-sitter-javascript.wasm",  owner: "tree-sitter",      repo: "tree-sitter-javascript",  asset: "tree-sitter-javascript.wasm" },
  { name: "TypeScript",      wasmFile: "tree-sitter-typescript.wasm",  owner: "tree-sitter",      repo: "tree-sitter-typescript",  asset: "tree-sitter-typescript.wasm" },
  { name: "TSX",             wasmFile: "tree-sitter-tsx.wasm",         owner: "tree-sitter",      repo: "tree-sitter-typescript",  asset: "tree-sitter-tsx.wasm" },
  { name: "Python",          wasmFile: "tree-sitter-python.wasm",      owner: "tree-sitter",      repo: "tree-sitter-python",      asset: "tree-sitter-python.wasm" },
  { name: "Go",              wasmFile: "tree-sitter-go.wasm",          owner: "tree-sitter",      repo: "tree-sitter-go",          asset: "tree-sitter-go.wasm" },
  { name: "C",               wasmFile: "tree-sitter-c.wasm",           owner: "tree-sitter",      repo: "tree-sitter-c",           asset: "tree-sitter-c.wasm" },
  { name: "C++",             wasmFile: "tree-sitter-cpp.wasm",         owner: "tree-sitter",      repo: "tree-sitter-cpp",         asset: "tree-sitter-cpp.wasm" },
  { name: "Swift",           wasmFile: "tree-sitter-swift.wasm",       owner: "alex-pinkus",      repo: "tree-sitter-swift",       asset: "tree-sitter-swift.wasm" },
  { name: "Kotlin",          wasmFile: "tree-sitter-kotlin.wasm",      owner: "fwcd",             repo: "tree-sitter-kotlin",      asset: "tree-sitter-kotlin.wasm" },
];

function formatSize(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Download using fetch(). Returns buffer on success, null on failure.
 */
async function tryFetch(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`    fetch: HTTP ${response.status}`);
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error(`    fetch: ${err.message}`);
    return null;
  }
}

/**
 * Download using curl. Returns buffer on success, null on failure.
 */
function tryCurl(url) {
  try {
    const stdout = execSync(`curl -sL "${url}"`, { 
      encoding: "buffer",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stdout.length === 0) {
      console.error("    curl: empty response");
      return null;
    }
    return stdout;
  } catch (err) {
    console.error(`    curl: ${err.message}`);
    return null;
  }
}

async function downloadTo(lang, url, destPath) {
  // Try fetch first (faster, native)
  let buffer = await tryFetch(url);
  if (!buffer) {
    // Fallback to curl
    buffer = tryCurl(url);
  }
  if (!buffer) {
    throw new Error(`All download methods failed for ${url}`);
  }
  await writeFile(destPath, buffer);
  console.log(`  ✓ ${lang.wasmFile} (${formatSize(buffer.length)})`);
}

async function main() {
  const startTime = Date.now();

  // Check if files already exist
  await mkdir(OUT_DIR, { recursive: true });

  // Check existing files
  const { readdir } = await import("fs/promises");
  const existingFiles = new Set(
    (await readdir(OUT_DIR).catch(() => [])).filter((f) => f.endsWith(".wasm")),
  );

  const toDownload = LANGUAGES.filter((lang) => !existingFiles.has(lang.wasmFile));
  const cached = LANGUAGES.length - toDownload.length;

  if (cached > 0) {
    console.log(`Found ${cached}/${LANGUAGES.length} grammars already cached.\n`);
  }

  if (toDownload.length === 0) {
    console.log("All grammars are up to date. ✅");
    return;
  }

  console.log(`Downloading ${toDownload.length} tree-sitter WASM grammars...\n`);

  let success = 0;
  let failure = 0;

  for (const lang of toDownload) {
    const url = `https://github.com/${lang.owner}/${lang.repo}/releases/latest/download/${lang.asset}`;
    const destPath = join(OUT_DIR, lang.wasmFile);
    process.stdout.write(`  ${lang.name}... `);
    try {
      await downloadTo(lang, url, destPath);
      success++;
    } catch (error) {
      console.error(`  ✗ ${lang.name}: ${error.message}`);
      failure++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s: ${success} downloaded, ${failure} failed.`);

  if (failure > 0) {
    console.error("\n⚠️  Some grammars failed to download. Run 'npm run download:grammars' to retry.");
    process.exit(0); // Don't fail the build — use cached files or fallback
  }
}

main();
