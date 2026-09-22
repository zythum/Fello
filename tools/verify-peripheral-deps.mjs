#!/usr/bin/env node
/**
 * 打包前的原生依赖自检（macOS）。
 *
 * 为什么需要它：这些原生模块缺装 / 没编译时，npm 只会 warn（optional 依赖甚至静默跳过），
 * 而这类缺件在运行时同样表现为静默降级（「按键没反应」「蓝牙连不上」），所以在出包前
 * 硬校验一次，把问题挡在产物之外。
 *
 * 校验两件事：包能 resolve；**存在适配当前宿主平台与架构的 .node**。
 * 只看「有没有 .node」是不够的 —— 这些包都同时带多平台 prebuild，
 * 随便挑一个（比如 win32-x64 的）会给出假阳性。
 *
 * 只校验 macOS 产物需要的外设原生依赖；其它平台直接通过（那些平台本来就不装它们）。
 */

import { createRequire } from "module";
import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join, relative, sep } from "path";

const require = createRequire(import.meta.url);

/** 必须能 resolve 的包；`needsNativeBinary` 的还要能找到当前宿主的编译产物。 */
const REQUIRED_PACKAGES = [
  { name: "node-hid", needsNativeBinary: true },
  { name: "unified-ble-manager", needsNativeBinary: true },
  { name: "darwin-corebluetooth-connected-peripherals-recovery", needsNativeBinary: true },
];

if (process.platform !== "darwin") {
  console.log(`[verify-peripheral-deps] ${process.platform} 不需要外设原生依赖，跳过`);
  process.exit(0);
}

/** 当前宿主平台 + 架构，如 `darwin-arm64`。 */
const HOST = `${process.platform}-${process.arch}`;

/** node-gyp 在宿主上现编的产物目录（不体现平台/架构，但按定义就是当前宿主）。 */
const HOST_BUILD_DIR = `${sep}build${sep}Release${sep}`;

/** 从 resolve 到的入口文件往上找包根目录（不用 `pkg/package.json`，避免 exports 限制）。 */
function findPackageRoot(entryFile) {
  let dir = dirname(entryFile);
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, "utf8")).name) return dir;
      } catch {
        // 继续向上找
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 收集包内所有 .node（不进入嵌套 node_modules：那是子依赖自己的产物）。 */
function collectNativeBinaries(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") stack.push(path);
      } else if (entry.name.endsWith(".node")) {
        found.push(path);
      }
    }
  }
  return found;
}

/** prebuild 布局带 `<platform>-<arch>`；node-gyp 产物在 build/Release 下。 */
function isHostBinary(path) {
  return path.includes(HOST) || path.includes(HOST_BUILD_DIR);
}

const failures = [];
for (const { name, needsNativeBinary } of REQUIRED_PACKAGES) {
  let entryFile;
  try {
    entryFile = require.resolve(name);
  } catch (error) {
    failures.push(`${name}：无法 resolve —— ${error.message}`);
    continue;
  }

  if (!needsNativeBinary) {
    console.log(`  ✓ ${name}`);
    continue;
  }

  const root = findPackageRoot(entryFile);
  const binaries = root ? collectNativeBinaries(root) : [];
  const hostBinary = binaries.find(isHostBinary);
  if (!hostBinary) {
    const seen = binaries.map((path) => relative(process.cwd(), path)).join(", ") || "无";
    failures.push(`${name}：没有适配 ${HOST} 的原生产物（包内找到：${seen}）`);
    continue;
  }
  console.log(`  ✓ ${name} → ${relative(process.cwd(), hostBinary)}`);
}

if (failures.length > 0) {
  console.error("\n[verify-peripheral-deps] 外设原生依赖不完整，已中止打包：");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(
    "\n处理：先 `npm install`（macOS 上会编译这些原生模块，需要 Xcode Command Line Tools），再重新打包。",
  );
  process.exit(1);
}

console.log("[verify-peripheral-deps] 外设原生依赖齐全");
