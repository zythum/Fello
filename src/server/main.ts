/**
 * Headless server 入口（薄壳），与 Electron 的 `main.ts` / `app.ts` 结构保持一致。
 *
 * 这里只做三件事：
 * 1. import `./env` 设置 `process.*Path`（必须在入口 chunk 里执行，路径才相对
 *    `out/server` 而不是 `out/server/assets`）；
 * 2. import `./cli` 解析参数：`-h` / `-v` 必须在数据根校验之前生效；
 * 3. 校验数据根，然后动态 import 业务主体 `./app`。
 *
 * 为什么不能静态 import `./app`：它的依赖树里 `storage/constant.ts` 在模块加载期
 * 就解析数据根。静态 import 会先于本文件的任何代码执行，配置坏掉时只能得到一屏
 * 堆栈，而不是一条能看懂的说明。
 */
import "./env";
import "./cli";

import { existsSync } from "fs";

import { DEFAULT_DATA_ROOT, FELLO_RC_PATH, getDataRootInfo } from "../backend/config/config";

const info = getDataRootInfo();
const sourceLabel =
  info.source === "env" ? "FELLO_DATA_ROOT" : info.source === "rc" ? "~/.fellorc" : "default";

if (info.problem) {
  console.error("");
  console.error("[fello] Cannot start: the configured data root is not usable.");
  console.error(`[fello] ${info.problem}`);
  console.error(`[fello] Source: ${sourceLabel}`);
  console.error(
    `[fello] Fix the path, start with FELLO_DATA_ROOT="${DEFAULT_DATA_ROOT}", or remove ~/.fellorc.`,
  );
  console.error("");
  process.exit(1);
}

const rootSource =
  info.source === "env" ? "env" : info.source === "rc" ? "config file" : "default";
const rcState = existsSync(FELLO_RC_PATH)
  ? "found"
  : info.source === "default"
    ? "not found, use default"
    : "not found";
console.log(`[fello] config file: ${FELLO_RC_PATH} (${rcState})`);
console.log(`[fello] data root:   ${info.dir} (${rootSource})`);

await import("./app");
