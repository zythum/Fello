# 🎙️ 语音

Fello 在一个「语音」设置页里同时管理两个方向：**识别**把麦克风中的语音转换为聊天输入框里的文字（也可用于 Ask User 的自定义回复），**合成**把 Agent 的回复朗读出来。

> 🔒 API Key、API Secret 和 App ID 等凭据只保存在本机设置中。请不要把包含真实凭据的配置文件或截图提交到代码仓库。

## 配置语音服务商

1. 打开 Fello → **Settings**（设置）
2. 进入 **Speech**（语音）
3. 点击 **添加服务商**
4. 选择服务商并填写认证信息
5. 保存后，在列表行上打开对应的 **ASR** / **TTS** 开关

两个方向共用同一份凭据。每个方向各有一个开关，且**每个方向最多只有一个服务商处于启用状态**；新增第一个服务商时，Fello 会自动打开它的识别（ASR）开关。

### 通用字段

| 字段 | 说明 |
|------|------|
| **名称** | 在 Fello 中显示的配置名称，可以自定义 |
| **服务商** | 选择 DashScope、Volcengine、OpenAI 或科大讯飞 |
| **API Key** | 服务商提供的 API 密钥 |
| **端点（可选）** | 仅 Volcengine / OpenAI / 讯飞显示。留空使用服务商默认端点；使用兼容服务或代理时可以填写自定义 WebSocket/HTTP 端点 |
| **语言（可选）** | 识别语言代码，默认 `zh-CN` |

### DashScope

需要填写 API Key。**Model 为可选项**，省略时使用 `fun-asr-flash-8k-realtime`；也可以填写通义支持的其他实时模型。

DashScope **无需填写端点**：默认使用 `dashscope.aliyuncs.com`；填写 **Workspace ID** 并选择 **Region** 后，会自动使用业务空间专属域名（`wss://{WorkspaceId}.{region}.maas.aliyuncs.com/...`）。

使用 RAM 子账号或子业务空间的 API Key 时，还需要填写 **Workspace**（业务空间 ID，作为 `X-DashScope-WorkSpace` 请求头发送）。

**接口文档**：[通义 Fun-ASR 实时语音识别（阿里云百炼）](https://platform.qianwenai.com/docs/developer-guides/speech/asr-realtime)

### Volcengine

需要填写 API Key。根据服务配置，可以填写：

- **Resource ID**：可选；省略时使用 `volc.seedasr.sauc.duration`
- **App ID**（可选）：火山引擎应用 ID

**接口文档**：[豆包流式语音识别（火山引擎）](https://docs.volcengine.com/docs/6561/1354869?lang=zh)

### OpenAI

需要填写 API Key。模型默认为 `gpt-4o-transcribe`，也可以填写其他兼容服务支持的模型。

如果使用 OpenAI 兼容服务，可填写对应的 **Endpoint** 和 **Model**。

**接口文档**：[OpenAI Realtime Transcription](https://platform.openai.com/docs/guides/realtime-transcription)

### 科大讯飞

需要填写以下字段：

- **App ID**
- **API Key**
- **API Secret**

**接口文档**：[实时语音转写大模型版（科大讯飞）](https://www.xfyun.cn/doc/spark/asr_llm/rtasr_llm.html)

## 语音合成（朗读）

合成复用同一份服务商配置（凭据与识别共源）；**音色**和**模型**在弹窗的 **合成** 分节里配置。

1. 打开 Fello → **Settings**（设置）→ **Speech**（语音）
2. 编辑一个服务商（或新增），在 **合成** 分节填写 **音色**；留空则使用默认音色，**模型** 可选
3. 保存后，在列表行上打开该服务商的 **TTS** 开关

默认音色（**音色** 留空时使用）：OpenAI `coral`、DashScope `longanhuan_v3.6`、科大讯飞 `x5_lingxiaoxuan_flow`、Volcengine `zh_female_vv_uranus_bigtts`。

朗读入口：

- **自动朗读**：会话头部打开喇叭菜单并启用「自动朗读回复」，同一菜单可调音量。自动朗读只跟随当前显示的会话，切换会话或发起新一轮时会停止。
- **朗读某条回复**：鼠标悬停在 Agent 回复分组上，点击朗读按钮。

新的朗读（手动点朗读，或发起新一轮）会接管播放通道：正在朗读的内容会立即停止且不会续读。会话头部的「正在朗读」药丸可随时停止播放。

## 在聊天中使用

1. 打开一个会话，将光标放入聊天输入框
2. 点击输入框工具栏中的麦克风按钮
3. 第一次使用或保存的麦克风不可用时，选择一个音频输入设备
4. 选择的设备会保存在本机浏览器的 localStorage 中，后续点击麦克风会直接使用该设备
5. 点击右侧箭头可以随时重新选择麦克风
6. 录音时再次点击展开的录音按钮即可停止

语音识别支持 partial（临时结果）和 final（最终结果）。临时结果会在同一段文字区域内更新，不会不断追加重复内容；手动编辑输入框后，后续识别会从新的光标位置开始。

默认单次录音最长 5 分钟。达到时长上限后，Fello 会自动停止录音。

## Ask User 自定义回复

当 Agent 请求自定义回复时，切换到输入模式即可使用同样的麦克风按钮。识别文字会写入受控的回复输入框，并保留 `#` 文件引用和 `@` mention 功能。

## 常见问题

| 问题 | 解决方案 |
|------|---------|
| 麦克风按钮不显示 | 在 Settings → Speech（语音）中添加服务商，并打开它的 **ASR** 开关 |
| 不会朗读任何内容 | 在 Settings → Speech（语音）中添加服务商，并打开它的 **TTS** 开关 |
| 朗读中途停止 | 新的朗读（点朗读按钮或发起新一轮）会接管播放通道，这是设计行为 |
| 没有音频输入设备 | 检查系统麦克风权限和设备连接，然后重新打开麦克风菜单 |
| 认证失败 | 检查 API Key，以及对应服务商所需的 App ID、API Secret 或 Resource ID |
| 设备选择失效 | 点击右侧箭头重新枚举设备并选择当前可用的麦克风 |
| 识别结果没有写入 | 先点击输入框获得焦点，并确认页面允许麦克风权限 |

## 相关文档

| 文档 | 说明 |
|------|------|
| ← [快速开始](./quick-start.md) | 创建第一个 Agent 并开始对话 |
| → [Agent 配置与管理](./agents.md) | 配置 Fello 使用的 AI Agent |
| → [MCP 服务器配置](./mcp-servers.md) | 为 Agent 扩展更多工具能力 |
