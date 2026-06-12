# Kiro 作为 Agent

> 💡 Kiro CLI 可作为 **Stdio Agent** 接入 Fello。通过 ACP（Agent Chat Protocol）协议以本地子进程方式运行，数据不出本机，适合隐私优先的场景。

## 安装 Kiro CLI

在配置前，请确保系统已安装 Kiro CLI。打开终端执行以下命令安装：

```bash
# macOS / Linux 一键安装
curl -fsSL https://cli.kiro.dev/install | bash
```

```powershell
# Windows 11 PowerShell 安装
irm "https://cli.kiro.dev/install.ps1" | iex
```

其他安装方式：

- **Homebrew**（macOS，社区维护）：`brew install --cask kiro-cli`
- **Ubuntu .deb**：`wget https://desktop-release.q.us-east-1.amazonaws.com/latest/kiro-cli.deb` → `sudo dpkg -i kiro-cli.deb`

安装完成后，运行 `kiro-cli --version` 验证是否成功。

## 登录 Kiro

通过 `kiro-cli login` 命令，按照 Kiro 提供的引导登录：

> 🔗 [Authentication methods - Kiro CLI Docs](https://kiro.dev/docs/cli/authentication/)

## 在 Fello 中配置 Kiro Agent

打开 Fello → **Settings**（设置）→ **Agents**（智能体），点击 **添加 Stdio Agent**（Add Stdio Agent），填写如下配置：

| 字段 | 示例值 | 说明 |
|------|-------|------|
| **ID** | `kiro` | 唯一标识，仅支持字母、数字、下划线、连字符 |
| **Command** | `kiro-cli` | 可执行命令（需在系统 PATH 中） |
| **Args** | `acp` | 启动 ACP 协议服务 |

点击确认后，Kiro 即出现在 Agent 列表中。新建会话时选择 **Kiro** 即可开始对话。

## 工作原理

Fello 通过 **ACP（Agent Chat Protocol）** 与 Kiro CLI 通信：

- Fello 以子进程方式启动 `kiro-cli acp`
- 双方通过 NDJSON 格式在 stdio 上进行通信
- Kiro 作为独立的 Agent 运行时，拥有自己的工具调用、模型选择和上下文管理能力
- 所有数据在本地处理，不会经过第三方服务器

## 常见问题

| 问题 | 解决方法 |
|------|---------|
| `command not found: kiro-cli` | 确认 Kiro CLI 已安装并在系统 PATH 中，重启 Fello 后重试 |
| 启动后无响应 | 终端运行 `kiro-cli acp` 测试能否正常启动，检查是否有认证问题 |
| 认证过期 | 终端运行 `kiro-cli auth login` 重新授权 |

---

> 📖 [Kiro CLI 官方文档](https://kiro.dev/docs/cli/)
