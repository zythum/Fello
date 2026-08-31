# 🎙️ Speech to Text

Fello supports realtime speech recognition in the chat input. Speech from your microphone is converted to text and inserted into the focused chat input. The same feature is available for Ask User custom replies.

> 🔒 API keys, API secrets, and App IDs are stored in the local Fello settings. Do not commit configurations or screenshots containing real credentials.

## Configure a Speech Provider

1. Open Fello → **Settings**
2. Open **Speech to Text**
3. Click **Add Provider**
4. Choose a provider and fill in its credentials
5. Save the provider, then enable its switch in the provider list

Only one speech provider is active at a time. When the first provider is added, Fello enables it automatically.

### Common fields

| Field | Description |
|------|-------------|
| **Name** | A custom name shown for this configuration in Fello |
| **Provider** | DashScope, Volcengine, OpenAI, or iFlytek |
| **API Key** | The API key issued by the provider |
| **Endpoint (optional)** | Shown for Volcengine / OpenAI / iFlytek only. Leave empty to use the provider default; set a custom WebSocket/HTTP endpoint for compatible services or proxies |
| **Language (optional)** | Recognition language code, `zh-CN` by default |

### DashScope

Enter an API key. **Model is optional**; when omitted, Fello uses `fun-asr-flash-8k-realtime`. You can also enter another realtime model supported by the provider.

DashScope does **not need an Endpoint**: it uses `dashscope.aliyuncs.com` by default; when **Workspace ID** and **Region** are filled in, the workspace-specific domain (`wss://{WorkspaceId}.{region}.maas.aliyuncs.com/...`) is used automatically.

If you use a RAM sub-account or a sub-workspace API key, also fill in **Workspace** (the workspace ID, sent as the `X-DashScope-WorkSpace` request header).

**API docs**: [Qwen Fun-ASR realtime speech recognition (Alibaba Cloud Model Studio)](https://platform.qianwenai.com/docs/developer-guides/speech/asr-realtime)

### Volcengine

Enter an API key. Depending on your Volcengine setup, you can also provide:

- **Resource ID**: Optional; defaults to `volc.seedasr.sauc.duration` when omitted
- **App ID** (optional): The Volcengine application ID

**API docs**: [Doubao streaming speech recognition (Volcengine)](https://docs.volcengine.com/docs/6561/1354869?lang=zh)

### OpenAI

Enter an API key. The default model is `gpt-4o-transcribe`; you can enter another model supported by an OpenAI-compatible service.

For an OpenAI-compatible service, set its **Endpoint** and **Model** as needed.

**API docs**: [OpenAI Realtime Transcription](https://platform.openai.com/docs/guides/realtime-transcription)

### iFlytek

The following fields are required:

- **App ID**
- **API Key**
- **API Secret**

**API docs**: [Realtime ASR LLM (iFlytek)](https://www.xfyun.cn/doc/spark/asr_llm/rtasr_llm.html)

## Use Voice Input in Chat

1. Open a session and place the cursor in the chat input
2. Click the microphone button in the input toolbar
3. On first use, or when the saved microphone is unavailable, choose an audio input device
4. The selected device is saved in local browser storage; later microphone clicks use it directly
5. Click the arrow on the right to choose another microphone at any time
6. Click the expanded recording button again to stop recording

Speech recognition supports both partial and final results. Partial text is updated in the same text segment instead of being appended repeatedly. After you manually edit the input, subsequent recognition starts at the new cursor position.

A single recording is limited to 5 minutes by default. Fello stops recording automatically when the limit is reached.

## Ask User Custom Replies

When an Agent asks for a custom reply, switch to input mode and use the same microphone button. Transcribed text is written to the controlled reply input while `#` file references and `@` mentions remain available.

## Troubleshooting

| Issue | Solution |
|------|----------|
| The microphone button is hidden | Add and enable a provider in Settings → Speech to Text |
| No audio input devices are listed | Check system microphone permission and device connections, then reopen the microphone menu |
| Authentication fails | Check the API key and any required App ID, API Secret, or Resource ID |
| The selected device is unavailable | Click the arrow to re-enumerate devices and choose an available microphone |
| No text is inserted | Focus the input first and make sure microphone permission is granted |

## Related Docs

| Doc | Description |
|-----|-------------|
| ← [Quick Start](./quick-start.md) | Configure your first Agent and start a conversation |
| → [Agent Configuration](./agents.md) | Configure the AI Agents used by Fello |
| → [MCP Servers](./mcp-servers.md) | Extend your Agent with additional tools |
