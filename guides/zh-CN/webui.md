# WebUI 远程访问

> 🌐 **WebUI 远程访问**让你在同一局域网内的任何浏览器中使用 Fello 的完整功能——无需安装客户端，手机、平板、其他电脑都能用。

## 工作原理

Fello 桌面端内置了一个 WebUI 服务器。开启后，同网络的设备可以通过浏览器访问 Fello 的完整界面，所有操作通过 WebSocket 与桌面端主进程实时通信。如果需要在局域网之外访问，还可以再开启一条公网隧道（见下文「公网隧道」）。

---

## 启动 WebUI 服务

### 方式一：在桌面客户端中开启

1. 打开 Fello → **Settings**
2. 找到 **WebUI** 区域
3. 开启 WebUI 服务开关
4. 配置端口号（默认自动分配）
5. 设置访问 Token（用于安全验证）

| 配置项 | 默认值 | 说明 |
|--------|-------|------|
| 端口 | 自动分配 | WebUI 服务监听端口，可自定义 |
| Token | （需设置） | 访问密码，防止未授权访问 |

### 方式二：通过服务器部署（Headless）

无需桌面环境，适合 Linux 服务器或 CI 环境。

```bash
# 通过 npx 直接运行（无需安装）
npx @zythum02/fello-server --port 9090 --token mysecret

# 或全局安装后运行
npm install -g @zythum02/fello-server
fello-server -p 9090 -t mysecret
```

| 参数 | 缩写 | 说明 |
|------|------|------|
| `--port` | `-p` | 监听端口，默认自动分配 |
| `--token` | `-t` | 访问 Token，未设置时自动生成随机值 |

---

## 在浏览器中访问

开启服务后，Fello 会显示完整的访问链接（含 Token）。在同一局域网的设备浏览器中打开即可：

```
http://<本机IP>:<端口>/?token=<你设置的Token>
```

> 💡 **查看本机 IP：** macOS 可在「系统设置 → Wi-Fi → 详细信息」中查看，或终端运行 `ifconfig | grep inet`

---

## 公网隧道（devtunnel / ngrok）

同一局域网之外（例如手机使用 4G/5G）也想访问时，可以在 WebUI 开启后，再为它叠加一条公网隧道，把访问地址变成公网可用的 HTTPS 链接。`devtunnel` 与 `ngrok` 相互独立，**可以同时开启**，也可以只开其中一个。

> ⚠️ 隧道会把 WebUI 暴露到公网。请务必使用高强度 Token，并且只在需要时开启。

### 前提：安装并登录对应命令行工具

Fello 会调用本机的 `devtunnel` 或 `ngrok` 命令，**只有检测到命令可用时**，设置页里对应的开关才可用。检测范围包括 `PATH`，以及 Homebrew、`~/.dotnet/tools` 等常见安装目录。点击设置页里的 `devtunnel` / `ngrok` 名称可直接打开对应官网，查看安装与登录说明。

#### devtunnel（Microsoft Dev Tunnels）

| 平台 | 安装命令 |
|------|---------|
| macOS | `brew install devtunnel` |
| Windows | `winget install Microsoft.devtunnel` |
| Linux | `curl -sL https://aka.ms/DevTunnelCliInstall \| bash` |

首次使用前需要登录一次（即使允许匿名访问，隧道主机也必须登录）：

```bash
devtunnel user login
```

Fello 实际执行的是：

```bash
devtunnel host -p <WebUI端口> --allow-anonymous -l fello -d "Fello WebUI"
```

`--allow-anonymous` 让外部设备无需登录 Microsoft 账号即可访问，访问权限由 WebUI 自己的 Token 控制。`-l fello -d "Fello WebUI"` 给隧道打上标签和描述，Fello 用它认出「自己创建的那条」：关闭开关或退出应用时会自动删除该隧道（不影响同账号下的其它隧道）；万一账号配额已满（每账号 10 条）导致创建被挡住，会先删掉一条最早的 Fello 遗留隧道再重试。

#### ngrok

