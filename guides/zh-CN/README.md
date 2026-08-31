# Fello 使用手册

[English](./../en/README.md) | 中文

> 🚀 **Fello** 是一款桌面 AI 协作客户端，将本地与云端 AI Agent 无缝融入你的日常开发工作流。本手册帮助你快速上手并充分利用 Fello 的全部能力。


## 📖 手册目录

| 章节 | 内容简介 |
|------|----------|
| [快速开始](./quick-start.md) | 下载安装 → 配置第一个 Agent → 发起第一次对话，5 分钟上手 |
| [Agent 配置与管理](./agents.md) | 添加本地 Stdio Agent 和 API Agent，切换模型，管理多个 Agent |
| → [Kiro 作为 Agent](./agents-kiro.md) | 配置 Kiro Stdio Agent（ACP） |
| → [Kimi 作为 Agent](./agents-kimi.md) | 配置 Kimi API / Stdio Agent + Exa MCP |
| → [CodeBuddy 作为 Agent](./agents-codebuddy.md) | 配置 CodeBuddy Stdio Agent（ACP）+ Agent Teams |
| → [DeepSeek 作为 Agent](./agents-deepseek.md) | 配置 DeepSeek API Agent + Exa MCP |
| [MCP 服务器配置](./mcp-servers.md) | 为 Agent 扩展工具能力，配置 Stdio 和 HTTP 类型的 MCP 服务器 |
| [语音识别](./speech-to-text.md) | 配置实时语音识别服务商，在聊天输入框中使用麦克风输入 |
| [文件工作区与终端](./file-workspace.md) | 文件浏览、编辑、预览、Diff 对比，以及终端的创建和使用 |
| [WebUI 远程访问](./webui.md) | 在局域网浏览器中远程使用 Fello 的完整功能 |
| [微信 iLink](./wechat-ilink.md) | 将 Fello 接入微信，在桌面端收发消息 |
| [权限控制与安全](./permissions.md) | 工具权限管理、"始终允许"记忆、权限模式切换 |
| [Skills 技能](./skills.md) | 浏览和安装 Skills，为 Agent 扩展专业技能 |

---

## 🌟 Fello 能做什么

- 🧠 **多种 Agent 支持** — 运行本地 Stdio Agent（通过 ACP 协议）或连接 OpenAI 兼容 API，会话间自由切换
- 🔧 **MCP 服务器集成** — 动态配置 MCP 服务器，为 Agent 扩展更多工具能力
- 📁 **文件工作区 + 终端** — 在 AI 对话旁浏览、编辑、预览文件，同时运行终端，一体面板实时联动
- 🌐 **WebUI 远程访问** — 在同网络的浏览器中远程使用 Fello 的全部功能
- 💬 **微信 iLink** — 将 Fello 接入微信，在桌面端收发消息，时刻在线
- 💡 **权限控制** — 细粒度的工具权限管理，支持"始终允许"记忆

---

## 下载安装

前往 GitHub Releases 页面下载最新版本：

👉 [Fello Releases - GitHub](https://github.com/Zythum/fello/releases)

## 💻 支持平台

| 平台 | 桌面客户端 | WebUI 远程访问 |
|------|-----------|---------------|
| macOS | ✅ 原生支持 | ✅ 浏览器访问 |
| Windows | ✅ 原生支持 | ✅ 浏览器访问 |
| Linux | ✅ 原生支持 | ✅ 浏览器访问 |

> 💡 **提示：** 安装完成后，请阅读「[快速开始](./quick-start.md)」章节，5 分钟即可完成第一次 AI 对话。

---

## 部署到服务器

除了桌面客户端，Fello 还支持以无头模式（Headless Server）部署到服务器，无需图形界面，通过浏览器即可远程访问完整功能。

### 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Linux / macOS / Windows（任何支持 Node.js 的系统） |
| Node.js | >= 20.x |
| 网络 | 开放一个端口供浏览器访问（默认随机分配） |
| 显示器 | ❌ 不需要（无头运行） |

### 通过 npm 包部署

> 🚀 最快的方式，一行命令即可启动服务。

```bash
# 无需安装，直接运行（推荐）
npx @zythum02/fello-server --port 9090 --token mysecret

# 或全局安装后运行
npm install -g @zythum02/fello-server
fello-server -p 9090 -t mysecret
```

启动后，在浏览器中访问：

```
http://<服务器IP>:9090/?token=mysecret
```

> 💡 **参数说明：**
> - `--port` / `-p`：监听端口，默认随机分配
> - `--token` / `-t`：访问密钥，用于 WebUI 认证

### 通过源码部署

适合需要自定义或二次开发的场景：

```bash
# 1. 克隆仓库
git clone https://github.com/Zythum/fello.git
cd fello

# 2. 安装依赖
npm install

# 3. 构建 npm 包
npm run pack:npm

# 4. 启动服务
node npm-package/out/server/main.js --port 9090 --token mysecret
```

> 💡 **注意事项：**
> - 建议通过 `pm2` 或 `systemd` 等进程管理工具保持服务常驻
> - 生产环境请设置强密码作为 token
> - 如需 HTTPS 访问，请在前面加一层 Nginx 反向代理
