#!/usr/bin/env node
/**
 * Pre-publish glibc baseline check for Linux native binaries.
 *
 * Why this exists: electron-builder force-rebuilds the native deps (node-pty,
 * node-hid, ...) on the build machine, so their ELF binaries inherit the build
 * machine's glibc requirement. Building on anything newer than the oldest
 * supported distro silently raises the floor of the shipped AppImage/deb — the
 * 0.1.64 Linux releases were built on ubuntu-latest (glibc 2.42) and failed to
 * start on Ubuntu 22.04/24.04 with "`GLIBC_2.42` not found" while dlopen()ing
 * node-pty's pty.node (the whole app died with "Fello failed to start").
 *
 * The script walks every `.node` / `.so` file under node_modules and fails if
 * any of them requires a glibc newer than BASELINE. Non-ELF files (Windows and
 * macOS prebuilds) are skipped, and ELF files without glibc symbols (musl
 * builds) pass.
 *
 * Keep BASELINE in sync with the release.yml Linux runner/container image.
 *
 * Usage: node tools/verify-glibc-baseline.mjs [scanDir]   (default: node_modules)
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Oldest supported distro: Ubuntu 22.04 ships glibc 2.35. */
const BASELINE = "2.35";

const scanDir = process.argv[2] ?? "node_modules";
const NATIVE_FILE_RE = /\.node$|\.so(\.[0-9]+)*$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, out);
    } else if (statSync(path).isFile() && NATIVE_FILE_RE.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** Return the highest GLIBC_x.y symbol version a binary needs, or null. */
function maxGlibc(file) {
  let symbols;
  try {
    symbols = execFileSync("objdump", ["-T", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // Not an ELF the toolchain can read (e.g. Windows/macOS prebuilds).
    return null;
  }
  const versions = [...symbols.matchAll(/GLIBC_([0-9.]+)/g)].map((match) => match[1]);
  return versions.sort(compareVersions).at(-1) ?? null;
}

function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const files = walk(scanDir);
const offenders = [];
for (const file of files) {
  const max = maxGlibc(file);
  if (max && compareVersions(max, BASELINE) > 0) {
    offenders.push({ file, max });
  }
}

if (offenders.length > 0) {
  for (const { file, max } of offenders) {
    console.error(`::error::${file} requires GLIBC_${max} > baseline GLIBC_${BASELINE}`);
  }
  console.error(
    `Native binaries must not require glibc newer than ${BASELINE} (Ubuntu 22.04), ` +
      `otherwise the released AppImage/deb crash on older distros at dlopen() time. ` +
      `Build on Ubuntu 22.04 (see .github/workflows/release.yml) instead of a newer host.`,
  );
  process.exit(1);
}

console.log(
  `OK: ${files.length} native binaries scanned, none requires glibc newer than ${BASELINE}.`,
);
