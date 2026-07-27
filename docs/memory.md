# Memory — 项目级持久记忆

## 概述

Fello 的 Memory 模块为 Agent 提供跨会话的**项目级持久记忆**。它用于保存用户偏好、项目约定、架构决策、纠正信息、命令规范和临时背景，使不同 Agent、不同会话可以复用同一个项目上下文。

当前设计只提供项目级记忆，不提供全局用户记忆。每个项目通过工作目录 `cwd` 的 SHA-1 标识，记忆文件位于：

```text
~/.fello/projects/<sha1(cwd)>/memory.json
```

核心原则：

- `entries` 是唯一事实来源，不持久化派生 summary。
- Session Agent 通过 `memory_query` 和 `memory_store` 使用记忆。
- 临时 Memo Agent 负责语义检索和组织，不直接重写完整文件。
- ID、日期、事务、排序和容量控制由 Backend 管理。
- 同一项目的 query/store 串行执行，不同项目可以并行。
- 最高优先级的 weight-3 约束会原样注入工具描述，其他细节仍需按任务查询。

## 整体架构

```text
Session Agent
  │
  │ memory_query / memory_store
  ▼
mcp-memory（Session 级 MCP 子进程）
  │
  │ HTTP over Session Unix Socket
  ▼
src/backend/memory.ts
  │
  │ ProjectMemoryQueue（每项目一个串行队列）
  ▼
Memo Inference Agent（临时 Agent）
  │
  │ memo_get_current / memo_touch
  │ memo_add / memo_delete / memo_set_weight
  ▼
mcp-memo（单次 inference 的临时 MCP 子进程）
  │
  │ HTTP over 临时 Unix Socket
  ▼
内存 draft
  │
  │ inference 成功后单次提交
  ▼
~/.fello/projects/<project_id>/memory.json
```

相关 MCP Server 分为两层：

| MCP Server | 使用者 | 职责 |
|---|---|---|
| `mcp-memory` | Session Agent | 暴露面向任务的 `memory_query`、`memory_store` |
| `mcp-memo` | 临时 Memo Agent | 暴露对当前事务 draft 的细粒度读取、检索标记和修改工具 |

## 持久化模型

`memory.json` 当前保持 `version: 1`：

```json
{
  "version": 1,
  "entries": [
    {
      "weight": 2,
      "text": "项目统一使用 npm 执行包管理命令。",
      "date": "2026-07-27",
      "tags": ["npm", "package-manager"]
    }
  ]
}
```

### Entry 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `weight` | `1 \| 2 \| 3` | 对未来工作的影响级别 |
| `text` | `string` | 简洁、自包含的事实；创建后不可原地修改 |
| `date` | `YYYY-MM-DD` | 新增、修改权重或最近被检索使用的 UTC 日期 |
| `tags` | `string[]` | 从 text 归纳的开放语义检索关键词；创建后不可原地修改 |

持久文件中没有：

- entry ID；
- summary；
- 访问次数；
- summary 引用关系。

旧版文件即使包含 `summary` 也仍可读取。Schema 会忽略旧字段，下一次成功写入时自然移除它，不需要升级版本。

## 权重语义

### Weight 3：必须遵守的持久约束

只用于明确、持久、约束 Agent 行为的指令或禁令，例如必须确认后才能执行某类高风险操作。

规则：

- 没有明确持久行为指令时，最高只能为 2；
- 技术事实中的“必须”不等于 weight 3；
- 纠正、重复、强烈措辞或严重后果不能单独使其成为 3；
- 查询频率和最近使用时间不会提升 weight；
- weight 3 禁止自动淘汰。

由于 weight 3 不会自动淘汰，并且会默认注入 Agent 工具上下文，Organizer 必须谨慎写入或升级到该级别。

### Weight 2：稳定、会影响工作的知识

用于会影响实现、调试、计划或工作流的稳定信息，但不属于必须服从的 Agent 行为指令，例如技术栈、架构决策、稳定命令或产品行为。

容量整理时，weight 2 相比 weight 1 获得 30 天的相对日期保护。

### Weight 1：背景信息

用于临时、延期、观察性、一次性或低影响背景。它仍可以被查询和 touch，但在容量整理时优先级最低。

## Session Agent 工具

### `memory_query`

`query` 是可选字段，但对任何可能依赖记忆的具体任务、问题、建议或领域讨论，都应提供 focused query：

