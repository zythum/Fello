/**
 * 配置层：Fello 自己"在哪存东西、怎么找到它"。
 *
 * - `data-root`：数据根的解析（`FELLO_DATA_ROOT` > `~/.fellorc` > `~/.fello`）、
 *   候选目录校验、切换写入；
 * - `fello-rc`：`~/.fellorc` 的解析与原子写入。
 *
 * 这里导出的都是**懒解析**：导入本入口不会立刻解析数据根，所以启动门禁可以放心
 * import 它。真正"加载期就把根定下来"的是 `storage/constant.ts`（后端专用）——
 * 它刻意留在这个入口之外，否则配置坏掉时门禁会先一步崩在 import 上。
 *
 * `settings.json` 不在这里：它属于数据根里的数据，由 `storage/settings.ts` 管理。
 * 解析/渲染细节（`readFelloRc` 等）也不导出，需要时从对应模块直接 import。
 *
 * 命名：代码里叫 data-root（它是根，下面还有 projects/、sessions/ 等子目录），
 * 用户可见的配置项叫 `FELLO_DATA_ROOT`（与设置页的「数据根 / Data root」一致）。
 * 两者是同一个东西，不再统一改名。
 */
export {
  DEFAULT_DATA_ROOT,
  getDataRootInfo,
  overrideDataRootForProcess,
  resolveDataRoot,
  setDataRoot,
} from "./data-root";
export type { DataRootInfo } from "./data-root";

export { FELLO_RC_PATH } from "./fello-rc";
