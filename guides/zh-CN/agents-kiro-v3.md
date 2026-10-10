# Kiro CLI V3（实验性）

> ⚠️ **实验性** — Kiro CLI V3 为早期版本，目前尚不稳定。日常使用建议采用 [Kiro 作为 Agent](./agents-kiro.md) 中的稳定版（V2）配置。本页面面向希望尝鲜 V3 的用户。V3 与现有 2.x 可并存，升级前原有配置不受影响。

## V3 新特性

V3 与 Kiro IDE、Kiro Web 共享同一套统一 Agent 引擎。主要亮点：

- **Spec 驱动开发** — 在终端中定义需求、生成设计、执行任务计划。
- **Plan 模式** — 在修改代码前先探索代码库并生成分步计划。
- **能力化权限** — 通过 `permissions.yaml` 实现细粒度、可审计的控制。
- **增强的 Hooks** — 独立的 `.kiro/hooks/*.json` 文件，新增触发器与版本化 schema。
- **共享 `.kiro` 配置** — Steering、Hooks、Skills 可在 Kiro IDE / Web / CLI 之间复用。

## 在 Fello 中配置 V3 Agent

配置方式与稳定版基本一致，唯一区别是 **Args** 字段 — V3 需要显式指定引擎与鉴权参数：

| 字段 | 示例值 | 说明 |
|------|-------|------|
| **ID** | `kiro-v3` | 唯一标识；用单独的 ID 可同时保留稳定版 Kiro Agent |
| **Command** | `kiro-cli` | 可执行命令（需在系统 PATH 中） |
| **Args** | `acp --agent-engine=v3 --auth-method=cli` | 以 V3 引擎启动 ACP 服务，由 CLI 自身的登录态完成鉴权 |

### V3 启动参数说明

| 参数 | 作用 |
|------|------|
| `acp` | 启动 ACP 协议服务（NDJSON over stdio） |
| `--agent-engine=v3` | 使用 V3 统一 Agent 引擎 |
| `--auth-method=cli` | 由 CLI 登录态完成鉴权（Fello 推荐，Fello 无需管理令牌） |

> 💡 V3 不再接受 `--agent`、`--model`、`--effort`、`--trust-all-tools`、`--trust-tools` 等 2.x 启动参数。模型、模式与权限在会话内选择或由 Kiro 的权限流程处理。

## 工作原理

Fello 以子进程方式启动 `kiro-cli acp --agent-engine=v3 --auth-method=cli`，并通过 NDJSON 在 stdio 上通信。V3 与 Kiro IDE / Web 共享同一套统一引擎，受支持的 `.kiro` 配置可在各端复用。所有数据均在本地处理。

## 常见问题

| 问题 | 解决方法 |
|------|---------|
| `command not found: kiro-cli` | 确认 Kiro CLI 已安装并在系统 PATH 中，重启 Fello 后重试 |
| 启动后无响应 | 终端运行 `kiro-cli acp --agent-engine=v3 --auth-method=cli` 测试能否正常启动，检查是否有认证问题 |
| 认证过期 | 终端运行 `kiro-cli auth login` 重新授权 |
| 会话异常或不稳定 | V3 仍处于早期阶段。V3 会话存储与 2.x 不兼容 — 如需回到稳定配置，将 Args 改回 `acp` 即可。V3 可通过 `/upgrade-agent` 升级自定义 Agent 配置 |

---

> 📖 [What's new in V3](https://kiro.dev/docs/cli/v3/) · [ACP client migration](https://kiro.dev/docs/cli/v3/acp-migration/) · [返回 Kiro 作为 Agent](./agents-kiro.md)
