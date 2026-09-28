# Automation — 自动化任务计划

Automation 模块允许用户创建定时任务，由配置的 AI Agent 自动执行。任务支持三种触发方式：

- **周期（cron）**：按 5 段式 cron 表达式重复触发，适合日报生成、定期代码检查、数据汇总等重复性工作流；
- **单次（once）**：在指定的绝对时间点触发一次；
- **手动（manual）**：不定时，仅在用户点击「立即触发」时执行。

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
    type: "cron" | "once" | "manual"; // 周期 / 单次 / 仅手动
    expr?: string;          // 5 段式 cron 表达式（分 时 日 月 周），type='cron' 时有效
    at?: number;            // 单次触发的绝对时间（epoch 毫秒），type='once' 时有效
  };
  features: Feature[];      // 启用的 feature 列表（ask_user/share_to_user 始终被过滤）
  mcpServers: string[];     // 使用的 MCP 服务器 ID 列表
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null; // 上次触发时间（自动/手动都写，成功/失败都写）
  remainingRuns: number | null; // 周期：剩余次数（null=不限）；单次：1=待执行 / 0=已执行
}
```

### 执行次数（remainingRuns）

该字段有两种用途：

- **周期计划（cron）**：表示剩余执行次数
  - `null`（设置里留空）：不限次数，按 cron 一直执行
  - 数字：**仅自动触发**每执行一次自减 1；减到 `0` 时注销 cron，`restoreActiveSchedules` 也不再恢复；手动 `triggerSchedule` 仍可执行且不扣次数
  - 语义说明：该字段是「剩余次数」而非「总次数 / 已执行次数」，因此编辑计划时填入的数字会直接覆盖剩余值（相当于重置配额）
  - 设置弹窗中该项位于「计划（Schedule）」区块内，与类型分段选择 `[周期 | 单次 | 手动]` 同一行、右对齐；仅周期计划显示该输入框
- **单次计划（once）**：作为「是否已执行」标记（**不**表示可执行次数）
  - 固定由 `1`（待执行）在执行后归 `0`（已执行）
  - 不用 `lastRunAt` 判定是否执行过：`lastRunAt` 会被历史手动触发、或「周期改成单次」之前的旧运行污染；而 `remainingRuns` 只属于当前这份触发配置
  - 手动触发不消耗，因此「立即触发」过的单次计划仍会在计划时间点执行
  - 重置时机：**保存为单次时一律重置为 `1`**（无论改了什么），保证每次配置都是一次干净的待执行
  - 因此重新保存一个已执行的单次计划会回到「待执行」；若时间点已过，则显示为「已错过」
- 旧版本 `schedule.json` 没有该字段，读取时由 `store` 归一化：周期计划为 `null`，单次计划为 `1`

### 单次（once）

- 用绝对时间点 `cron.at`（epoch 毫秒）调度：UI 用日期时间选择器产出本地时间，保存前转为时间戳。**存储用时间戳而非格式化字符串**，与时区无关，天然规避时区 / DST 歧义
- 调度实现：`new CronJob(new Date(at), ...)` —— `cron` 库对 `Date` 入参会置 `realDate/runOnce`，触发一次后不再重排，因此无需额外状态；库内部还会对超过 `MAXDELAY`（≈24.8 天）的延迟分段续期
- 仅在 `at > now` 时注册；`at` 已过期则不注册
- **是否已执行**由 `remainingRuns` 判定：`0` = 已执行（成功、失败都算），`1` = 待执行；自动触发时由 `consumeRun` 归零
- **错过策略**：应用关闭期间错过的时间点**不补跑**，仅保留记录。判定：`remainingRuns > 0 && at <= now` → 已错过，UI 显示「已错过」
- 手动触发不消耗 `remainingRuns`，不影响到点执行

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
- `normalizeSchedule` / `normalizeCron` 负责读取时补齐历史字段（`remainingRuns`、`cron.at`）并修正非法 `type`
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
- `scheduleCron(schedule)` — 注册任务：周期计划用 cron 表达式，单次计划用 `CronJob(new Date(at))`（剩余执行次数为 0、或单次时间点已过期时不注册）
- `unscheduleCron(scheduleId)` — 注销单个计划（单次任务触发后也会自清理）
- `restoreActiveSchedules()` — 模块初始化时自动恢复活跃计划：周期直接恢复；单次仅在「未触发且未过期」时恢复，其余（已触发 / 已错过）不注册
- `stopAllCrons()` — 应用退出时优雅清理
- `getNextRun(schedule)` — 获取下次执行时间（单次计划直接返回 `at`，不走 `nextDate()`，避免时间点已过去时 cron 库抛错）
- 并发保护：`runningTasks` Set 确保同一计划不会并发执行

### runner — 任务执行（index.ts）

`createAutomationModule(ctx, { inference })` 接收 `InferenceModule` 依赖，通过 `inference.runInference()` 执行任务。不再直接 spawn ACPBridge，而是委托给 InferenceModule 处理 Agent 会话的全生命周期。

执行流程：

1. 检查并发锁（同一 Schedule 不重复执行）；自动触发还会检查剩余执行次数（为 0 时抛出 `Schedule run limit reached`）
2. 创建 Task 记录，状态标记为 `running`
3. 在触发瞬间写入 `lastRunAt` 并持久化（自动与手动触发都写，成功、失败都写）
4. **自动触发**消耗一次执行配额（`consumeRun`）：周期计划 `remainingRuns` 自减 1，单次计划由 1 归 0；归零则注销调度。手动触发不消耗
5. 构建 MCP 服务器配置（`buildAutomationMcpServers`）
6. 调用 `inference.runInference({ agentId, prompt, model, cwd, mcpServers, features })`
7. InferenceModule 内部完成 Agent 解析、Bridge spawn、MCP/Skills 集成、权限自动批准
8. 将对话记录写入 `.fello-conversation.json`（含 meta、notifications、terminalLogs）
9. 更新 Schedule 的 `updatedAt`
10. 标记 Task 为 `success` 或 `error`（周期计划自动触发时，执行失败同样已消耗一次配额）

权限处理：InferenceModule 内部自动选择 `allow_always` > `allow_once` > 第一个选项，无需人工干预。

## IPC 接口

| 方法 | 参数 | 返回值 |
|------|------|--------|
| `listSchedules` | — | `Schedule[]` |
| `createSchedule` | `{ name, agentId, modelId?, prompt, cron: { type: "cron" \| "once" \| "manual", expr?, at? }, remainingRuns?, features?, mcpServers? }` | `Schedule` |
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
├── automation.tsx                  # 计划列表页（创建/编辑/删除/手动触发，展示「已错过」）
├── common/
│   ├── cron-editor.tsx             # Cron 表达式编辑器（周期）
│   ├── date-time-picker.tsx        # 日期时间选择器（单次，Popover + Calendar）
│   └── setting-dialog.tsx          # 计划配置弹窗（周期/单次/手动 三选一）
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

### DateTimePicker（单次）

基于 shadcn 的 `Popover` + `Calendar`（react-day-picker）与原生时间输入组合：

- `value` / `onChange` 均以 **epoch 毫秒** 交互，组件内部负责「日期 + HH:mm」与时间戳互转
- 日期部分禁用过去日期（`disabled={{ before: new Date() }}`），并通过 `timeZone` 传入本地时区避免选中日偏移
- 保存时若时间点不在未来，弹窗校验报错（`automation.validation.onceTimeInvalid`）

## 依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `cron` | ^4.4.0 | CronJob 定时计划（周期 + 单次 `Date` 调度） |
| `cronstrue` | ^3.24.0 | Cron 表达式转人类可读文本 |
| `react-day-picker` | ^10.0.1 | 单次日期选择（`Calendar` 组件；其自身依赖 `date-fns`） |

## 路由

侧边栏通过 `ClockCheck` 图标导航到 Automation 页面。路由注册在 `src/mainview/router.tsx`。

## 安全

- `readTaskFile` / `writeTaskFile` / `getTaskFileSystemPath` 均有路径穿越校验，确保访问不超出任务目录
- 自动化任务执行时权限自动批准，`ask_user` 和 `share_to_user` feature 始终禁用（在 `store.createSchedule` 中过滤）
- 应用退出时 `stopAllCrons()` 确保无残留定时器
