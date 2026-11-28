# 数据根（Data Root）

Fello 的全部本地数据都在一个目录下（默认 `~/.fello`），这个目录称为**数据根**。目录内部的布局见 [数据存储](./storage.md)。

## 解析顺序

进程启动时解析一次：

1. 环境变量 `FELLO_DATA_ROOT`（优先；适合调试与 headless server）
2. 用户配置文件 `~/.fellorc`
3. 默认 `~/.fello`

修改后需要重启才生效。桌面端在「设置 → 高级」修改会直接重启。

## 配置文件 `~/.fellorc`

dotenv 格式（Node 内建 `util.parseEnv`），只有一个键：

```ini
FELLO_DATA_ROOT=/Volumes/SSD/fello
```

- **空值**（`FELLO_DATA_ROOT=`）表示使用默认数据根；
- 文件只在用户主动修改数据根时创建；从没设置过就不会存在；
- 由 Fello 整份模板重写：保留设置值，丢弃手写注释与未知键；原子替换 + 写后回读校验，权限 `0600`；如果 `~/.fellorc` 是符号链接，写穿到目标文件而不是替换链接。

### 路径规则

| 写法 | `.fellorc` | 环境变量 |
| --- | --- | --- |
| 绝对路径（`/Volumes/SSD/fello`、`D:\fello`） | ✅ | ✅ |
| 相对路径（`.fello-data`） | ✅ 相对于 `~/.fellorc` 所在目录 | ❌ |
| `~` / `~/fello` | ❌ 不展开（会解析成 `<home>/~/fello`，启动时报目录不存在） | ❌ |
| `$VAR` / `%VAR%` | 字面量 | 字面量 |

> Windows 路径**不要用双引号包裹**：dotenv 格式会把双引号内的 `\n` / `\r` 当换行处理，`C:\new\...` 这类路径会被破坏。含 `#` 或首尾空格时，Fello 写入会自动改用单引号。

### 模板

```ini
# Fello configuration (dotenv format, not a shell script).
# Managed by Fello: comments and formatting may be rewritten.
#
# - Restart Fello after changing a value
# - The FELLO_DATA_ROOT environment variable takes precedence over this file
# - An empty value means "use the default data root"
# - Paths: absolute, or relative to this file's directory; ~ is not expanded
# - No variable expansion: $VAR and %VAR% are kept literally
#
# previous data root: /Users/zy/.fello

FELLO_DATA_ROOT=/Volumes/SSD/fello-data
```

`previous data root` 只在通过界面修改时写入，方便用户切回。

## 生效与显示

- **生效时机**：重启；
- **来源**：环境变量 / `~/.fellorc` / 默认；
- 设置页同时显示「当前使用」和「重启后生效」两个值；
- `FELLO_DATA_ROOT` 生效时，设置页的数据根区域只读（写 `.fellorc` 不会生效，所以直接拒绝写入）。

## 启动校验（fail-closed）

被配置的数据根**不会被自动创建**：移动盘未挂载时不能悄悄在系统盘上建一个空目录。

| 情况 | 桌面端 | headless server |
| --- | --- | --- |
| 目录不存在 / 不是目录 / 配置文件无法解析 | 原生对话框：重试 / 本次用默认 / 把 `.fellorc` 重命名为 `.bak-<时间戳>` / 退出 | 打印原因并以 `1` 退出 |

server 启动时会先打印数据根与配置文件：

```text
[fello] config file: /Users/zy/.fellorc (not found, use default)
[fello] data root:   /Users/zy/.fello (default)
```

- `config file` 行末尾是 `found` / `not found, use default` / `not found`（后者表示数据根由环境变量指定，配置文件缺失不影响）；
- `data root` 括号里是来源：`env` / `config file` / `default`。

## 切换数据根

桌面端「设置 → 高级」：

- **更改目录**：原生目录选择器 → 二次确认（列出影响范围）→ 写入 → 立即重启；
- **还原为默认**：写入空值，保留文件；
- 不会移动、复制或删除任何数据。

目标目录的校验规则：

- 绝对路径、存在、是目录、可写（真实创建/删除探针，而不是 `access(W_OK)`）；
- 不能是当前数据根、当前根的子孙、当前根的祖先；
- 不能是磁盘/文件系统根，也不能是用户主目录本身；
- 空目录可以；已有 Fello 数据根可以（接管已有数据）；
- 其它非空目录拒绝。`.DS_Store`、`Thumbs.db`、`desktop.ini` 等系统噪声文件不算内容。

WebUI 中该区域只读：`setDataRoot` 与其它请求走同一条通道，但后端只接受 `transport === "ipc"`（桌面渲染层）的调用；从 WebUI / WS 到达的请求会被拒绝。

## 平台差异

| | macOS / Linux | Windows |
| --- | --- | --- |
| 默认数据根 | `~/.fello` | `%USERPROFILE%\.fello` |
| 路径比较 | 字面比较（都存在时先 `realpath`） | 大小写不敏感 + `realpath` 归一 |
| `.fellorc` 权限 | `0600` 生效 | `chmod` 只影响只读位 |
| 目录 `fsync` | 可用（APFS 上 `fsync` ≠ `F_FULLFSYNC`） | 不可用，已忽略 |
| 原子替换 | `rename` 原子 | `rename` 原子；被杀毒/独占句柄挡住时重试 3 次 |
| 路径长度 | 无 260 限制 | 超过 260 字符需要系统开启长路径支持 |

网络漫游目录 / UNC 共享上 `rename` 原子性与锁语义不保证，建议把数据根放在本地磁盘。

## 相关代码

| 文件 | 职责 |
| --- | --- |
| `src/backend/config/data-root.ts` | 解析、候选目录校验、切换写入 |
| `src/backend/config/fello-rc.ts` | `~/.fellorc` 的解析、模板渲染、原子写入 |
| `src/backend/config/config.ts` | 配置层统一出口（只导出懒解析模块） |
| `src/backend/storage/constant.ts` | 加载期绑定 `FELLO_DIR`（唯一允许急解析的地方） |
| `src/electron/data-root-gate.ts` | 启动失败时的原生恢复对话框 |
| `src/mainview/components/settings/advanced/settings-advanced.tsx` | 「设置 → 高级」页面 |
