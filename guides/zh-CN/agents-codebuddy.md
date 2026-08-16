# CodeBuddy 作为 Agent

> 💡 CodeBuddy（腾讯云代码助手）原生支持 ACP 协议，可作为 **Stdio Agent** 接入 Fello。通过 `codebuddy --acp` 以本地子进程方式运行，数据不出本机，并支持 Agent Teams 多智能体协作。

## 安装 CodeBuddy CLI

### 通过 npm 安装（推荐）

前置条件：Node.js >= 18.20

```bash
npm install -g @tencent-ai/codebuddy-code
```

### 通过 Homebrew 安装（macOS / Linux）

无需 Node.js 环境：

```bash
brew install Tencent-CodeBuddy/tap/codebuddy-code
```

### 原生二进制安装（Beta）

```bash
# macOS / Linux 一键安装
curl -fsSL https://www.codebuddy.cn/cli/install.sh | bash
```

```powershell
# Windows PowerShell 安装
irm https://www.codebuddy.cn/cli/install.ps1 | iex
```

安装完成后，运行 `codebuddy --version` 验证是否成功。

> 💡 **提示：** 如出现 `command not found`，请检查安装路径是否已加入系统 `PATH`（原生二进制默认安装在 `~/.local/bin`）。

## 登录 CodeBuddy

首次运行 `codebuddy` 进入交互界面，按提示选择登录方式完成认证：

| 登录方式 | 适用场景 |
|---------|---------|
| **Chinese Site** | 中国站用户，通过腾讯云中国站（copilot.tencent.com）认证，支持境内主流模型 |
| **International Site** | 国际站用户，通过 codebuddy.ai 认证 |
| **Enterprise Domain** | 企业专享版 / 私有化部署，输入企业提供的服务地址 |
| **iOA** | 腾讯内部员工，通过 iOA 零信任系统认证 |

## 在 Fello 中配置 CodeBuddy Agent

打开 Fello → **Settings**（设置）→ **Agents**（智能体），点击 **Add Stdio Agent**，填写如下配置：

| 字段 | 示例值 | 说明 |
|------|-------|------|
| **ID** | `codebuddy` | 唯一标识 |
| **Command** | `codebuddy` | 可执行命令（需在系统 PATH 中） |
| **Args** | `--acp` | 启动 ACP 协议服务 |

点击确认后，CodeBuddy 即出现在 Agent 列表中。新建会话时选择 **CodeBuddy** 即可开始对话。

## 常见问题

| 问题 | 解决方法 |
|------|---------|
| `command not found: codebuddy` | 确认 CodeBuddy CLI 已安装并在系统 PATH 中，重启 Fello 后重试 |
| 启动后无响应 | 终端运行 `codebuddy --acp` 测试能否正常启动，检查是否有认证问题 |
| 认证过期或提示未登录 | 终端运行 `codebuddy`，重新完成登录认证 |
| 多版本冲突导致版本不对 | 检查是否存在 npm 与 Homebrew 重复安装，保留其一 |

---

> 📖 [CodeBuddy CLI 官方文档](https://www.codebuddy.ai/docs/cli/) · [ACP 集成文档](https://www.codebuddy.ai/docs/cli/acp) · [安装指南](https://www.codebuddy.ai/docs/cli/installation)
