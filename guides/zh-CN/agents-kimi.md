# Kimi 作为 Agent

> 💡 Kimi（月之暗面）支持两种接入方式：通过 **API Agent** 连接 OpenAI 兼容接口，或通过 **Stdio Agent** 使用 kimi-cli 的 ACP 协议。前者开箱即用，后者适合本地优先的场景。

## 方式一：API Agent

### 前置条件

前往 Kimi 开放平台注册账号并创建 API Key：

| 平台 | 适用地区 |
|------|---------|
| [platform.kimi.com](https://platform.kimi.com/) | 中国境内 |
| [platform.kimi.ai](https://platform.kimi.ai/) | 境外 |

> ⚠️ 两个平台的账户和 API Key 相互独立，不能混用。如果用错会出现 401 报错。

### 配置 Base URL

不同的服务使用不同的 Base URL：

| 服务 | Base URL | 说明 |
|------|---------|------|
| 国内标准 API | `https://api.moonshot.cn/v1` | platform.kimi.com 对应的 API 端点 |
| 境外标准 API | `https://api.moonshot.ai/v1` | platform.kimi.ai 对应的 API 端点 |
| Kimi Code Plan | `https://api.kimi.com/coding/v1` | Kimi Code 编程专用，支持搜索和抓取服务 |

### 配置步骤

打开 Fello → **Settings**（设置）→ **Agents**（智能体），点击 **Add API Agent**，填写如下配置：

| 字段 | 示例值 | 说明 |
|------|-------|------|
| **ID** | `kimi` | 唯一标识 |
| **Provider** | `openai-compatible` | Kimi 兼容 OpenAI 协议 |
| **Base URL** | 按需选择上方任一地址 | API 服务地址 |
| **API Key** | `sk-xxxxxxxx` | 对应平台的密钥 |

点击确认后即完成添加。新建会话时在模型下拉菜单中选择所需模型即可。

## 方式二：Stdio Agent（ACP）

### 安装 kimi-cli

打开终端执行以下命令安装：

```bash
# macOS / Linux 一键安装
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
```

```powershell
# Windows PowerShell 安装
irm https://code.kimi.com/kimi-code/install.ps1 | iex
```

安装完成后，运行 `kimi-cli --version` 验证是否成功。

### 登录

首次使用需运行 `kimi-cli` 进入交互界面，输入 `/login` 完成登录认证（支持 Kimi Code OAuth 或 Moonshot AI API Key）。

### 配置步骤

打开 Fello → **Settings**（设置）→ **Agents**（智能体），点击 **Add Stdio Agent**，填写如下配置：

| 字段 | 示例值 | 说明 |
|------|-------|------|
| **ID** | `kimi` | 唯一标识 |
| **Command** | `kimi-cli` | 可执行命令（需在系统 PATH 中） |
| **Args** | `acp` | 启动 ACP 协议服务 |

点击确认后即完成添加。

## 推荐：Exa MCP 搜索工具

为 Agent 提供网络搜索能力，以 HTTP MCP 方式接入：

| 字段 | 值 |
|------|-----|
| **ID** | `exa` |
| **Url** | `https://mcp.exa.ai/mcp` |
| **Headers** | `{}`（免费额度无需 API Key） |

> 详细配置请参考 [MCP 服务器配置](./mcp-servers.md)

## 常见问题

| 问题 | 解决方法 |
|------|---------|
| `401 Unauthorized`（API） | 检查 API Key 与 Base URL 是否匹配（国内 `moonshot.cn`，境外 `moonshot.ai`） |
| ACP 提示认证失败 | 终端运行 `kimi-cli`，输入 `/login` 完成登录 |
| `command not found: kimi-cli` | 确认 kimi-cli 已安装并在系统 PATH 中，重启 Fello |

---

> 📖 [Kimi 国内开放平台](https://platform.kimi.com/) · [Kimi 境外开放平台](https://platform.kimi.ai/) · [kimi-cli 文档](https://moonshotai.github.io/kimi-cli/)
