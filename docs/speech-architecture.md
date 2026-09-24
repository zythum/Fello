# 语音架构（识别 ASR + 合成 TTS）

> Fello 语音能力的完整架构：**识别**（渲染层采集音频 → IPC 上行 → 主进程 ASR 会话 →
> 事件回传 → 输入框转写插入）与**合成**（渲染层朗读会话分句 → 主进程无状态转发 →
> 音频回传 → Web Audio 播放），以及两侧共用的服务商配置管理。
>
> 后端基于 [`unified-realtime-asr`](https://github.com/zythum/unified-realtime-asr)
>（纯 Node / `ws` 实现，只能运行在主进程），`createASRClient(config)` / `createTTSClient(config)`
> 覆盖 DashScope（通义百炼）、Volcengine（火山引擎）、OpenAI、IFlytek（讯飞）四家后端 ——
> 识别与合成**共用同一条 Provider 记录**（凭据同源），允许的方向与取值见第 6 节。

---

## 1. 模块划分

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 渲染层 UI | `src/mainview/components/common/voice-input-button.tsx` | 麦克风按钮、设备选择、录音波形、partial/final 转写插入、录音状态管理 |
| 渲染层采集 | `src/mainview/components/common/use-realtime-asr.ts` | 两种音频源（麦克风 / 外设）：麦克风走 `getUserMedia` + AudioWorklet 降采样转 PCM，外设直接消费主进程 PCM；共用 IPC 上行、ASR 事件订阅与过滤 |
| 渲染层语音面板 | `src/mainview/lib/peripherals/voice-panel-provider.tsx` | 外设 PTT 面板状态机（按住录音 / 复核发送）、转写按会话累积，结构与样式在 `chat-textarea.tsx` |
| 外设音频源 | `src/electron/peripherals/` | BLE（ATVV）链路：恢复已连接外设或扫描、ATVV 会话、ADPCM 解码为 16k/16bit/mono PCM，经 `peripheral-audio` 事件推给渲染层 |
| IPC 契约 | `src/shared/schema.ts` | 上行 `startRealtimeAsr` / `sendRealtimeAsrFrame` / `stopRealtimeAsr`、`startTts` / `speakTts` / `endTts`；下行 `asr-transcript` / `asr-error` / `asr-closed`、`tts-audio` / `tts-error` / `tts-closed`；外设另有 `peripheral-audio` / `peripheral-audio-state` |
| 主进程 ASR | `src/backend/speech/asr-manager.ts` | ASR 会话生命周期、`unified-realtime-asr` 客户端构建、事件广播；音频帧在 `connect()` 完成前（`ready = false`）与 not-connected 时直接丢弃 |
| 主进程 ASR 配置 | `src/backend/speech/asr-config.ts` | Provider 配置 → `ASRConfig` 映射（实时语音输入与音频文件转写共用），`getActiveAsrProvider()` 取当前启用识别的 Provider |
| 主进程 TTS | `src/backend/speech/tts-manager.ts` | **无状态转发**：收到一句话就 `sendText` + `flush`，音频经 `tts-audio` 推回渲染层；不碰文本、不攒队列（见第 10 节） |
| 主进程 TTS 配置 | `src/backend/speech/tts-config.ts` | Provider 配置 → `TTSConfig` 映射，`getActiveTtsProvider()` 取当前启用合成的 Provider |
| 两侧共用工具 | `src/backend/speech/util.ts` | 凭证读取（`optionalString` / `requireField`）与 `errorMessage`，避免识别 / 合成两份实现漂移 |
| 语音默认值 | `src/shared/speech.ts` | 识别默认模型与合成默认音色（`effectiveAsrModel` / `effectiveTtsVoice`）：主进程解析、设置页占位符与列表摘要共用同一份值 |
| 渲染层朗读 | `src/mainview/lib/tts/` | `tts-reader.ts` 朗读会话（分句调度、抢占与抑制）、`tts-text.ts` 分句器、`tts-player.ts` 播放、`tts-prefs.ts` 偏好、`use-tts-auto-read.ts` 自动朗读订阅（见第 10 节） |
| 音频文件转写 | `src/backend/speech/transcribe.ts` + `ffmpeg.ts` | Toolbox `audio_transcribe` 工具的实现：系统 ffmpeg 解码 → 实时 ASR → 拼接文本（见第 9 节） |
| 设置存储 | `src/backend/storage/settings.ts` | `speechProviders` provider 数组的读取/校验/持久化（与 imageGeneration 同范式；读取时兼容旧 `speechToText` 列表） |
| 设置页 | `src/mainview/components/settings/speech/` | 服务商配置管理：列表 + 编辑对话框（每家一个独立表单）。列表行上的 ASR / TTS 开关表达「哪个配置被激活」，弹窗只负责配置字段 |

## 2. 数据流

```
Renderer（VoiceInputButton / useRealtimeAsr）        Main Process（speech/asr-manager.ts）
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

### 外设音频源（`source: "peripheral"`）

- 音频不来自本机麦克风：主进程的 BLE 通道把 ATVV ADPCM 解码成 **16k / 16-bit / mono PCM**，
  以 `peripheral-audio` 事件推给渲染层；渲染层不重采样，直接 base64 上行。
- **`captureId` 是跨进程的采集标识**：由 `peripheralVoiceStart` 返回，只有与当前值相等的帧才上行 ——
  这样「上一次采集收尾 flush 期间迟到的帧」（带的是旧 id）不会喂给还在 connecting 的 ASR 客户端。
- 电平显示单独处理：RMS → 开方压缩 → 底噪门限，并在真正开始收音频后设约 300ms 起始静默期，
  避免开麦噪声把波形顶起来。这两项**只影响电平显示**，不影响上行音频。
- 停止语义只有一步 `stop()`：停音频（外设路径会等完遥控器的尾音 flush）→ 关会话（`finish-task`）。
  **关会话不能推迟**：服务端的静音断句要求音频流里真的出现静音（DashScope 的
  `max_sentence_silence` 默认 1300ms），松手后不再送帧服务端就不会自行定稿，尾句 final 要等到
  下一次按住（`start` 先关旧会话）才补发。早期那句「松手只停音频、会话留 5s 等迟到的 delta / final」
  只对**会自行定稿**的服务商成立，已随 `stopStreaming()` 一起删除。
- 面板侧「松手」即调用 `stop()`，尾句定稿于是在复核态里原地替换文本；因此提交 / 取消面板时可能
  撞上正在进行的收尾链，`stop()` 按 in-flight promise 去重（同一条会话上的收尾幂等）。
- 面板可用性与输入框禁用解耦：流式生成期间输入框禁用，但按住语音键照常可用，
  发送时由 `chat-input` 先 `cancelPrompt` 再发送。

## 4. 会话与生命周期

**后端（asr-manager.ts）**：
- 一次录音 = 一个后端 ASR client；会话表 `Map<"${clientId}:${asrSessionId}", ActiveAsrSession>`。
- `start`：取当前启用识别的 provider（`getActiveAsrProvider()`）→ `createASRClient(buildAsrConfig(provider))` → `connect()`；重复 start 幂等返回。
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

**持久化结构**（`shared/schema.ts` 的 `SpeechProviderInfo`，扁平可选字段，凭据只被主进程使用）。
识别与合成**共用一条记录**（凭据同源：同一把 API Key / 应用三元组），方向相关的字段分开存放：

| 方向 | 字段 | 说明 |
| --- | --- | --- |
| 开关 | `asrEnabled` / `ttsEnabled` | 各自独立，**每方向全局至多一个启用**（由列表行上的开关维护） |
| 识别 | `asrModel` / `asrResourceId` | `asrResourceId` 仅 volcengine 识别使用（`volc.seedasr.*` 资源版本） |
| 合成 | `ttsModel` / `voice` | 留空时回落到 `shared/speech.ts` 里的默认值（见下表） |

各家 provider 的字段与默认值：

| provider | 必填 | 可选（含默认值） |
| --- | --- | --- |
| `dashscope` | apiKey | asrModel（默认 `fun-asr-flash-8k-realtime`）、workspaceId + region（拼专属域名）、workspace（`X-DashScope-WorkSpace` 请求头）、language；合成：voice（默认 `longanhuan_v3.6`）、ttsModel |
| `volcengine` | apiKey | appId、asrResourceId（默认 `volc.seedasr.sauc.duration`）、baseUrl、language；合成：voice（默认 `zh_female_vv_uranus_bigtts`，资源版本走库默认 `seed-tts-2.0`） |
| `openai` | apiKey | asrModel（默认 `gpt-4o-transcribe`）、baseUrl、language；合成：voice（默认 `coral`）、ttsModel |
| `iflytek` | apiKey、appId、apiSecret | baseUrl、language；合成：voice（默认 `x5_lingxiaoxuan_flow`） |

- 默认值集中在 `src/shared/speech.ts`（`DEFAULT_ASR_MODELS` / `DEFAULT_TTS_VOICES`），主进程解析、设置页表单占位符与列表摘要共用同一份值。
- 设置页采用「列表 + 每 provider 一个自包含表单」结构：四个表单组件（`speech-dashscope-form` / `speech-volcengine-form` / `speech-openai-form` / `speech-iflytek-form`）各自 `useForm` + zod schema（含 `name` / `provider`）+ `toDraft` 映射；Dialog 只持有「编辑哪条 / 当前哪个 provider / 名称初值」。
- **弹窗内没有启用开关**：识别 / 合成是否生效只由列表行开关决定，弹窗保存时把 `asrEnabled` / `ttsEnabled` 原样回写（不会静默关掉方向）。列表摘要展示的是**生效中的配置**（未配置的字段按默认值计算），与开关状态无关。
- 后端 `buildAsrConfig` / `buildTtsConfig` 按 provider 把扁平配置映射为库的 `ASRConfig` / `TTSConfig`，必填项缺失时抛错并经 `asr-error` / `tts-error` 提示。

## 7. 权限与打包

- **Electron 权限**：`src/electron/main.ts` 注册 `setPermissionCheckHandler` / `setPermissionRequestHandler`，仅放行 `media`（麦克风）。
- **macOS**：`configs/entitlements.mac.plist` 声明 `com.apple.security.device.audio-input`（麦克风）等权限；`NSMicrophoneUsageDescription` 由 electron-builder `extendInfo` 注入到 Info.plist，否则首次使用会被系统拦截。
- **蓝牙（外设语音）**：`configs/entitlements.mac.plist` 另声明 `com.apple.security.device.bluetooth`，`NSBluetoothAlwaysUsageDescription` / `NSBluetoothPeripheralUsageDescription` 同样由 `extendInfo` 注入 Info.plist。
- **macOS「输入监控」（HID 按键）**：**与蓝牙不同，这条链路不需要权限库** —— 系统会在 `IOHIDDeviceOpen`（node-hid 打开设备）时替本进程发起请求，**没有 TCC 记录时弹系统对话框并把 Fello 登记进「输入监控」列表**（Apple 头文件即如此描述 `IOHIDManagerOpen` / `IOHIDDeviceOpen`，macOS 27 实测也会弹窗）。用户拒绝过一次后系统不再弹窗；权限缺失时 `IOHIDDeviceOpen` 返回 `kIOReturnNotPermitted`(0xE00002E2)，node-hid 报错里是 `not permitted`，`src/electron/peripherals/hid-transport.ts` 据此上报「缺少输入监控权限」并给出文案，跳转交给设置页的「输入监控设置」按钮（`openPeripheralPermissionSettings`）由用户主动点。**授权后必须退出并重新打开应用**才生效（该权限对已运行进程无效）。`NSInputMonitoringUsageDescription` 仍由 `extendInfo` 注入 Info.plist 作为声明位。
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
| 外设音频在主进程解码 | ATVV / ADPCM 依赖 UBM 与原生蓝牙栈，只能在主进程；渲染层只接收已解码的 16k PCM |
| 帧与转写都用采集 / 会话标识隔离 | 音频帧按 `captureId`、累积文本按「ASR 会话 + 句 id」，两者都用来丢弃跨会话的迟到数据 |
| 识别与合成共用一条 Provider 记录 | 凭证同源（同一把 API Key / 应用三元组），拆成两份会让用户重复填；方向差异用字段前缀与独立开关表达 |
| 文本整理（净化 / 分句）放在渲染层 | 主进程保持无状态（一句话 in、音频 out），原始 markdown 不出渲染层，过 IPC 的永远是净化好的句子 |
| 默认值放 `shared/` | 主进程解析与设置页展示必须同一份值，避免「界面显示的」与「实际发出去的」不一致 |

## 9. 音频文件转写（Toolbox `audio_transcribe`）

与麦克风实时输入共用同一套 ASR 能力，区别只是音频来源从「麦克风/外设」变成「磁盘上的音频文件」：

```
内置 MCP toolbox（子进程）
  audio_transcribe { path, language?, timeoutSeconds? }
        │ HTTP POST over Unix Socket
        ▼
主进程 backend：transcribeAudioFile()（speech/transcribe.ts）
        │ 1. 系统 ffmpeg：任意格式 → 16k/mono/s16le PCM（stdout 流式）
        │ 2. 按 20ms 帧喂入 createASRClient()（unified-realtime-asr）
        │ 3. 收集 isFinal 片段 → 按句序号拼接
        ▼
返回纯文本
```

- **始终注册，缺配置时给指引**：`audio_transcribe` 工具与其它 toolbox 工具一样始终注册；
  「设置 → 语音 → 识别」中没有启用中的 Provider 时，执行阶段返回
  「设置中没有找到语音识别（ASR）配置」并提示去设置里配置启用，由 Agent 转达用户后重试。
- **不内置解码器**：音频解码直接用用户机器上的 `ffmpeg`，查找顺序为
  **工具参数 `ffmpegPath` → `FFMPEG_PATH` 环境变量 → `PATH` → 常见安装目录**
  （`/opt/homebrew/bin`、`/usr/local/bin` 等，因为 GUI 进程不一定继承完整 shell PATH）。
  显式传入 `ffmpegPath` 时**只认它**，不可用就报错，不会悄悄退回自动探测。
  完全找不到时**不报技术性错误**，而是返回带各平台安装命令的提示，由 Agent 安装后重试。
- **流式解码**：ffmpeg 输出直接走 stdout，代码按 20ms 帧切分喂给 ASR 客户端，内存占用
  与文件时长无关（不会把整个文件读进内存或落盘中转）。
- **限速喂入（20× 实时）**：`unified-realtime-asr` 的 `sendAudio()` 没有回压接口，
  不限速会把整个文件瞬间堆进 WebSocket 发送缓冲。限速后等待期间不读 stdout，
  ffmpeg 被管道反压住；几分钟的语音备忘录秒级返回，一小时录音约 3 分钟。
- **收尾**：音频发完先静默 1.5s 让服务端 VAD 定稿（OpenAI 的 `closeImpl()` 不会等待最终
  结果，其余 provider 会），再 `close()`；`isFinal` 片段按 `index` 排序拼接，不足一帧的
  尾部 PCM 也会补发。
- **超时**：默认 600s（工具参数 `timeoutSeconds` 可调，10–3600），超时直接 kill ffmpeg 并关会话。

## 10. 语音合成（TTS 朗读）

合成方向复用同一份 Provider 配置（凭据与识别同源），全链路如下：

```
渲染层朗读会话（lib/tts/tts-reader.ts）
  agent 文本分片 ──▶ tts-text 分句（markdown 净化、丢弃代码围栏与纯符号，单句 ≤120 字）
        │ 逐句 request.speakTts（同一会话的 start/speak/end 挂在同一条串行链上）
        ▼
主进程 tts-manager（无状态）── client.sendText + flush ──▶ provider（websocket，PCM 流）
        │
        ▼
tts-audio 事件 ──▶ tts-reader 的单一闸门（liveTtsSessionId 命中才入队）──▶ tts-player
                                                       （全局唯一 AudioContext + master Gain 出声）
```

**两个入口、同一套互斥**：

| 入口 | 触发 | 会话 key |
| --- | --- | --- |
| 自动朗读 | 会话头喇叭菜单打开后，`use-tts-auto-read` 订阅本会话的 `agent_message_chunk`，边生成边喂句子 | agent sessionId |
| 手动朗读 | 悬停 agent 回复分组 → 朗读按钮（`speakOnce`，整条消息一次性分句） | `"manual"` |

- **播放互斥的唯一闸门是 `liveTtsSessionId`**：只有它的 id 与分片一致时才允许入播放队列。抢占（新朗读开始）、停止、出错都会立即作废它 —— 已经提交给 provider 的文本，其音频分片仍会在回程路上陆续到达（`ttsPlayer.stop()` 只管得住已入队的），靠这道闸门把迟到分片丢掉，否则新旧朗读会交替出声。
- **抢占语义**：`startSession` 先作废在册 id、结束前台会话（链上未发出的句子直接丢弃、`dead` 标记）、停播放；`endSession` 的 `flushTail` 决定是否补发尾部残句（自然读完 true；抢占 / 手动停止 false）。
- **手动朗读会「接麦」**：抢占当前朗读，并把本轮记入 `suppressedAutoKeys` —— 本轮后续流式句子不再朗读（否则新句一到就会打断刚点的历史消息）。下一条 prompt（`resetTtsForNewPrompt`）恢复自动朗读；切换会话（`leaveTtsSession`）只停声、清掉抑制（切回来还能继续读）。
- **「停止朗读」三件事缺一不可**：抑制本轮（按最近一次自动朗读的 key）、作废在册 id（丢弃在途音频）、停播放并关会话。
- **错误与冷却**：自动朗读启动失败（未启用 Provider / 鉴权失败）进 30s 冷却，避免逐句刷 toast；手动朗读不受冷却约束（用户点了就再试）。错误统一由 `App.tsx` 注册的 `onTtsError` 弹 toast。
- **偏好存 localStorage**（`fello.tts.prefs` 的自动朗读开关与音量）：纯播放侧偏好，主进程不需要知道，故不进 settings.json；音量作用于播放器的 master `GainNode`。

**计费边界**（抢占 / 停止时哪些文本不再产生费用）：

| 文本状态 | 是否计费 |
| --- | --- |
| 点击前已 `flush` 给 provider 的句子（音频可能仍在回程） | 已计费，不可取消；分片被闸门丢弃（付了钱但听不到） |
| 链上排队、还没执行的句子（`dead` 后每步开头即返回） | 不计费 |
| 点击之后新到达的流式文本（`feedTtsStream` 在抑制检查处直接返回，连分句都不做） | 不计费 |

因为渲染层 IPC 链是严格串行的（每步 `await`），任一时刻最多一句在途 —— 抢占白花的成本上界 ≈ 最后那一句；主进程 `speak()` 遇到已关闭会话会直接 return，是第二道保险。
