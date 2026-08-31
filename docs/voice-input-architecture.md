# 语音输入架构（Voice Input）

> 实时语音输入（realtime ASR）在 Fello 中的完整架构：渲染层采集音频 → IPC 上行 →
> 主进程 ASR 会话 → 事件回传 → 输入框转写插入，以及服务商配置管理。
>
> 后端基于 [`unified-realtime-asr`](https://github.com/zythum/unified-realtime-asr)
>（纯 Node / `ws` 实现，只能运行在主进程），一套 `createASRClient(config)` 接口覆盖
> DashScope（通义百炼）、Volcengine（火山引擎）、OpenAI Realtime、IFlytek（讯飞）四家后端。

---

## 1. 模块划分

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 渲染层 UI | `src/mainview/components/common/voice-input-button.tsx` | 麦克风按钮、设备选择、录音波形、partial/final 转写插入、录音状态管理 |
| 渲染层采集 | `src/mainview/components/common/use-realtime-asr.ts` | `getUserMedia` + AudioWorklet 降采样转 PCM、IPC 上行、ASR 事件订阅与过滤 |
| IPC 契约 | `src/shared/schema.ts` | 上行 `startRealtimeAsr` / `sendRealtimeAsrFrame` / `stopRealtimeAsr`；下行 `asr-transcript` / `asr-error` / `asr-closed` |
| 主进程 ASR | `src/backend/speech/manager.ts` | ASR 会话生命周期、`unified-realtime-asr` 客户端构建、事件广播 |
| 设置存储 | `src/backend/storage/settings.ts` | `speechToText` provider 数组的读取/校验/持久化（与 imageGeneration 同范式） |
| 设置页 | `src/mainview/components/settings/speech-to-text/` | 服务商配置管理：列表 + 编辑对话框（每家一个独立表单） |

## 2. 数据流

```
Renderer（VoiceInputButton / useRealtimeAsr）        Main Process（speech/manager.ts）
┌──────────────────────────────────────┐            ┌──────────────────────────────────┐
│ getUserMedia → AudioContext           │            │ startRealtimeAsr                  │
│  → AudioWorklet（48k→16k，f32→i16）    │  start     │  → createASRClient(config)        │
│  → 每 20ms 一帧（320 samples）         │ ─────────▶ │  → client.connect()               │
│                                      │            │                                  │
│ 帧 → base64 → sendRealtimeAsrFrame   │  audio     │  client.sendAudio(pcm)            │
│  （fire-and-forget）                  │ ═════════▶ │                                  │
│                                      │            │  client.on("transcript") ────┐   │
│ asr-transcript / asr-error           │  event     │  client.on("error")          │   │
│  → 按 clientId+asrSessionId 过滤      │ ◀───────── │  client.on("close")  ◀───────┘   │
│  → 就地插入/替换输入框文本             │            │                                  │
│ stopRealtimeAsr（提交/超时/卸载）       │ ─────────▶ │  client.close()                  │
└──────────────────────────────────────┘            └──────────────────────────────────┘
```

- **上行音频用 fire-and-forget 的 request**（`sendRealtimeAsrFrame` 返回 void，前端不 await）：音频是高频小包（20ms/640B 一帧），不需要逐帧应答，避免背压堆积。
- **下行结果用事件**：`asr-transcript` / `asr-error` / `asr-closed`，与 `session-update` 同款推送机制；事件按 `clientId + asrSessionId` 过滤，天然隔离多窗口/多会话。

## 3. 音频采集与格式转换（use-realtime-asr.ts）

- `getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })`。
- **AudioWorklet**（内联 worklet 源码，避免额外打包步骤）在音频线程完成：
  1. Float32 `[-1, 1]` → Int16 `[-32768, 32767]`；
  2. 48kHz → 16kHz 线性插值降采样（`ratio = sampleRate / 16000`）；
  3. 按 320 samples（20ms @16k）切帧，`postMessage` 回主线程。
- 主线程把帧 `Int16Array` 转 base64（分块 `String.fromCharCode`，避免栈溢出），经 `request.sendRealtimeAsrFrame` 上行；同时计算 RMS 音量供按钮波形展示（rAF 节流，不阻塞渲染）。
- 音频帧上行只在 `stoppedRef` 为 false 且会话 id 匹配时进行，保证 stop 后不再发送。

## 4. 会话与生命周期

**后端（manager.ts）**：
- 一次录音 = 一个后端 ASR client；会话表 `Map<"${clientId}:${asrSessionId}", ActiveAsrSession>`。
- `start`：取当前 `active` provider → `createASRClient(buildConfig(provider))` → `connect()`；重复 start 幂等返回。
- `frame`：`Buffer.from(audioB64, "base64")` → `client.sendAudio(pcm)`；会话不存在或发送异常时通过 `asr-error` 上报。
- `stop`：`await client.close()`（等最后的 final 到达）→ 移除监听与会话。
- `closeAll`：应用 `closeBackend` 时兜底清理全部活跃连接，避免退出卡住。

**前端（useRealtimeAsr / VoiceInputButton）**：
- 录音状态用 ref + state 双轨（`recordingRef` 供事件回调同步读取），`stoppedRef` / `stoppingRef` 处理 stop 与断连重入的竞态。
- 主动停止时机：提交消息、切换会话、组件卸载、`disabled` 变化、超过录音时长上限（默认 5 分钟）。
- 服务端异常断连（`asr-closed` 且非主动停止）→ toast 提示并自动走 stop 清理。

## 5. 转写插入与段落管理（voice-input-button.tsx）

- 输入框写入使用 `document.execCommand("insertText")`：MentionsInput 是受控 textarea，直接 setState 会丢失光标；execCommand 模拟用户输入，触发 input 事件让组件正常更新。
- **段落 Map** `Map<key, { start, length }>`，key 优先级：`transcript.id`（服务端稳定句 id）→ `index`（1-based 句序号）→ 本地流式序号。
  - partial：在段落起点**原地替换**文本（不追加新行）；
  - final：删除该段落、光标移动到句尾，后续句子从新位置继续。
- 用户手动编辑输入框（`input` 事件且非 ASR 写入）→ `freezeAsrSegments`，后续识别从当前光标位置重新开始。
- 录音开始前在光标处补一个空格分隔，避免与前文粘连。
- 麦克风设备选择结果保存在 `localStorage`（`fello.voice-input.device-id`），下次直接使用；设备失效则重新弹出选择菜单。

## 6. 服务商配置模型

**持久化结构**（`shared/schema.ts` 的 `SpeechToTextProviderInfo`，扁平可选字段，凭据只被主进程使用）：

| provider | 必填 | 可选（含默认值） |
| --- | --- | --- |
| `dashscope` | apiKey | model（默认 `fun-asr-flash-8k-realtime`）、workspaceId + region（拼专属域名）、workspace（`X-DashScope-WorkSpace` 请求头）、language |
| `volcengine` | apiKey | appId、resourceId（默认 `volc.seedasr.sauc.duration`）、baseUrl、language |
| `openai` | apiKey | model（默认 `gpt-4o-transcribe`）、baseUrl、language |
| `iflytek` | apiKey、appId、apiSecret | baseUrl、language |

- 通用字段：`name`（显示名）、`provider`、`language`、`active`（同一时间仅一个启用）。
- 设置页采用「公共字段 + 每家独立表单」结构：Dialog 持有 `name`/`provider`（公共 form），四个表单组件（`dashscope-form` / `volcengine-form` / `openai-form` / `iflytek-form`）各自 `useForm` + zod schema + 校验 + `toProviderPart` 映射，完全自包含；提交时 Dialog 汇总公共字段与当前 provider 表单结果。
- 后端 `buildConfig` 按 provider 把扁平配置映射为 `unified-realtime-asr` 的 `ASRConfig`，必填项缺失时抛错并经 `asr-error` 提示。

## 7. 权限与打包

- **Electron 权限**：`src/electron/main.ts` 注册 `setPermissionCheckHandler` / `setPermissionRequestHandler`，仅放行 `media`（麦克风）。
- **macOS**：`resources/entitlements.mac.plist` 声明 `NSMicrophoneUsageDescription`，electron-builder `extendInfo` 注入，否则首次使用会被系统拦截。
- 凭据（API Key / App ID / API Secret）只保存在本机设置文件，渲染层仅通过 IPC 读取，不落 localStorage。

## 8. 关键设计决策

| 决策 | 理由 |
| --- | --- |
| ASR 客户端只跑主进程 | `unified-realtime-asr` 依赖 Node `ws`/Buffer，渲染层无法直接使用 |
| 音频上行 fire-and-forget | 20ms 高频小包无需应答，避免逐帧等待与背压 |
| 事件按 `clientId + asrSessionId` 过滤 | 支持多窗口/多会话隔离，`asrSessionId` 前端生成、与聊天 `sessionId` 解耦 |
| PCM 走 base64 | 复用现有 JSON IPC 通道，+33% 体积在局域网可接受 |
| 48k→16k 用 AudioWorklet 线性插值 | 免额外依赖，满足识别精度要求 |
| `execCommand("insertText")` 写入 | 兼容受控 MentionsInput 的光标与 input 事件 |
| 每家 provider 独立表单 | 字段/校验/默认值差异大，独立 schema 避免互相污染 |
