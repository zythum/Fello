import { Buffer } from "node:buffer";
import {
  createASRClient,
  type ASRConfig,
  type RealtimeASRClient,
  type RealtimeASROptions,
  type Transcript,
} from "unified-realtime-asr";
import type { SpeechToTextProviderInfo } from "../../shared/schema";
import type { BackendContext } from "../types";

interface ActiveAsrSession {
  clientId: string;
  asrSessionId: string;
  client: RealtimeASRClient;
  /**
   * `client.connect()` resolve 之前为 false。
   *
   * 会话在 `connect()` **之前**就登记进表里，是为了让 connect 期间的 stop 也能命中它；
   * 但音频帧不能在那段时间里下发 —— 底层客户端此时 `connected === false`，
   * `sendAudio()` 会抛 "Not connected. Call connect() before sendAudio()."。
   */
  ready: boolean;
}

export interface AsrManager {
  start(clientId: string, asrSessionId: string): Promise<{ ok: boolean }>;
  frame(clientId: string, asrSessionId: string, audioB64: string): void;
  stop(clientId: string, asrSessionId: string): Promise<void>;
  closeAll(): Promise<void>;
}

const DEFAULT_DASHSCOPE_MODEL = "fun-asr-flash-8k-realtime";
const DEFAULT_OPENAI_MODEL = "gpt-4o-transcribe";

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function required(value: string | undefined, name: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`实时语音识别配置缺少 ${name}。`);
  return result;
}

function buildOptions(provider: SpeechToTextProviderInfo): RealtimeASROptions {
  return {
    language: optionalString(provider.language) ?? "zh-CN",
    sampleRate: 16000,
    channels: 1,
    format: "pcm",
    interimResults: true,
    punctuation: true,
    autoReconnect: false,
    transcriptionModel:
      provider.provider === "openai"
        ? (optionalString(provider.model) ?? DEFAULT_OPENAI_MODEL)
        : undefined,
  };
}

function buildConfig(provider: SpeechToTextProviderInfo): ASRConfig {
  const options = buildOptions(provider);
  const url = optionalString(provider.baseUrl);

  switch (provider.provider) {
    case "volcengine":
      return {
        provider: "volcengine",
        apiKey: required(provider.apiKey, "API Key"),
        resourceId: optionalString(provider.resourceId),
        appId: optionalString(provider.appId),
        url,
        options,
      };
    case "dashscope":
      return {
        provider: "dashscope",
        apiKey: required(provider.apiKey, "API Key"),
        model: optionalString(provider.model) ?? DEFAULT_DASHSCOPE_MODEL,
        workspaceId: optionalString(provider.workspaceId),
        region: provider.region,
        workspace: optionalString(provider.workspace),
        url,
        options,
      };
    case "openai":
      return {
        provider: "openai",
        apiKey: required(provider.apiKey, "API Key"),
        url,
        options,
      };
    case "iflytek":
      return {
        provider: "iflytek",
        appId: required(provider.appId, "App ID"),
        apiKey: required(provider.apiKey, "API Key"),
        apiSecret: required(provider.apiSecret, "API Secret"),
        url,
        options,
      };
  }
}

function getActiveProvider(ctx: BackendContext): SpeechToTextProviderInfo {
  const provider = ctx.storage.getSettings().speechToText.find((item) => item.active);
  if (!provider) {
    throw new Error("请先在设置 → 语音识别中配置并启用一个 Provider。");
  }
  return provider;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `unified-realtime-asr` 的 not-connected 错误（ASRError.code === "not-connected"）。 */
function isNotConnectedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "not-connected"
  );
}

export function createAsrManager(ctx: BackendContext): AsrManager {
  const sessions = new Map<string, ActiveAsrSession>();
  const keyOf = (clientId: string, asrSessionId: string) => `${clientId}:${asrSessionId}`;

  const emitError = (session: ActiveAsrSession, error: unknown) => {
    ctx.sendEvent("asr-error", {
      clientId: session.clientId,
      asrSessionId: session.asrSessionId,
      message: errorMessage(error),
    });
  };

  const emitTranscript = (session: ActiveAsrSession, transcript: Transcript) => {
    ctx.sendEvent("asr-transcript", {
      clientId: session.clientId,
      asrSessionId: session.asrSessionId,
      text: transcript.text,
      isFinal: transcript.isFinal,
      id: transcript.id,
      index: transcript.index,
      speaker: transcript.speaker,
    });
  };

  return {
    async start(clientId, asrSessionId) {
      const key = keyOf(clientId, asrSessionId);
      if (sessions.has(key)) return { ok: true };

      const provider = getActiveProvider(ctx);
      const client = createASRClient(buildConfig(provider));
      const active: ActiveAsrSession = { clientId, asrSessionId, client, ready: false };
      sessions.set(key, active);

      client.on("transcript", (transcript) => {
        if (sessions.get(key) === active) emitTranscript(active, transcript);
      });
      client.on("error", (error) => {
        if (sessions.get(key) === active) emitError(active, error);
      });
      client.on("close", (info) => {
        if (sessions.get(key) !== active) return;
        active.ready = false;
        sessions.delete(key);
        ctx.sendEvent("asr-closed", {
          clientId,
          asrSessionId,
          code: info?.code,
          reason: info?.reason,
        });
      });

      try {
        await client.connect();
        active.ready = true;
        return { ok: true };
      } catch (error) {
        sessions.delete(key);
        client.removeAllListeners();
        throw new Error(errorMessage(error));
      }
    },

    frame(clientId, asrSessionId, audioB64) {
      const active = sessions.get(keyOf(clientId, asrSessionId));
      if (!active) return;
      // connect 还没完成：直接丢弃这几帧，而不是让底层客户端抛 not-connected。
      // （音频源可能在 connect 期间就开始出帧，例如外设语音的收尾 flush。）
      if (!active.ready) return;
      try {
        active.client.sendAudio(Buffer.from(audioB64, "base64"));
      } catch (error) {
        // 连接已断开但 close 事件还没处理到时，同样只丢弃，不逐帧刷错误。
        if (isNotConnectedError(error)) {
          active.ready = false;
          return;
        }
        emitError(active, error);
      }
    },

    async stop(clientId, asrSessionId) {
      const key = keyOf(clientId, asrSessionId);
      const active = sessions.get(key);
      if (!active) return;
      try {
        await active.client.close();
      } catch (error) {
        emitError(active, error);
      } finally {
        if (sessions.get(key) === active) sessions.delete(key);
        active.client.removeAllListeners();
      }
    },

    async closeAll() {
      await Promise.all(
        Array.from(sessions.values(), async (active) => {
          try {
            await active.client.close();
          } catch {
            // Application shutdown should not be blocked by an ASR socket.
          } finally {
            active.client.removeAllListeners();
          }
        }),
      );
      sessions.clear();
    },
  };
}
