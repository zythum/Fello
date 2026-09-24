import { Buffer } from "node:buffer";
import { createTTSClient, type TTSClient } from "unified-realtime-asr";
import { buildTtsConfig, getActiveTtsProvider } from "./tts-config";
import { errorMessage } from "./util";
import type { BackendContext } from "../types";

/**
 * 语音合成转发（主进程，**无状态**）。
 *
 * 文本整理（markdown 净化、分句、顺序）全在渲染层的朗读会话里完成，这里只做三件事：
 * - `start`：校验 provider 配置并构造客户端（连接仍然懒建：首个句子才 `connect()`）
 * - `speak`：把**一句话**交给 provider（`sendText` + `flush`），音频经 `tts-audio` 推回渲染层
 * - `end`：关闭该会话的连接
 *
 * 所以这里不持有文本缓冲、不持有句子队列、不持分句器 —— 读什么、按什么顺序读、
 * 什么时候停，都由渲染层决定。会话 id 也由渲染层生成，主进程只按它路由音频。
 */

interface TtsConnection {
  ttsSessionId: string;
  client: TTSClient;
  /** `client.connect()` 已成功。 */
  connected: boolean;
  /** 进行中的连接：首个句子到达时才发起，同一会话只连一次。 */
  connecting: Promise<void> | null;
  /** 连接失败（错误已上报）；后续调用不再重试。 */
  connectFailed: boolean;
}

export interface TtsManager {
  start(ttsSessionId: string): Promise<{ ok: boolean }>;
  speak(ttsSessionId: string, text: string): Promise<void>;
  end(ttsSessionId: string): Promise<void>;
  closeAll(): Promise<void>;
}

export function createTtsManager(ctx: BackendContext): TtsManager {
  const connections = new Map<string, TtsConnection>();

  /** 懒连接：首个句子真要合成了才 `connect()`；失败上报 `tts-error` 且不再重试。 */
  const ensureConnected = async (connection: TtsConnection): Promise<void> => {
    if (connection.connected) return;
    if (connection.connectFailed) throw new Error("语音合成连接不可用。");
    if (!connection.connecting) {
      connection.connecting = connection.client
        .connect()
        .then(() => {
          connection.connected = true;
        })
        .catch((error) => {
          connection.connectFailed = true;
          if (connections.get(connection.ttsSessionId) === connection) {
            ctx.sendEvent("tts-error", {
              ttsSessionId: connection.ttsSessionId,
              message: errorMessage(error),
            });
          }
          throw error;
        })
        .finally(() => {
          connection.connecting = null;
        });
    }
    await connection.connecting;
  };

  const teardown = (connection: TtsConnection): void => {
    if (connections.get(connection.ttsSessionId) === connection) {
      connections.delete(connection.ttsSessionId);
    }
    connection.client.removeAllListeners();
  };

  return {
    async start(ttsSessionId) {
      if (connections.has(ttsSessionId)) return { ok: true };

      // 配置在这里就校验并构造客户端（未启用 provider / 缺凭据 → 立刻抛给渲染层），
      // 连接推迟到首个句子，见 ensureConnected。
      const client = createTTSClient(buildTtsConfig(getActiveTtsProvider(ctx)));
      const connection: TtsConnection = {
        ttsSessionId,
        client,
        connected: false,
        connecting: null,
        connectFailed: false,
      };
      connections.set(ttsSessionId, connection);

      client.on("audio", (chunk) => {
        if (connections.get(ttsSessionId) !== connection) return;
        ctx.sendEvent("tts-audio", {
          ttsSessionId,
          audioB64: Buffer.from(chunk.audio).toString("base64"),
          format: chunk.format,
          sampleRate: chunk.sampleRate,
          channels: chunk.channels,
          isFinal: chunk.isFinal,
          index: chunk.index,
        });
      });
      client.on("error", (error) => {
        if (connections.get(ttsSessionId) !== connection) return;
        ctx.sendEvent("tts-error", { ttsSessionId, message: errorMessage(error) });
      });
      client.on("close", (info) => {
        if (connections.get(ttsSessionId) !== connection) return;
        connections.delete(ttsSessionId);
        ctx.sendEvent("tts-closed", {
          ttsSessionId,
          code: info?.code,
          reason: info?.reason,
        });
      });

      return { ok: true };
    },

    async speak(ttsSessionId, text) {
      const connection = connections.get(ttsSessionId);
      // 会话已关（渲染层抢占 / 出错收尾）后迟到的句子直接丢弃
      if (!connection) return;
      await ensureConnected(connection);
      connection.client.sendText(text);
      await connection.client.flush();
    },

    async end(ttsSessionId) {
      const connection = connections.get(ttsSessionId);
      if (!connection) return;
      // 与 closeAll 同一套判定：连接可能停在「首句正在 connect」的中途被结束，
      // 此时 connected 仍为 false，但底层 socket 已经建起来了 —— 漏掉不关就会泄漏
      // （connect 随后成功，而这条连接再没人持有）。
      if (connection.connected || connection.connecting) {
        try {
          // 先等在途连接落定，再关：避免 close() 与握手中的 connect 竞态
          await connection.connecting;
        } catch {
          // 连接失败已由 ensureConnected 上报 tts-error
        }
        try {
          await connection.client.close();
        } catch (error) {
          ctx.sendEvent("tts-error", { ttsSessionId, message: errorMessage(error) });
        }
      }
      teardown(connection);
    },

    async closeAll() {
      await Promise.all(
        Array.from(connections.values(), async (connection) => {
          try {
            if (connection.connected || connection.connecting) await connection.client.close();
          } catch {
            // Application shutdown should not be blocked by a TTS connection.
          } finally {
            teardown(connection);
          }
        }),
      );
      connections.clear();
    },
  };
}
