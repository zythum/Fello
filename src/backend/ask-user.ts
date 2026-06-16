import { randomUUID } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import type { FelloIPCSchema, AskUserRequest, AskUserRequestOption } from "../shared/schema";
import {
  askUserAskRequestSchema,
  askUserAskRespondSchema,
} from "../shared/zod/mcp-ask-user-schema";
import type { SocketServer } from "./socket-server";
import { getIlinkBridge, getIlinkActiveSessionId } from "./ilink-state";
import { t } from "./i18n";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ────────────────────────────────────────────────────────────

export interface AskUserOptions {
  sessionId: string;
  title: string;
  description: string;
  options: AskUserRequestOption[];
  allowCustomInput?: boolean;
}

export interface AskUserResult {
  value: string | null;
  reason: string | null;
}

// ── State ────────────────────────────────────────────────────────────

const USER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export const pendingAskUserRequests = new Map<
  string,
  {
    resolve: (value: AskUserResult) => void;
    timeoutId: ReturnType<typeof setTimeout>;
    sessionId: string;
    request: AskUserRequest;
  }
>();

let sendEvent: <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => boolean = () => false;

export function initAskUser(emitter: typeof sendEvent) {
  sendEvent = emitter;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatAskUserForWeChat(request: AskUserRequest): string {
  const lines: string[] = [];
  lines.push(`## ${t("ilink.pleaseConfirm")}`);
  if (request.title) lines.push(`**${request.title}**`, "");
  if (request.description) lines.push(request.description, "");
  if (request.options.length > 0) {
    lines.push(t("ilink.askUserReplyWithNumber"));
    request.options.forEach((opt, i) => {
      lines.push(`${i + 1}. ${opt.label}`);
    });
    lines.push("");
    lines.push(t("ilink.askUserCustomReply"));
  }
  return lines.join("\n");
}

// ── Core ─────────────────────────────────────────────────────────────

export async function askUser(options: AskUserOptions): Promise<AskUserResult> {
  const { sessionId } = options;
  const askUserId = randomUUID();
  const request: AskUserRequest = { ...options, askUserId };

  sendEvent("ask-user-request", request);

  // Forward to WeChat if active iLink session
  const ilinkBridge = getIlinkBridge();
  const ilinkActiveSessionId = getIlinkActiveSessionId();
  if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
    const userId = ilinkBridge.userId;
    if (userId) {
      ilinkBridge.sendTyping(userId, false).catch(() => {});
      const weChatText = formatAskUserForWeChat(request);
      ilinkBridge.sendTextReply(userId, weChatText).catch((err) => {
        console.warn("[iLink] Failed to forward askUser to WeChat:", err);
      });
    }
  }

  return new Promise<AskUserResult>((resolve) => {
    const timeoutId = setTimeout(() => {
      const pending = pendingAskUserRequests.get(askUserId);
      if (pending) {
        pendingAskUserRequests.delete(askUserId);
        const response: AskUserResult = { value: null, reason: "timeout" };
        resolve(response);
        sendEvent("ask-user-response", {
          sessionId,
          askUserId,
          value: null,
          reason: "timeout",
        });
      } else {
        console.warn(`[askUser] timeout fired but no pending request found for ${askUserId}`);
      }
    }, USER_REQUEST_TIMEOUT_MS);

    pendingAskUserRequests.set(askUserId, { resolve, timeoutId, sessionId, request });
  });
}

// ── Handlers ─────────────────────────────────────────────────────────

export async function getPendingAskUserRequests({ sessionId }: { sessionId: string }) {
  const result: AskUserRequest[] = [];
  for (const pending of pendingAskUserRequests.values()) {
    if (pending.sessionId === sessionId) {
      result.push(pending.request);
    }
  }
  return result;
}

export async function respondAskUser({
  sessionId,
  askUserId,
  value,
  reason,
}: {
  sessionId: string;
  askUserId: string;
  value: string | null;
  reason?: string | null;
}) {
  const pending = pendingAskUserRequests.get(askUserId);
  if (pending) {
    clearTimeout(pending.timeoutId);
    pending.resolve({ value, reason: reason ?? null });
    pendingAskUserRequests.delete(askUserId);
    sendEvent("ask-user-response", {
      sessionId,
      askUserId,
      value,
      reason: reason ?? null,
    });
  } else {
    console.warn(`[askUser] respond fired but no pending request found for ${askUserId}`);
  }
}

/**
 * Register ask-user route on a socket server.
 */
export function registerAskUserRoute(server: SocketServer, sessionId: string) {
  server.registry("ask-user/ask", async (payload) => {
    const request = askUserAskRequestSchema.parse(payload);
    const result: z.infer<typeof askUserAskRespondSchema> = await askUser({
      sessionId,
      ...request,
    });
    return result;
  });
}

/**
 * Build a McpServer config for the built-in ask-user MCP server.
 */
export function buildAskUserMcpServer(options: { projectDir: string; socketPath: string }): {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
} {
  return {
    name: "ask-user",
    command: process.execPath,
    args: [
      join(__dirname, "../scripts/mcp-ask-user/server.mjs"),
      "--project-dir",
      options.projectDir,
      "--socket-path",
      options.socketPath,
    ],
    env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  };
}