| 平台 | 安装命令 |
|------|---------|
| macOS | `brew install ngrok/ngrok/ngrok` |
| Windows | `winget install ngrok.ngrok` |
| 其他 | 从 [ngrok 官网](https://ngrok.com/download) 下载并解压到 `PATH` |

首次使用前配置 authtoken（只需一次）：

```bash
ngrok config add-authtoken <你的 authtoken>
```

Fello 实际执行的是：

```bash
ngrok http --log=stdout --log-format=json http://127.0.0.1:<WebUI端口>
```

### 在设置中开启隧道

1. 打开 Fello → **Settings → WebUI**，先开启 WebUI 服务
2. 在下方「公网隧道」区域查看检测结果：
   - **已检测到**：可直接打开开关
   - **未安装**：先按上面的命令安装对应 CLI，安装后点击右上角「重新检测」
3. 打开对应卡片右侧的开关（另一个提供方不受影响，可以同时打开）
4. 等待该卡片的徽标从「正在启动…」变为「运行中」，卡片内会直接显示带 Token 的「隧道访问地址」
5. 点击地址右侧的复制按钮，把完整地址发到需要访问的设备

> 💡 隧道地址形如 `https://<隧道ID>.devtunnels.ms/?token=<Token>` 或 `https://<隧道ID>.ngrok-free.dev/?token=<Token>`，**必须保留 `?token=` 部分**，否则会被 WebUI 拒绝访问。

### 关闭隧道

- 关闭对应提供方卡片中的开关（只停止这一条，另一条继续运行）；启动过程中关闭开关即取消启动
- devtunnel 还会删除本次创建的隧道，服务端不会留下垃圾记录；ngrok 的会话随进程退出自动释放
- 或直接关闭 WebUI 服务 / 退出 Fello：所有隧道会随之停止，公网地址立即失效，devtunnel 同样会被删除

### 常见问题

| 现象 | 处理方式 |
|------|---------|
| 显示「未安装」 | 确认 CLI 已安装并在 `PATH` 中。从 Finder / 开始菜单启动的 App 可能拿不到 shell 的完整 PATH；Fello 已额外搜索 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.dotnet/tools` 等目录 |
| devtunnel 启动失败并提示登录 | 先在终端执行 `devtunnel user login` |
| devtunnel 提示 `Rate limit exceeded` | 通常不是没登录，而是账号下隧道达到 10 条上限：Fello 会先删除一条最早的遗留隧道（标签 `fello` + 描述 `Fello WebUI` 且无活跃连接）再重试；如果仍然失败，用 `devtunnel list` 查看并用 `devtunnel delete <隧道ID>` 手工清理 |
| ngrok 启动失败并提示 authtoken | 先执行 `ngrok config add-authtoken <Token>` |
| ngrok 提示 `endpoint ... already online`（`ERR_NGROK_334` / `ERR_NGROK_108`） | 账号的静态域名已被另一个 ngrok 进程或另一个 Fello 实例占用：先停掉那个会话（`pkill ngrok` 或退出另一个 Fello）再重试。免费版同一个 endpoint 只允许一条会话 |
| 浏览器打开 ngrok 地址先出现提示页 | ngrok 免费版的流量提醒页，点击「Visit Site」继续即可 |
| 隧道地址打不开 | 确认 WebUI 仍在运行：隧道只转发当前 WebUI 端口，WebUI 停止后隧道也会停止 |

---

## WebUI 支持的功能

| 功能 | 支持 | 备注 |
|------|------|------|
| AI 对话 | ✅ | 流式响应、工具调用、权限交互 |
| 文件工作区 | ✅ | 浏览、预览、编辑文件 |
| 终端 | ✅ | 创建和使用终端 |
| 新建项目/会话 | ✅ | 完整的项目和会话管理 |
| MCP 服务器切换 | ✅ | 动态启停 MCP 服务器 |
| 设置修改 | ✅ | Agent、MCP 等配置 |

---

## 使用场景

- 📱 **移动设备** — 手机、平板随时查看对话进度或发送指令
- 💡 **多屏协作** — 在另一台电脑打开 Fello，无需重复安装配置
- 🐧 **Headless 服务器** — 在无桌面的 Linux 服务器上运行 `fello-server`，通过浏览器远程操作

---

## 安全注意事项

> ⚠️ **安全须知：**
> - **Token 即权限** — 知道 Token 的人可以完全操作 Fello（文件读写、终端执行、AI 对话），务必使用高强度字符串
> - **默认仅限局域网** — WebUI 默认只绑定局域网 IP，不要通过不可信端口映射暴露到公网；需要外网访问时请使用上文的公网隧道
> - **公网隧道 = 公网暴露** — 开启 devtunnel / ngrok 后，任何拿到完整隧道地址（含 Token）的人都能从公网操作 Fello（文件读写、终端执行、AI 对话）；如果 Fello 运行在公司内网、办公室电脑或其他敏感环境，开启前请确认网络与安全策略，谨慎开启，不用时立即关闭
> - **HTTP 明文** — 局域网直连时 WebUI 使用 HTTP 协议（非 HTTPS），同网络的流量可能被监听；公网隧道地址本身是 HTTPS（TLS 由隧道服务终止）。在公共 WiFi 中使用需额外注意
> - **不用时关闭** — WebUI 服务不使用时建议关闭，减少攻击面
> - **剪贴板限制** — HTTP 环境下浏览器的粘贴功能受限（`navigator.clipboard` 需 HTTPS），复制可用但粘贴按钮不可用；通过 HTTPS 隧道访问时不受此限制

---

## 📖 相关文档

| 文档 | 关联说明 |
|------|---------|
| ← [快速开始](./quick-start.md) | 从这里来：远程访问入门 |
| → [权限控制与安全](./permissions.md) | WebUI Token 的安全机制详解 |
| → [微信 iLink](./wechat-ilink.md) | 另一种远程使用 Fello 的方式 |
