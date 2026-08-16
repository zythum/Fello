# 🚀 Fello — 你的 AI 桌面伙伴

> **与你的代码对话，让 AI 处理繁重工作。**

[**English**](./README.md) · **中文**

**Fello** 是一款基于开放 [**ACP（Agent Client Protocol）**](https://agentclientprotocol.com/) 协议打造的桌面 AI 工作台。它不绑定任何单一 AI 厂商——既可以连接本地 Agent（通过 ACP，如 `kiro-cli acp`），也可以连接任意 OpenAI 兼容 API，并将对话、文件、终端、Diff、项目记忆和 MCP 工具整合在一个原生应用里。

![Fello 截图](screenshots/screenshot-theme.png)

[**⬇️ 下载 Fello**](https://github.com/Zythum/fello/releases)

---

## 📖 用户手册

🚀 [**Fello 用户手册**](./guides/zh-CN/README.md) — 快速开始、Agent 配置、MCP 设置等完整指南。

---

## Fello 是什么？

大多数 AI 工具会把你和某一家模型、某个订阅、某种工作方式绑定。Fello 走的是另一条路：它不是又一个 Agent，而是一个 **Agent 中立的桌面客户端**，让你自由接入自己选择的 Agent。

- 🧩 基于开放协议 ACP 构建——如同 LSP 之于语言服务，ACP 之于 AI Agent
- 🔁 自带 Agent：本地 Stdio Agent 或 OpenAI 兼容 API 均可接入
- 📂 在真实的工作区中协作：对话旁即是文件、终端与 Diff

## 适合谁？

- **开发者** — 想自由切换多个 Agent、不被单一厂商绑定
- **关注隐私的用户** — 希望本地优先运行 AI
- **团队** — 需要远程访问或私有化部署

---

## 为什么选择 Fello？

- 🧩 **不绑定任何厂商** — 接入任意支持 ACP 的 Agent 或任意 OpenAI 兼容 API，会话之间自由切换。工具由你决定。

- 🔒 **本地优先、数据自持** — 在本地运行 Agent，代码与数据留在你的机器上。除非你主动选择云端 API，否则数据不会离开你的电脑。

- 🖥️ **一体化工作台** — 在 AI 对话旁浏览、编辑、预览文件、查看 Diff，并同时运行终端。一体面板，实时联动。

- 🧠 **项目级持久记忆** — 跨会话保存项目约定、偏好、决策和纠正信息，并通过定向检索与事务更新保持准确。

- 🛡️ **细粒度权限控制** — 可逐一确认每个工具调用，也可用"始终允许"记忆免去重复确认。一切尽在掌握。

- 🌐 **远程访问与私有部署** — 在局域网内通过浏览器使用 Fello，或将无头服务器部署到自己的机器上。完整功能，毫无妥协。

- ⏰ **自动化** — 通过 cron 表达式配置定时 AI 任务。日报生成、定期检查等重复性工作流，自动执行。

- 💬 **微信 iLink** — 将 Fello 接入微信，在桌面端收发消息，时刻在线。

- 🎨 **美观现代的界面** — 深色/浅色主题、标签面板、流畅的流式对话。

---

## ⚡ 深度适配

Fello 不止"能接入"Kiro 和 CodeBuddy，还为它们提供了**量身定制的深度优化**，开箱即用体验更顺滑。

**Kiro**（[配置指南](./guides/zh-CN/agents-kiro.md)）

- 📊 **实时上下文用量** — 随时查看上下文窗口的使用情况。
- ⌨️ **斜杠命令** — 自动识别 Kiro 的斜杠命令并展示在对话界面中。
- 🤖 **子任务状态** — Kiro 的子代理以实时子任务形式呈现，状态同步更新。

**CodeBuddy**（[配置指南](./guides/zh-CN/agents-codebuddy.md)）

- 👥 **Agent Teams 多智能体协作** — 成员与子任务状态（进行中/完成/失败）实时展示。
- 🔁 **回合回放过滤** — CodeBuddy 在新回合开始时可能重播上一轮消息，Fello 自动过滤，聊天记录保持干净。
- ⚙️ **自动环境配置** — 自动注入推荐的运行环境变量，免去手动设置。

---

## 快速开始

1. **下载**适用于 macOS / Windows / Linux 的 Fello：[Releases](https://github.com/Zythum/fello/releases)。
2. **添加 Agent** — 本地 Stdio Agent（ACP 协议）或 OpenAI 兼容 API。参见[《Agent 配置指南》](./guides/zh-CN/agents.md)。
3. **开始对话** — 创建项目、开启会话，让 AI 处理繁重工作。

📖 完整指南：[Fello 用户手册](./guides/zh-CN/README.md)

---

## 📱 随时随地使用

Fello 不只是一款桌面应用——你可以通过微信或局域网内的任意浏览器随时与 Agent 协作。

### 💬 微信 iLink

将 Fello 接入微信：随时随地收发消息，时刻在线。

1. 打开 Fello → **设置** → **WeChat iLink**
2. 点击 **Connect**，用微信扫描二维码
3. 在侧边栏右键点击会话 → **「设为微信活跃会话」**

微信收到的消息会自动注入该会话，Agent 的回复也会自动通过微信发送回去。

> 💡 详细教程：[微信 iLink 指南](./guides/zh-CN/wechat-ilink.md)

### 🌐 WebUI 远程访问

在局域网内用任意浏览器使用 Fello 的完整界面——访问端无需安装任何软件。

1. 打开 Fello → **设置** → **WebUI**
2. 开启 **WebUI 服务** 开关，设置端口（默认自动分配）与访问 Token
3. 在同网络的浏览器中打开显示的访问链接

> 💡 详细教程：[WebUI 远程访问指南](./guides/zh-CN/webui.md)

---

## 支持平台

| 平台 | 桌面应用 | WebUI 远程访问 |
|----------|-------------|---------------------|
| macOS | ✅ | ✅ |
| Windows | ✅ | ✅ |
| Linux | ✅ | ✅ |
| 服务器（无头模式） | — | ✅ 通过浏览器访问（`@zythum02/fello-server`） |

---

## 社区与支持

- 📖 [用户手册](./guides/zh-CN/README.md)
- 🐛 [GitHub Issues](https://github.com/Zythum/fello/issues) — 反馈问题与功能建议
- 📜 [GPL-3.0-or-later](./LICENSE) — 开源协议

---

## 给开发者

Fello 是开源的。想要二次开发、自定义或参与贡献？请查看[**开发者指南**](./DEVELOPER.md)。

---

**由 [Zythum](https://github.com/Zythum) 用 ❤️ 构建** · GPL-3.0-or-later
