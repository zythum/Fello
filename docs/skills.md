# Skills — 架构文档

## 概述

**Skills** 是 Fello 中的 Agent 技能系统。用户可以在本地创建或从 [skills.sh](https://www.skills.sh) 市场安装 Skills，Agent 通过 MCP 工具查询和激活这些技能，获取执行特定任务的 instructions 和辅助文件。

Skills 支持两种作用域级别：

| 级别 | 扫描目录 |
|------|---------|
| **project** | 项目根目录下的 `.fello/skills/` |
| **user** | `~/.fello/skills/`、`~/.agents/skills/`、`~/.claude/skills/` |

Skills 是一个**会话级 feature flag**，与 `ask_user` 平级，可以通过会话的 `features` 配置开关。

---

## Feature Flag

Skills 集成在 Fello 的会话级功能开关系统中：

### 类型定义 — `src/shared/schema.ts`

```typescript
/** 会话级别的 feature 枚举 */
export type Feature = "skills" | "ask_user";
```

### 默认启用 — `src/shared/constants.ts`

```typescript
/** 所有可用的 feature 列表，也作为默认值 */
export const ALL_FEATURES: Feature[] = ["skills", "ask_user"];

/** feature → i18n key 映射 */
export const FEATURE_I18N_KEYS: Record<Feature, string> = {
  skills: "constant.feature.skills",
  ask_user: "constant.feature.askUser",
};
```

### 在创建会话时选择

用户可以在新会话对话框中通过开关启用/禁用 Skills 功能。禁用时，Skills MCP Server 不会被注入到 Agent 的 MCP 配置中。

---

## 整体架构

```
                    Agent 进程 (ACP 协议)

  ┌──────────────────────────────────────────────────┐
  │  Agent 通过 MCP Client 调用:                      │
  │    list_skills → 获取可用技能列表                  │
  │    activate_skill → 获取技能详情和 instructions     │
  └────────────────────┬─────────────────────────────┘
                       ↕ stdio (MCP 协议)
  ┌────────────────────┴─────────────────────────────┐
  │          mcp-skills/server.ts                     │
  │  (ELECTRON_RUN_AS_NODE 独立进程)                   │
  │                                                    │
  │  工具注册:                                         │
  │    list_skills    → HTTP POST /skills/catalog      │
  │    activate_skill → HTTP POST /skills/detail       │
  │                                                    │
  │  启动参数:                                         │
  │    --project-dir  项目根目录                        │
  │    --socket-path  Unix Socket 路径                  │
  │    --catalog      初始 catalog 快照文件路径          │
  └────────────────────┬─────────────────────────────┘
                       │ HTTP POST over Unix Socket
                       ▼
  ┌──────────────────────────────────────────────────┐
  │          Main Process SocketServer                 │
  │  (per session)                                    │
  │                                                    │
  │  路由:                                             │
  │    POST /skills/catalog → getSkillsCatalog()       │
  │    POST /skills/detail  → skill detail lookup      │
  └────────────────────┬─────────────────────────────┘
                       │
                       ▼
  ┌──────────────────────────────────────────────────┐
  │          Backend (skills.ts)          │
  │                                                    │
  │  getSkillsCatalog({ projectRoot })                  │
  │    → 扫描 project/user 级别目录                     │
  │    → 解析 SKILL.md frontmatter                     │
  │    → 返回 SkillInfo[]                              │
  │                                                    │
  │  registerSkillsRoute(server, projectRoot)           │
  │    → 注册 /skills/catalog 和 /skills/detail 路由    │
  │                                                    │
  │  buildSkillsMcpServer({ projectDir, socketPath })   │
  │    → 构建 skills MCP Server 配置 + catalog 快照     │
  └──────────────────────────────────────────────────┘
```

---

## MCP 层 — `src/scripts/mcp-skills/server.ts`

**职责：** 向 Agent 注册 Skills 相关工具，将 Agent 的调用通过 Unix Socket 转发到主进程。

### 启动

MCP Server 由 `buildMcpServersConfig()` 在 `session.ts` 中按需构建，仅在 `features` 包含 `"skills"` 时注入：

```typescript
if (socketPath && features.includes("skills")) {
  servers.push({
    name: "skills",
    command: process.argv0,
    args: [
      join(__dirname, "../scripts/mcp-skills/server.mjs"),
      "--project-dir", project.cwd,
      "--socket-path", socketPath,
      "--catalog", skillCatalogFilename,  // 初始 catalog 快照
    ],
    env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  });
}
```

### 初始 Catalog 快照

在启动 MCP Server 时，backend 会将当前项目的 Skills catalog 写入一个临时 JSON 文件（`TEMP_DIR`），通过 `--catalog` 参数传入。MCP Server 读取后立即删除该文件：

```typescript
const skillCatalogFilename = join(TEMP_DIR, `project-${project.id}-${randomUUID()}.json`);
fs.writeFileSync(skillCatalogFilename, JSON.stringify(skillCatalog), "utf8");
// ... 传给 MCP Server 参数 ...
```

MCP Server 侧：

```typescript
let initialCatalog: z.infer<typeof skillCatalogSchema> = [];
if (catalogFile) {
  try {
    initialCatalog = skillCatalogSchema.parse(JSON.parse(fs.readFileSync(catalogFile, "utf8")));
  } finally {
    try { fs.unlinkSync(catalogFile); } catch {}
  }
}
```

这个 `initialCatalog` 会被嵌入到 `list_skills` 工具的 description 中，作为初始提示给 Agent 参考。实际查询时仍通过 socket 获取实时数据。

### 注册的工具

#### list_skills

| 属性 | 值 |
|---|---|
| 工具名 | `list_skills` |
| 输入参数 | 无 |
| 通信方式 | HTTP POST `/skills/catalog` over Unix Socket |
| 返回 | `SkillInfo[]`（id, name, description） |

**描述中嵌入的初始 Catalog：**

Agent 第一次看到此工具时，description 中已包含当前项目的 Skills 列表（JSON 格式），方便 Agent 直接决定是否需要调用 `activate_skill`。

#### activate_skill

| 属性 | 值 |
|---|---|
| 工具名 | `activate_skill` |
| 输入参数 | `{ id: string }`（skill 的唯一标识） |
| 通信方式 | HTTP POST `/skills/detail` over Unix Socket |
| 返回 | 完整的 skill 详情（instructions + 辅助文件列表） |

---

## Backend 层

### Skills 目录扫描 — `src/backend/skills.ts`

`getSkillsCatalog()` 是核心函数，按优先级扫描目录：

```
扫描顺序:
  1. project 级别:  ${projectRoot}/.fello/skills/
  2. user 级别:     ~/.fello/skills/
                   ~/.agents/skills/
                   ~/.claude/skills/
```

每个 SKILL.md 文件通过 frontmatter 解析获取元数据：

```markdown
---
name: my-skill
description: What this skill does
---

Skill instructions body...
```

返回的 `SkillInfo` 结构：

```typescript
interface SkillInfo {
  id: string;          // 唯一标识，如 "user://agents/my-skill"
  name: string;        // 显示名称
  description: string; // 描述
  level: "user" | "project";
  scope: "agents" | "claude" | "fello";
}
```

### Skills MCP 路由注册 — `registerSkillsRoute()`

`registerSkillsRoute(server, projectRoot)` 向 Socket Server 注册  和  两个路由，供 MCP 子进程回调。该函数被 （常规会话）和 （自动化任务）共享使用。

### Skills MCP 配置构建 — `buildSkillsMcpServer()`

`buildSkillsMcpServer({ projectDir, socketPath })` 构建 skills MCP Server 的启动配置（command + args + env），内部自动生成 catalog JSON 快照文件。被  和  共享使用，消除了原有的重复代码。

### Socket 路由处理

#### `/skills/catalog`

返回当前项目的 Skills 目录（不含 scope 和 level 字段，仅返回 id/name/description），供 Agent 浏览可用技能。

#### `/skills/detail`

接收 `{ id: string }`，执行：

1. 在 catalog 中查找匹配的 skill
2. 读取 SKILL.md 文件内容，解析 frontmatter 提取 body（instructions）
3. 列出 skill 目录下所有辅助文件
4. 返回完整的 skill 详情

返回结构（`skillDetailSchema`）：

```typescript
{
  id: string;                // 技能唯一标识
  name: string;              // 技能名称
  description: string;       // 技能描述
  instructions: string;      // 系统指令（SKILL.md body）
  root_path: string;         // 技能目录绝对路径
  supporting_files: string[]; // 辅助文件路径列表
}
```

---

## 前端层

### 会话创建对话框

在新会话对话框中，Skills 作为一个 feature 开关展示，与 `ask_user` 并列：

```
┌──────────────────────────────────┐
│  Features                        │
│  ┌────────────────────────────┐  │
│  │ Skills              [开关] │  │
│  │ Ask Me              [开关] │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

### @mention 自动补全

在聊天输入框中，输入 `@` 可以快速引用 Skills 和 MCP Server。Skills 的补全列表：

- 来源：通过 `request.getSkillsCatalog({ projectId })` 获取
- 排序：按 `name.localeCompare()` 排序
- 数量限制：最多显示 `AT_SUGGESTION_MAX = 6` 条
- 优先顺序：MCP Server 排在 Skills 前面

---

## 数据流全景

### list_skills

```
Agent 调用 list_skills tool
  → MCP Skills Server (子进程)
    → HTTP POST /skills/catalog over Unix Socket
    → Main SocketServer
      → getSkillsCatalog({ projectRoot })
        → 扫描 project/user 级别 SKILL.md
        → 返回 SkillInfo[]（不含 scope/level）
    → 响应返回给 Agent
```

### activate_skill

```
Agent 调用 activate_skill({ id })
  → MCP Skills Server (子进程)
    → HTTP POST /skills/detail over Unix Socket
    → Main SocketServer
      → 查找 skill → 读取 SKILL.md → 列出辅助文件
      → 返回完整 skill 详情
    → 响应返回给 Agent
```

---

## 临时文件清理

Skills 使用 `TEMP_DIR`（`~/.fello/temp/`）存放初始 catalog 快照。应用退出时 `clearBackend()` 会清空此目录：

```typescript
for (const file of await readdir(TEMP_DIR)) {
  await rm(join(TEMP_DIR, file), { recursive: true, force: true });
}
```

---

## 关键设计决策

### 为什么通过 Socket 而不是直读文件系统？

之前的实现中，`mcp-skills` 直接在子进程中读取文件系统（`getSkillsCatalog`、`readFileSync` 等），这带来了两个问题：

1. **与 Backend 的 Skills 逻辑重复**：子进程需要 import backend 的 skills 模块，耦合了主进程的代码
2. **无法复用 Backend 的能力**：如权限校验、路径安全等

改为 Socket 通信后，MCP Server 只做一件事：**转发请求**。所有 Skills 逻辑集中在 Backend，一致性好、易于维护。

### 初始 Catalog 快照的作用

通过 `--catalog` 传入的 JSON 快照被嵌入到 `list_skills` 工具的 description 中。这样 Agent 在首次看到工具时就已经知道有哪些技能可用，可以直接决定是否需要调用 `activate_skill`，减少一次不必要的 `list_skills` 调用。

---

## 相关文件清单

| 文件 | 层 | 职责 |
|---|---|---|
| `src/scripts/mcp-skills/server.ts` | MCP | Skills MCP tool 注册 & Socket 转发 |
| `src/backend/session.ts` | Backend | `buildMcpServersConfig()` 按 feature 注入 Skills MCP Server |
| `src/backend/skills.ts` | Backend | Skills 目录扫描、frontmatter 解析、CRUD、`registerSkillsRoute()`、`buildSkillsMcpServer()` |
| `src/backend/storage.ts` | Backend | `TEMP_DIR`、`SOCKETS_DIR` 常量 |
| `src/backend/socket-server.ts` | Backend | Unix Domain Socket HTTP 服务器 |
| `src/shared/zod/mcp-skills-schema.ts` | Shared | Skills Zod schema（catalog、detail request/response） |
| `src/shared/schema.ts` | Shared | `Feature` 枚举、`SkillInfo` 接口 |
| `src/shared/constants.ts` | Shared | `ALL_FEATURES`、`FEATURE_I18N_KEYS` |
| `src/mainview/components/session/chat/chat-input.tsx` | Frontend | @mention 补全中展示 Skills |
| `src/mainview/components/skills/` | Frontend | Skills 管理页面（已安装列表 + skills.sh 市场） |
| `src/mainview/components/layout/sidebar.tsx` | Frontend | 新会话对话框中的 feature 开关 |