```json
{
  "query": "与发布说明格式、Git 工作流和用户输出偏好有关的项目记忆"
}
```

不得为了探测“是否存在相关记忆”而省略 query。一个 focused query 可以同时包含约定、偏好、决策、纠正、架构和命令等多个相关维度。

只有确实需要广泛项目概览时才省略 query：

```json
{}
```

两种模式：

| 调用方式 | 行为 |
|---|---|
| 有 `query` | 返回与具体主题相关的 detail |
| 无 `query` | 根据当前 entries 动态生成 broad briefing |

summary 只是一种实时查询结果，不写入 `memory.json`。Memo Retrieval Agent 只 touch 最终响应中实际使用的 entries，而不是它扫描过的全部候选。

### `memory_store`

Session Agent 提交待记忆事实：

```json
{
  "facts": [
    {
      "text": "项目统一使用 npm 执行包管理命令。",
      "reason": "用户明确说明了长期项目约定"
    }
  ]
}
```

`reason` 只帮助 Organizer 判断事实的来源和重要性，不会作为独立事实保存，也不能补充 `text` 未支持的细节。

`stored` 响应表示提交给 Organizer 的事实数量，不保证相同数量的 entries 被新增；事实可能被判定为重复、合并、替换或只更新权重。

## Weight-3 默认注入

仅依赖 ACP Agent 主动调用 `memory_query` 无法保证关键约束始终生效。因此构建 `mcp-memory` 时，Backend 会：

1. 读取当前项目 `memory.json`；
2. 提取所有 weight-3 entry 的原始 text；
3. 写入一次性临时 JSON 文件；
4. 通过 `--critical-memory` 传给 `mcp-memory`；
5. `mcp-memory` 读取并删除临时文件；
6. 将这些原始条目追加到 `memory_query` 工具描述。

工具描述会同时说明：

- 自动注入的只是最高优先级约束；
- 它们不是完整项目记忆；
- 某个细节未出现不代表没有保存；
- 具体任务仍需要 focused `memory_query`。

该机制不生成 summary、不修改 entries，也不 touch 注入的条目。weight 3 本身不会自动淘汰，因此无需通过伪 touch 保活。

MCP 工具描述在 Session/MCP Server 创建时确定。同一 Session 中新写入、删除或降级的 weight-3 记忆不会实时刷新描述，但新指令仍存在于当前对话上下文；后续新 Session 会读取最新内容。

## Memo Agent 工具

`mcp-memo` 的 Backend Socket 总是挂载完整 draft 路由，但 MCP 子进程根据是否带 `--writable` 决定向 Memo Agent 暴露哪些工具。

### Query 模式

| 工具 | 作用 |
|---|---|
| `memo_get_current` | 读取带运行时 ID 的当前 entries |
| `memo_touch` | 按 ID 更新最终响应所使用 entries 的 date |

### Organize 模式

| 工具 | 作用 |
|---|---|
| `memo_get_current` | 读取带运行时 ID 的当前 entries |
| `memo_add` | 新增 immutable text/tags/weight；Backend 生成 date 和 ID |
| `memo_delete` | 按 ID 删除旧 entry |
| `memo_set_weight` | 修改 weight，并必定将 date 刷新到当天 |

`memo_get_current` 继续通过 MCP `content` 返回 JSON 文本，不声明 `outputSchema`，也不依赖 `structuredContent`，以兼容不同 ACP Agent。

### 操作语义

- 完全重复：不修改；
- 同 text 只需调整权重：`memo_set_weight`；
- text 或 tags 需要变化：删除旧 entry，再新增新 entry；
- 冲突事实：删除旧事实，再新增替代事实；
- 多条事实合并：删除被合并条目，再新增自包含条目；
- 同 ID 已存在：`memo_add` 返回可恢复的 `content_exists`；
- ID 不存在：delete/set-weight 返回 `entry_not_found`。

未涉及的 entries 不需要由 LLM 重新输出，因此不会因为全量保存遗漏而被删除。

## 运行时 ID

Entry ID 不持久化，由 Backend 根据原始 text 计算：

```text
SHA-256(text) 的前 16 位小写十六进制字符
```

例如：

```text
f31b9dc8425e7a10
```

ID 只用于一次 Memo inference 内的引用以及 touch/delete/set-weight：

- 排序变化不会改变 ID；
- weight、tags、date 变化不会改变 ID；
- text 变化会产生新 ID；
- 相同 text 会得到相同 ID，因此 duplicate add 会报 `content_exists`。

