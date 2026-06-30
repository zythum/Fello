import { randomUUID } from "crypto";
import { join } from "path";
import { z } from "zod";
import type { AskUserRequest, AskUserRequestOption } from "../shared/schema";
import {
  askUserAskRequestSchema,
  askUserAskRespondSchema,
} from "../shared/zod/mcp-ask-user-schema";
import type { SocketServer } from "./socket-server";
import type { BackendContext } from "./types";
import type { IlinkState } from "./ilink";
import { t } from "./i18n";

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

export interface AskUserModule {
  askUser: (options: AskUserOptions) => Promise<AskUserResult>;
  getPendingAskUserRequests: (params: { sessionId: string }) => Promise<AskUserRequest[]>;
  respondAskUser: (params: {
    sessionId: string;
    askUserId: string;
    value: string | null;
    reason?: string | null;
  }) => Promise<void>;
  registerAskUserRoute: (server: SocketServer, sessionId: string) => void;
  buildAskUserMcpServer: (options: { projectDir: string; socketPath: string }) => {
    name: string;
    command: string;
    args: string[];
    env: { name: string; value: string }[];
  };
}

// ── Factory ──────────────────────────────────────────────────────────

const USER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export function createAskUserModule(
  ctx: BackendContext,
  deps: { ilink: IlinkState },
): AskUserModule {
  const { sendEvent } = ctx;

  const pendingRequests = new Map<
    string,
    {
      resolve: (value: AskUserResult) => void;
      timeoutId: ReturnType<typeof setTimeout>;
      sessionId: string;
      request: AskUserRequest;
    }
  >();

  // ── Helpers ────────────────────────────────────────────────────────

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

  // ── Core ───────────────────────────────────────────────────────────

  async function askUser(options: AskUserOptions): Promise<AskUserResult> {
    const { sessionId } = options;
    const askUserId = randomUUID();
    const request: AskUserRequest = { ...options, askUserId };

    sendEvent("ask-user-request", request);

    // Forward to WeChat if active iLink session
    const ilinkBridge = deps.ilink.getBridge();
    const ilinkActiveSessionId = deps.ilink.getActiveSessionId();
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
        const pending = pendingRequests.get(askUserId);
        if (pending) {
          pendingRequests.delete(askUserId);
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

      pendingRequests.set(askUserId, { resolve, timeoutId, sessionId, request });
    });
  }

  // ── Handlers ───────────────────────────────────────────────────────

  async function getPendingAskUserRequests({ sessionId }: { sessionId: string }) {
    const result: AskUserRequest[] = [];
    for (const pending of pendingRequests.values()) {
      if (pending.sessionId === sessionId) {
        result.push(pending.request);
      }
    }
    return result;
  }

  async function respondAskUser({
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
    const pending = pendingRequests.get(askUserId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pending.resolve({ value, reason: reason ?? null });
      pendingRequests.delete(askUserId);
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

  function registerAskUserRoute(server: SocketServer, sessionId: string) {
    server.registry("ask-user/ask", async (payload) => {
      const request = askUserAskRequestSchema.parse(payload);
      const result: z.infer<typeof askUserAskRespondSchema> = await askUser({
        sessionId,
        ...request,
      });
      return result;
    });
  }

  function buildAskUserMcpServer(options: { projectDir: string; socketPath: string }) {
    return {
      name: "ask-user",
      command: process.execPath,
      args: [
        join(process.scriptsPath, "mcp-ask-user/server.mjs"),
        "--project-dir",
        options.projectDir,
        "--socket-path",
        options.socketPath,
      ],
      env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
    };
  }

  return {
    askUser,
    getPendingAskUserRequests,
    respondAskUser,
    registerAskUserRoute,
    buildAskUserMcpServer,
  };
}
