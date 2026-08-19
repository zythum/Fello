import { readFile } from "fs/promises";
import { omit } from "es-toolkit";
import { randomUUID } from "crypto";
import type { SessionNotification, ContentBlock, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type { BackendContext } from "../types";
import type { SessionNotificationFelloExt } from "../../shared/schema";
import type { IlinkState } from "../ilink";

// ── Helpers ──────────────────────────────────────────────────────────

const CONTENT_BLOCK_TYPES = new Set(["text", "image", "audio", "resource_link", "resource"]);

/**
 * Lightweight check for whether an object is a valid ContentBlock.
 * Replaces the previous zContentBlock.safeParse() from the SDK's internal zod schema.
 */
function isContentBlock(obj: unknown): obj is ContentBlock {
  if (typeof obj !== "object" || obj === null) return false;
  const typed = obj as Record<string, unknown>;
  if (typeof typed.type !== "string" || !CONTENT_BLOCK_TYPES.has(typed.type)) return false;
  // Minimal field check per type
  switch (typed.type) {
    case "text":
      return typeof typed.text === "string";
    case "image":
      return typeof typed.data === "string" || typeof typed.url === "string";
    case "audio":
      return typeof typed.data === "string" || typeof typed.url === "string";
    case "resource_link":
      return typeof typed.uri === "string";
    case "resource":
      return typeof typed.resource === "object" && typed.resource !== null;
    default:
      return false;
  }
}

function findContentBlock(object: any): ContentBlock | null {
  if (isContentBlock(object)) return object;
  if (object && typeof object === "object") {
    for (const name in object) {
      if (object.hasOwnProperty(name)) {
        const content = findContentBlock(object[name]);
        if (content) return content;
      }
    }
  }
  return null;
}

function mergeToolCallUpdate<T extends ToolCallUpdate>(base: ToolCallUpdate, update: T): T {
  const merged: ToolCallUpdate = { ...base };
  if (Object.prototype.hasOwnProperty.call(update, "title")) merged.title = update.title;
  if (Object.prototype.hasOwnProperty.call(update, "status") && update.status != null)
    merged.status = update.status;
  if (
    Object.prototype.hasOwnProperty.call(update, "content") &&
    update.content &&
    update.content.length > 0
  ) {
    const prevContent = merged.content ?? [];
    const nextContent = update.content;
    // 同类型覆盖：update 中出现的类型用 update 项覆盖，prev 中独有类型（如 terminal）原样保留
    const nextTypes = new Set(nextContent.map((item) => item.type));
    const kept = prevContent.filter((item) => !nextTypes.has(item.type));
    merged.content = [...kept, ...nextContent];
  }
  if (Object.prototype.hasOwnProperty.call(update, "kind") && update.kind != null)
    merged.kind = update.kind;
  if (Object.prototype.hasOwnProperty.call(update, "rawInput")) merged.rawInput = update.rawInput;
  if (Object.prototype.hasOwnProperty.call(update, "locations"))
    merged.locations = update.locations;
  if (Object.prototype.hasOwnProperty.call(update, "rawOutput"))
    merged.rawOutput = update.rawOutput;
  if (Object.prototype.hasOwnProperty.call(update, "_meta")) merged._meta = update._meta;
  return merged as T;
}

function flushIlinkMedia(
  bridge: NonNullable<ReturnType<IlinkState["getBridge"]>>,
  ilinkState: IlinkState,
) {
  const items = ilinkState.getMediaBuffer();
  if (items.length === 0) return;
  ilinkState.clearMediaBuffer();
  for (const img of items) {
    (async () => {
      try {
        const buffer = await readFile(img.filePath);
        if (ilinkState.isImageMimeType(img.mimeType)) {
          await bridge.sendImageReply(img.toUserId, buffer, img.name);
        } else {
          await bridge.sendFileReply(img.toUserId, buffer, img.name);
        }
      } catch (err) {
        console.warn("[iLink] Failed to forward file to WeChat:", err);
      }
    })();
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createNotificationHandler(ctx: BackendContext, deps: { ilink: IlinkState }) {
  const { sendEvent, storage } = ctx;
  const restoringSessions = new Set<string>();
  const pendingToolCalls = new Map<string, ToolCallUpdate>();

  function getPendingToolCallKey(sessionId: string, toolCallId: string) {
    return `${sessionId}:${toolCallId}`;
  }

  function addRestoring(sessionId: string) {
    restoringSessions.add(sessionId);
  }

  function removeRestoring(sessionId: string) {
    restoringSessions.delete(sessionId);
  }

  function broadcastAndSaveSessionUpdate(sessionId: string, notification: SessionNotification) {
    const sessionUpdate = notification.update?.sessionUpdate;

    if (
      restoringSessions.has(sessionId) &&
      sessionUpdate !== "available_commands_update" &&
      sessionUpdate !== "usage_update"
    ) {
      return;
    }

    const enrichedNotification: SessionNotificationFelloExt = {
      ...notification,
      update: {
        ...notification.update,
        _meta: {
          ...notification.update?._meta,
          fello: {
            ...(notification.update?._meta?.fello as {}),
            receivedAt: Date.now(),
            displayId: randomUUID(),
          },
        },
      },
    };

    const enrichedUpdate = enrichedNotification.update;
    const ilinkBridge = deps.ilink.getBridge();
    const ilinkActiveSessionId = deps.ilink.getActiveSessionId();

    // iLink forwarding: agent response → WeChat
    if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
      const userId = ilinkBridge.userId;
      if (userId) {
        if (enrichedUpdate.sessionUpdate === "agent_message_chunk") {
          const content = enrichedUpdate.content;
          if (content?.type === "text" && content.text) {
            deps.ilink.appendReplyBuffer(content.text);
          }
        }
      }
    }

    // Flush buffered text before tool call
    if (
      sessionUpdate === "tool_call" &&
      ilinkBridge?.isConnected &&
      sessionId === ilinkActiveSessionId
    ) {
      const userId = ilinkBridge.userId;
      const buffer = deps.ilink.getReplyBuffer();
      if (userId && buffer) {
        deps.ilink.setReplyBuffer("");
        ilinkBridge.sendTextReply(userId, buffer).catch((err) => {
          console.warn("[iLink] Failed to forward pre-tool text to WeChat:", err);
        });
      }
      flushIlinkMedia(ilinkBridge, deps.ilink);
    }

    if (sessionUpdate === "tool_call_update") {
      const update = enrichedNotification.update as unknown as ToolCallUpdate;
      const toolCallId = update.toolCallId;
      const key = getPendingToolCallKey(sessionId, toolCallId);
      const base = pendingToolCalls.get(key);

      if (!update.content && update.rawOutput) {
        const content = findContentBlock(update.rawOutput);
        if (content) {
          update.content = [{ type: "content", content }];
        }
      }

      if (update.status !== "completed" && update.status !== "failed") {
        if (base) {
          pendingToolCalls.set(key, mergeToolCallUpdate(base, update));
        } else {
          pendingToolCalls.set(key, { ...update });
        }
      } else {
        if (base) {
          enrichedNotification.update = mergeToolCallUpdate(
            base,
            update,
          ) as SessionNotificationFelloExt["update"];
          pendingToolCalls.delete(key);
        }
        storage.appendSessionMessage(sessionId, {
          ...enrichedNotification,
          update: omit(enrichedNotification.update as any, ["rawInput", "rawOutput"]),
        } as SessionNotificationFelloExt);

        if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
          flushIlinkMedia(ilinkBridge, deps.ilink);
        }
      }
    } else {
      if (sessionUpdate !== "available_commands_update" && sessionUpdate !== "usage_update") {
        storage.appendSessionMessage(sessionId, enrichedNotification);
      }
    }

    sendEvent("session-update", { sessionId, notification: enrichedNotification });
  }

  function mergeNotifications(
    notifications: SessionNotificationFelloExt[],
  ): SessionNotificationFelloExt[] {
    const result: SessionNotificationFelloExt[] = [];

    for (const notification of notifications) {
      const sessionId = notification.sessionId;
      const update = notification.update;
      const type = update.sessionUpdate;

      if (
        (type === "agent_message_chunk" || type === "agent_thought_chunk") &&
        update.content.type === "text"
      ) {
        const prev = result[result.length - 1];
        if (
          prev &&
          prev.sessionId === sessionId &&
          prev.update.sessionUpdate === type &&
          prev.update.content.type === "text"
        ) {
          prev.update.content.text += update.content.text;
          continue;
        }
      }

      if (type === "tool_call_update") {
        const toolCallId = update.toolCallId;
        const prev = result.find((n) => {
          return (
            n.sessionId === sessionId &&
            n.update.sessionUpdate === type &&
            n.update.toolCallId === toolCallId
          );
        });
        if (prev && prev.update.sessionUpdate === type) {
          prev.update = { ...prev.update, ...update };
          continue;
        }
      }

      result.push(notification);
    }
    return result;
  }

  function clear() {
    restoringSessions.clear();
    pendingToolCalls.clear();
  }

  return {
    broadcastAndSaveSessionUpdate,
    mergeNotifications,
    addRestoring,
    removeRestoring,
    flushIlinkMedia: (bridge: NonNullable<ReturnType<IlinkState["getBridge"]>>) =>
      flushIlinkMedia(bridge, deps.ilink),
    clear,
  };
}
