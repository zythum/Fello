import { join } from "path";

import { resolveDataRoot } from "../config/config";

/**
 * Resolved once per process from `FELLO_DATA_ROOT` > `~/.fellorc` > `~/.fello`.
 * Changing any of those requires a restart by design.
 *
 * 这是**唯一**允许在模块加载期解析数据根的地方，也是唯一把 `FELLO_DIR` 暴露给
 * 业务模块的地方。不要把它（或 `FELLO_DIR`）搬进 `config/`：`config` 层的契约是
 * 「import 不解析数据根」，启动门禁依赖这一点；一旦入口带上这里，数据根损坏时
 * 门禁会在 import 阶段直接崩掉。
 *
 * 需要 `FELLO_DIR` 的模块请从本文件深引用，而不是 `storage/index`：后者在加载期
 * 会 prepare 目录并扫描 `projects/`，与 `project-session` / `automation/store`
 * 之间还存在循环（`index → project-session → automation/store`）。
 */
export const FELLO_DIR = resolveDataRoot();
export const SOCKETS_DIR = join(FELLO_DIR, "sockets");
export const PROJECTS_DIR = join(FELLO_DIR, "projects");
export const TEMP_DIR = join(FELLO_DIR, "temp");