当前规模下不额外处理 64-bit 短 hash 碰撞。

## 项目级事务与并发

`memory_query` 也会通过 touch 修改 date，因此 query 和 store 都属于记忆事务。`ProjectMemoryQueue` 按 `projectId` 串行执行完整 inference：

```text
Project A: query → store → query
Project B: store → query
```

A、B 可以并行，同一项目内部严格串行。

每次事务流程：

```text
进入项目 Queue
→ 读取 memory.json
→ 创建内存 draft
→ 执行容量检查
→ 运行完整 Memo inference
→ Memo 工具只修改 draft
→ inference 成功后单次写入 memory.json
→ 释放 Queue
```

store 在 Organizer 完成后会再次执行容量检查。Inference 抛错或超时时不写入 draft，避免出现 delete 已落盘但 add 尚未完成的中间状态。

内部 `memo_*` 路由不能再次进入项目 Queue，否则外层 inference 等待内部工具、内部工具又等待 Queue，会形成死锁。

## 日期与 touch

Backend 使用：

```ts
new Date().toISOString().slice(0, 10)
```

即 UTC date-only。

会更新 date 的操作：

| 操作 | 是否更新 date |
|---|---|
| `memo_add` | 是，设置为当天 |
| `memo_set_weight` | 是，即使只调整权重 |
| `memo_touch` | 是，最终响应实际使用的 entries |
| 完全重复/no-op | 否 |
| `memo_delete` | 不适用 |

Date 表达“记录、更新或最近使用”的时间，不等同于访问次数；当前没有 LFU 计数。

## 容量与确定性整理

容量检查不需要 LLM 参与。每次 query/store 事务开始时检查一次，store 修改完成后再检查一次。

```text
触发线：entries > 300
整理目标：尽量降到 250
```

### 淘汰规则

1. weight 3 永不进入自动淘汰候选；
2. weight 1 和 2 根据 date 计算年龄；
3. weight 2 获得 30 天相对保护：

```text
effectiveAge = ageInDays - 30
```

4. weight 1 使用实际 `ageInDays`；
5. `effectiveAge` 越大越先淘汰；
6. 同分时先淘汰 weight 1，再按运行时 ID 保证确定性顺序。

如果受保护的 weight-3 entries 太多，系统允许总数高于 250，不会为达到目标而删除 weight 3。

该整理不写淘汰日志，也不创建 archive。Query 只有在事务开始时发现文件已经超限才可能触发确定性整理；检索相关性本身不会决定永久删除。

## Summary 设计

Memory 模块不持久化 summary，也不会把 LLM 生成的 summary 注入新 Session。

原因：

- 避免派生 summary 与 entries 不一致；
- 避免 store 每次都重建整份摘要；
- 避免 summary 成为第二事实来源；
- 避免为 summary 引入额外引用和保活元数据。

需要广泛概览时，由 `memory_query({})` 基于最新 entries 实时生成；必须始终遵守的 weight-3 text 则以原文方式轻量注入工具描述。

## 相关文件

| 文件 | 职责 |
|---|---|
| `src/backend/memory.ts` | 文件读写、Prompt、项目 Queue、draft 事务、运行时 ID、容量整理、critical memory 注入 |
| `src/scripts/mcp-memory/server.ts` | Session Agent 的 `memory_query` / `memory_store` MCP 工具 |
| `src/scripts/mcp-memo/server.ts` | Memo Agent 的读取、touch 和 mutation MCP 工具 |
| `src/shared/zod/mcp-memory-schema.ts` | Session Agent 工具 schema |
| `src/shared/zod/mcp-memo-schema.ts` | MemoryFile 与内部 Memo 工具 schema |
| `src/backend/session/mcp-config.ts` | 将 Memory MCP Server 加入 Session 配置 |
| `src/mainview/components/settings/memory/settings-memory.tsx` | 项目记忆查看、清理和文件定位 UI |

## 当前边界

- 仅支持项目级记忆，不支持跨项目全局用户记忆；
- text 改写即产生新 ID，不维护 entry 编辑历史；
- 工具描述中的 weight-3 快照不会在同一 Session 中实时刷新；
- targeted query 当前仍由 Memo Retrieval Agent进行语义判断；
- 没有 access count、archive、summary refs 或稳定持久 ID；
- 没有自动化测试框架，当前主要通过人工用例和 TypeScript/lint 检查验证。
