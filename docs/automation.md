# Automation — 自动化任务计划

Automation 模块允许用户创建基于 cron 的定时任务，由配置的 AI Agent 自动执行。典型场景包括日报生成、定期代码检查、数据汇总等重复性工作流。

## 核心概念

### Schedule（计划）

一个自动化配置项，定义了何时触发、用哪个 Agent、执行什么 Prompt。

```typescript
interface Schedule {
  id: string;
  name: string;
  agentId: string;          // 使用的 Agent ID
  modelId?: string;         // 使用的模型 ID（可选，留空则使用 Agent 默认模型）
  prompt: string;           // Agent 执行的 Prompt
  cron: {
    type: "cron" | "manual"; // cron 定时 或 手动触发
    expr?: string;           // 5 段式 cron 表达式（分 时 日 月 周）
  };
  features: Feature[];       // 启用的 feature 列表（ask_user/share_to_user 始终被过滤）
  mcpServers: string[];      // 使用的 MCP 服务器 ID 列表
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
}
```

### Task（任务）

计划每次触发产生的一次执行记录。

```typescript
interface Task {
  id: string;               // 基于时间戳的唯一标识
  scheduleId: string;
  startedAt: number;
  completedAt: number | null;
  status: "running" | "success" | "error";
  error?: string;
}
```

## 架构

```
src/backend/automation/
├── index.ts        # 模块导出 + Schedule CRUD + Cron 计划管理 + 任务执行器（InferenceModule 集成）
└── store.ts        # 文件持久化层（Schedule/Task CRUD + createSchedule 工厂方法）
```

### store.ts — 持久化

`createSchedule(params)` 工厂方法封装了 Schedule 对象的创建逻辑（ID 生成、`ask_user`/`share_to_user` 过滤、默认值），被 `index.ts` 和 `backend.ts` 共享使用，避免外部手动构造 Schedule 对象。

- 数据目录：`~/.fello/automations/`
- 每个 Schedule 一个子目录，内含 `schedule.json` 和 `tasks/` 目录
- 每个 Task 一个子目录，内含 `task.json` 和 Agent 执行产出的文件
- 提供 `readTaskFile` / `writeTaskFile` 带路径穿越保护

目录结构：

```
~/.fello/automations/
└── <schedule-id>/
    ├── schedule.json
    └── tasks/
        └── <task-id>/
            ├── task.json                  # 任务元数据
            ├── .fello-conversation.json   # 完整对话记录（notifications + terminalLogs + meta）
            └── ...                        # Agent 产出的其他文件
```

### scheduler — 计划管理（index.ts）

- 基于 `cron` 库（^4.4.0）实现 CronJob 管理
- `scheduleCron(schedule)` — 注册 cron 任务
- `unscheduleCron(scheduleId)` — 注销单个计划
- `restoreActiveSchedules()` — 模块初始化时自动恢复所有活跃计划
- `stopAllCrons()` — 应用退出时优雅清理
- `getNextRun(schedule)` — 获取下次执行时间
- 并发保护：`runningTasks` Set 确保同一计划不会并发执行

### runner — 任务执行（index.ts）

`createAutomationModule(ctx, { inference })` 接收 `InferenceModule` 依赖，通过 `inference.runInference()` 执行任务。不再直接 spawn ACPBridge，而是委托给 InferenceModule 处理 Agent 会话的全生命周期。

执行流程：

1. 检查并发锁（同一 Schedule 不重复执行）
2. 创建 Task 记录，状态标记为 `running`
3. 构建 MCP 服务器配置（`buildAutomationMcpServers`）
4. 调用 `inference.runInference({ agentId, prompt, model, cwd, mcpServers, features })`
5. InferenceModule 内部完成 Agent 解析、Bridge spawn、MCP/Skills 集成、权限自动批准
6. 将对话记录写入 `.fello-conversation.json`（含 meta、notifications、terminalLogs）
7. 更新 Schedule 的 `lastRunAt`
8. 标记 Task 为 `success` 或 `error`

权限处理：InferenceModule 内部自动选择 `allow_always` > `allow_once` > 第一个选项，无需人工干预。

## IPC 接口

| 方法 | 参数 | 返回值 |
|------|------|--------|
| `listSchedules` | — | `Schedule[]` |
| `createSchedule` | `{ name, agentId, modelId?, prompt, cron, features?, mcpServers? }` | `Schedule` |
| `updateSchedule` | `{ scheduleId, updates }` | `Schedule` |
| `deleteSchedule` | `{ scheduleId }` | `void` |
| `triggerSchedule` | `{ scheduleId }` | `Task` |
| `getTasks` | `{ scheduleId }` | `Task[]` |
| `getTaskFiles` | `{ scheduleId, taskId }` | `string[]` |
| `readTaskFile` | `{ scheduleId, taskId, filePath, encoding? }` | `string` |
| `deleteTask` | `{ scheduleId, taskId }` | `void` |
| `getTaskFileSystemPath` | `{ scheduleId, taskId, filePath }` | `string` |

## 事件

| 事件 | Payload | 触发时机 |
|------|---------|---------|
| `schedules-changed` | `void` | Schedule 创建/更新/删除时 |
| `task-update` | `{ scheduleId, task: Task }` | Task 状态变更时（创建、完成、失败） |

## 前端组件

```
src/mainview/components/automation/
├── automation.tsx                  # 计划列表页（创建/编辑/删除/手动触发）
├── common/
│   ├── cron-editor.tsx             # Cron 表达式编辑器
│   └── setting-dialog.tsx          # 计划配置弹窗
├── schedule/
│   └── schedule.tsx                # 计划详情（含任务历史面板）
└── task/
    ├── task.tsx                    # 任务详情视图
    ├── file-panel/
    │   └── file-panel.tsx          # 任务文件列表
    └── file-detail/                # 多格式文件预览
        ├── file-detail.tsx
        ├── code-detail/
        ├── markdown-detail/
        ├── html-detail/
        ├── image-detail/
        ├── pdf-detail/
        ├── docx-detail/
        ├── xlsx-detail/
        └── pptx-detail/
```

### CronEditor 预设

CronEditor 组件提供常用预设供快速选择：

- **每天**（daily）
- **工作日**（weekdays）
- **每周**（weekly）
- **每小时**（hourly）
- **自定义**（custom）— 直接编辑 cron 表达式

使用 `cronstrue` 库（^3.24.0）将 cron 表达式转换为人类可读文本显示。

## 依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `cron` | ^4.4.0 | CronJob 定时计划 |
| `cronstrue` | ^3.24.0 | Cron 表达式转人类可读文本 |

## 路由

侧边栏通过 `ClockCheck` 图标导航到 Automation 页面。路由注册在 `src/mainview/router.tsx`。

## 安全

- `readTaskFile` / `writeTaskFile` / `getTaskFileSystemPath` 均有路径穿越校验，确保访问不超出任务目录
- 自动化任务执行时权限自动批准，`ask_user` 和 `share_to_user` feature 始终禁用（在 `store.createSchedule` 中过滤）
- 应用退出时 `stopAllCrons()` 确保无残留定时器
