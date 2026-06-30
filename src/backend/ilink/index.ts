import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { WeixinMessage } from "./ilink-client";
import {
  ILinkBridge,
  readActiveSessionId,
  writeActiveSessionId,
  hasImageItems,
  extractMessageText,
  extractVoiceText,
  type ILinkStatus,
  type IlinkQrcodeState,
} from "./ilink-bridge";
import { isImageMimeType } from "../../shared/constants";
import { ALL_FEATURES } from "../../shared/constants";
import type { BackendContext } from "../types";
import type { SessionModule } from "../session";
import type { AskUserModule } from "../ask-user";
import { t } from "../i18n";

// ── Types ────────────────────────────────────────────────────────────

export interface IlinkMediaEntry {
  filePath: string;
  name: string;
  toUserId: string;
  mimeType?: string;
}

export interface IlinkState {
  getBridge: () => ILinkBridge | null;
  getActiveSessionId: () => string | null;
  getReplyBuffer: () => string;
  setReplyBuffer: (value: string) => void;
  appendReplyBuffer: (text: string) => void;
  getMediaBuffer: () => IlinkMediaEntry[];
  clearMediaBuffer: () => void;
  appendMediaBuffer: (entry: IlinkMediaEntry) => void;
  isImageMimeType: (mimeType?: string) => boolean;
}

export interface IlinkModule {
  state: IlinkState;
  // Handlers (for backendHandlers)
  getIlinkStatus: () => Promise<ILinkStatus>;
  startIlinkLogin: () => Promise<{ qrcode: string; qrcodeImgUrl: string }>;
  pollIlinkQrcode: (params: { qrcode: string }) => Promise<{ status: IlinkQrcodeState }>;
  stopIlink: () => Promise<void>;
  setActiveIlinkSession: (params: { sessionId: string | null }) => Promise<void>;
  getActiveIlinkSession: () => Promise<{ sessionId: string | null }>;
  // Lifecycle
  tryRestore: () => Promise<void>;
  // Late-binding
  setHandlers: (handlers: IlinkHandlerDeps) => void;
}

export interface IlinkHandlerDeps {
  sendPrompt: SessionModule["sendPrompt"];
  cancelPrompt: SessionModule["cancelPrompt"];
  newSession: SessionModule["newSession"];
  getModels: SessionModule["getModels"];
  setModel: SessionModule["setModel"];
  respondAskUser: AskUserModule["respondAskUser"];
  getPendingAskUserRequests: AskUserModule["getPendingAskUserRequests"];
}

// ── Factory ──────────────────────────────────────────────────────────

export function createIlinkModule(ctx: BackendContext): IlinkModule {
  const { sendEvent, storage } = ctx;

  // ── Internal state (merged from ilink-state.ts) ────────────────────
  let bridge: ILinkBridge | null = null;
  let activeSessionId: string | null = null;
  let replyBuffer = "";
  let mediaBuffer: IlinkMediaEntry[] = [];
  let commandPending: ((input: string) => void) | null = null;

  // Late-bound handler deps (set after session/askUser modules are created)
  let handlers: IlinkHandlerDeps | null = null;

  function setHandlers(h: IlinkHandlerDeps) {
    handlers = h;
  }

  function getHandlers(): IlinkHandlerDeps {
    if (!handlers) throw new Error("[ilink] handlers not yet initialized");
    return handlers;
  }

  // ── IlinkSessionState interface (consumed by session/notifications) ──
  const state: IlinkModule["state"] = {
    getBridge: () => bridge,
    getActiveSessionId: () => activeSessionId,
    getReplyBuffer: () => replyBuffer,
    setReplyBuffer: (v) => {
      replyBuffer = v;
    },
    appendReplyBuffer: (text) => {
      replyBuffer += text;
    },
    getMediaBuffer: () => mediaBuffer,
    clearMediaBuffer: () => {
      mediaBuffer = [];
    },
    isImageMimeType: (mimeType) => isImageMimeType(mimeType),
    appendMediaBuffer: (entry) => {
      mediaBuffer.push(entry);
    },
  };

  // ── Bridge creation ────────────────────────────────────────────────

  function ensureBridge(): ILinkBridge {
    if (!bridge) {
      bridge = new ILinkBridge({
        onStatusChange: (status) => {
          sendEvent("ilink-status-changed", { status });
        },
        onMessage: async (msg) => {
          const text = extractMessageText(msg);
          const voiceText = extractVoiceText(msg);
          const hasImages = hasImageItems(msg);
          const combinedText = [text, voiceText].filter(Boolean).join("\n");
          if (!combinedText.trim() && !hasImages) return;

          const trimmed = text.trim();

          if (commandPending) {
            commandPending(trimmed);
            commandPending = null;
            return;
          }

          if (trimmed[0] === "!" || trimmed[0] === "！") {
            await handleIlinkCommand(trimmed, msg);
            return;
          }

          const sessionId = activeSessionId ?? "";
          if (!sessionId) {
            console.warn("[iLink] No active session, ignoring message");
            if (msg.from_user_id) {
              const lines = [
                `📋 **${t("ilink.noActiveSession")}**`,
                "",
                t("ilink.switchSessionGuide"),
                t("ilink.createSessionGuide"),
              ];
              await bridge?.sendTextReply(msg.from_user_id, lines.join("\n"));
            }
            return;
          }

          const contents: ContentBlock[] = [];
          if (combinedText.trim()) contents.push({ type: "text", text: combinedText });

          if (hasImages && bridge) {
            const { useOriginalImage } = storage.getSettings().ilink;
            for (const item of msg.item_list ?? []) {
              if (item.type !== 2 || !item.image_item) continue;
              try {
                const base64 = await bridge.downloadImage(item.image_item, { useOriginalImage });
                if (base64) contents.push({ type: "image", data: base64, mimeType: "image/jpeg" });
              } catch (err) {
                console.error("[iLink] Failed to download image:", err);
              }
            }
          }

          if (contents.length === 0) return;

          // askUser intercept
          const h = getHandlers();
          const pending = await h.getPendingAskUserRequests({ sessionId });
          if (pending.length > 0) {
            const req = pending[0];
            const options = req.options;
            let respondedValue: string | null = null;
            if (/^\d+$/.test(trimmed)) {
              const index = parseInt(trimmed, 10) - 1;
              const option = options[index];
              if (option) respondedValue = option.value;
            }
            if (respondedValue !== null) {
              await h.respondAskUser({
                sessionId,
                askUserId: req.askUserId,
                value: respondedValue,
              });
            } else {
              await h.respondAskUser({
                sessionId,
                askUserId: req.askUserId,
                value: null,
                reason: trimmed || t("ilink.noInput"),
              });
            }
            if (bridge?.isConnected && activeSessionId === sessionId) {
              const userId = bridge.userId;
              if (userId) bridge.sendTyping(userId, true).catch(() => {});
            }
            return;
          }

          try {
            await h.sendPrompt({ sessionId, contents });
          } catch (err) {
            console.error("[iLink] Failed to route message to session:", err);
            if (msg.from_user_id)
              await bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
          }
        },
      });
    }
    return bridge;
  }

  // ── Commands ───────────────────────────────────────────────────────

  async function handleIlinkCommand(trimmed: string, msg: WeixinMessage) {
    const session = activeSessionId ? storage.getSession(activeSessionId) : null;
    if (session && session.isStreaming) {
      getHandlers()
        .cancelPrompt({ sessionId: session.id })
        .catch((err: unknown) => {
          console.warn("[iLink] Failed to cancel prompt:", err);
        });
    }

    const [command] = trimmed.slice(1).split(/\s+/);
    if (command.toLowerCase() === "s") await handleCommandSwitchSession(msg);
    else if (command.toLowerCase() === "n") await handleCommandNewSession(msg);
    else if (command.toLowerCase() === "m") await handleCommandSwitchModel(msg);
    else if (command.toLowerCase() === "q") await handleCommandSnippet(msg);
    else await handleCommandInfo(msg);
  }

  async function handleCommandSwitchSession(msg: WeixinMessage) {
    const allSessions = storage.listSessions();
    if (allSessions.length === 0) {
      if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, t("ilink.noSessions"));
      return;
    }
    const projects = storage.listProjects();
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const lines: string[] = [];
    lines.push(`📋 **${t("ilink.sessionList")}**`);
    lines.push(t("ilink.sessionListDesc"));
    let index = 1;
    let isFirstGroup = true;
    const sessionEntries: Array<{ sessionId: string; label: string }> = [];
    const grouped = new Map<string, typeof allSessions>();
    for (const s of allSessions) {
      const project = projectMap.get(s.projectId);
      const key = project?.title ?? s.cwd;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(s);
    }
    for (const projectName of [...grouped.keys()].sort((a, b) => a.localeCompare(b))) {
      const sessions = grouped.get(projectName)!;
      if (!isFirstGroup) lines.push(`\n---`);
      isFirstGroup = false;
      lines.push(`\n**${projectName}**`);
      for (const s of sessions) {
        const marker = s.id === activeSessionId ? " 👈" : "";
        const label = s.title || t("ilink.newSession");
        lines.push(`  ${index}. ${label}${marker}`);
        sessionEntries.push({ sessionId: s.id, label });
        index++;
      }
    }
    lines.push("", "---", t("ilink.switchSessionHint"));
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, lines.join("\n"));

    commandPending = (input: string) => {
      const num = parseInt(input, 10);
      if (isNaN(num) || num < 1 || num > sessionEntries.length) {
        if (msg.from_user_id)
          bridge?.sendTextReply(
            msg.from_user_id,
            t("ilink.invalidSessionNumber", { min: "1", max: String(sessionEntries.length) }),
          );
        return;
      }
      const entry = sessionEntries[num - 1];
      activeSessionId = entry.sessionId;
      replyBuffer = "";
      writeActiveSessionId(entry.sessionId).catch(() => {});
      sendEvent("ilink-active-session-changed", { sessionId: entry.sessionId });
      if (msg.from_user_id)
        bridge?.sendTextReply(
          msg.from_user_id,
          t("ilink.switchedToSession", { label: entry.label }),
        );
    };
  }

  async function handleCommandNewSession(msg: WeixinMessage) {
    const allProjects = storage.listProjects();
    if (allProjects.length === 0) {
      if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, t("ilink.noProjects"));
      return;
    }
    const sortedProjects = [...allProjects].sort((a, b) => a.title.localeCompare(b.title));
    const lines: string[] = [];
    lines.push(`📋 **${t("ilink.newSessionTitle")}**`);
    lines.push(t("ilink.newSessionDesc"));
    const projectEntries: Array<{ projectId: string; title: string }> = [];
    sortedProjects.forEach((p, i) => {
      lines.push(`  ${i + 1}. ${p.title}`);
      projectEntries.push({ projectId: p.id, title: p.title });
    });
    lines.push("", "---", t("ilink.createSessionHint"));
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, lines.join("\n"));

    commandPending = (input: string) => {
      const num = parseInt(input, 10);
      if (isNaN(num) || num < 1 || num > projectEntries.length) {
        if (msg.from_user_id)
          bridge?.sendTextReply(
            msg.from_user_id,
            t("ilink.invalidSessionNumber", { min: "1", max: String(projectEntries.length) }),
          );
        return;
      }
      const entry = projectEntries[num - 1];
      const settings = storage.getSettings();
      const agent = settings.agents.find((a) => !a.disabled);
      if (!agent) {
        if (msg.from_user_id) bridge?.sendTextReply(msg.from_user_id, t("ilink.noAgent"));
        return;
      }
      const defaultMcpIds = (settings.mcpServers || []).filter((s) => !s.disabled).map((s) => s.id);
      getHandlers()
        .newSession({
          projectId: entry.projectId,
          agentId: agent.id,
          mcpServers: defaultMcpIds,
          features: ALL_FEATURES,
          permissionMode: "allow-all",
        })
        .then((result) => {
          activeSessionId = result.sessionId;
          replyBuffer = "";
          writeActiveSessionId(result.sessionId).catch(() => {});
          sendEvent("ilink-active-session-changed", { sessionId: result.sessionId });
          if (msg.from_user_id)
            bridge?.sendTextReply(
              msg.from_user_id,
              t("ilink.createdAndSwitched", { project: entry.title }),
            );
        })
        .catch((err: unknown) => {
          console.error("[iLink] Failed to create new session:", err);
          if (msg.from_user_id) bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
        });
    };
  }

  async function handleCommandSwitchModel(msg: WeixinMessage) {
    const sessionId = activeSessionId ?? "";
    if (!sessionId) {
      if (msg.from_user_id) {
        await bridge?.sendTextReply(
          msg.from_user_id,
          [
            `📋 **${t("ilink.noActiveSession")}**`,
            "",
            t("ilink.switchSessionGuide"),
            t("ilink.createSessionGuide"),
          ].join("\n"),
        );
      }
      return;
    }
    const modelState = await getHandlers().getModels({ sessionId });
    if (!modelState || !modelState.availableModels || modelState.availableModels.length === 0) {
      if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, t("ilink.noModels"));
      return;
    }
    const lines: string[] = [];
    lines.push(`🧠 **${t("ilink.modelList")}**`);
    lines.push(t("ilink.modelListDesc"));
    const modelEntries: Array<{ modelId: string; label: string }> = [];
    modelState.availableModels.forEach((m: { modelId: string; name?: string }, i: number) => {
      const marker = m.modelId === modelState.currentModelId ? " 👈" : "";
      const label = m.name || m.modelId;
      lines.push(`  ${i + 1}. ${label}${marker}`);
      modelEntries.push({ modelId: m.modelId, label });
    });
    lines.push("", "---", t("ilink.switchModelHint"));
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, lines.join("\n"));

    commandPending = (input: string) => {
      const num = parseInt(input, 10);
      if (isNaN(num) || num < 1 || num > modelEntries.length) {
        if (msg.from_user_id)
          bridge?.sendTextReply(
            msg.from_user_id,
            t("ilink.invalidSessionNumber", { min: "1", max: String(modelEntries.length) }),
          );
        return;
      }
      const entry = modelEntries[num - 1];
      getHandlers()
        .setModel({ sessionId, modelId: entry.modelId })
        .then(() => {
          if (msg.from_user_id)
            bridge?.sendTextReply(
              msg.from_user_id,
              t("ilink.switchedToModel", { model: entry.label }),
            );
        })
        .catch((err: unknown) => {
          console.error("[iLink] Failed to set model:", err);
          if (msg.from_user_id) bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
        });
    };
  }

  async function handleCommandSnippet(msg: WeixinMessage) {
    const settings = storage.getSettings();
    const snippets = settings.snippets ?? [];
    if (snippets.length === 0) {
      if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, t("ilink.noSnippets"));
      return;
    }
    const lines: string[] = [];
    lines.push(`📝 **${t("ilink.snippetList")}**`);
    lines.push(t("ilink.snippetListDesc"));
    const snippetEntries: Array<{ snippetId: string; title: string; content: string }> = [];
    snippets.forEach((s: { id: string; title: string; content: string }, i: number) => {
      const preview = s.content.length > 50 ? s.content.substring(0, 50) + "..." : s.content;
      lines.push(`  ${i + 1}. **${s.title}** — ${preview}`);
      snippetEntries.push({ snippetId: s.id, title: s.title, content: s.content });
    });
    lines.push("", "---", t("ilink.selectSnippetHint"));
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, lines.join("\n"));

    commandPending = (input: string) => {
      const num = parseInt(input, 10);
      if (isNaN(num) || num < 1 || num > snippetEntries.length) {
        if (msg.from_user_id)
          bridge?.sendTextReply(
            msg.from_user_id,
            t("ilink.invalidSessionNumber", { min: "1", max: String(snippetEntries.length) }),
          );
        return;
      }
      const entry = snippetEntries[num - 1];
      const sessionId = activeSessionId ?? "";
      if (!sessionId) {
        if (msg.from_user_id)
          bridge?.sendTextReply(
            msg.from_user_id,
            [
              `📋 **${t("ilink.noActiveSession")}**`,
              "",
              t("ilink.switchSessionGuide"),
              t("ilink.createSessionGuide"),
            ].join("\n"),
          );
        return;
      }
      getHandlers()
        .sendPrompt({ sessionId, contents: [{ type: "text", text: entry.content }] })
        .then(() => {
          if (msg.from_user_id)
            bridge?.sendTextReply(msg.from_user_id, t("ilink.snippetSent", { title: entry.title }));
        })
        .catch((err: unknown) => {
          console.error("[iLink] Failed to send snippet:", err);
          if (msg.from_user_id) bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
        });
    };
  }

  async function handleCommandInfo(msg: WeixinMessage) {
    const currentSession = activeSessionId ? storage.getSession(activeSessionId) : null;
    const message = (() => {
      const lines: string[] = [];
      lines.push(`📋 **${t("ilink.sessionInfo")}**`);
      if (!currentSession) {
        lines.push(t("ilink.noActiveSession"));
        lines.push("", "---", t("ilink.switchSessionGuide"), t("ilink.createSessionGuide"));
        return lines.join("\n");
      }
      const projects = storage.listProjects();
      const project = projects.find((p) => p.id === currentSession.projectId);
      lines.push(`**${t("ilink.title")}**: ${currentSession.title || t("ilink.newSession")}`);
      if (project) lines.push(`**${t("ilink.project")}**: ${project.title}`);
      lines.push(`**${t("ilink.projectDir")}**: \`${currentSession.cwd}\``);
      lines.push(`**${t("ilink.agent")}**: \`${currentSession.agentId}\``);
      const enabledFeatures = new Set(currentSession.features ?? []);
      lines.push(`**${t("ilink.features")}**:`);
      for (const f of ALL_FEATURES) lines.push(`  - ${enabledFeatures.has(f) ? "✓" : "✗"} ${f}`);
      const globalSettings = storage.getSettings();
      const sessionMcpIds = new Set(currentSession.mcpServers ?? []);
      const allMcpServers = globalSettings.mcpServers ?? [];
      if (allMcpServers.length > 0) {
        lines.push(`**${t("ilink.mcpServers")}**:`);
        for (const srv of allMcpServers)
          lines.push(`  - ${sessionMcpIds.has(srv.id) && !srv.disabled ? "✓" : "✗"} \`${srv.id}\``);
      } else {
        lines.push(`**${t("ilink.mcpServers")}**: —`);
      }
      lines.push(
        "",
        "---",
        t("ilink.switchSessionGuide"),
        t("ilink.createSessionGuide"),
        t("ilink.modelGuide"),
        t("ilink.snippetGuide"),
      );
      return lines.join("\n");
    })();
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, message);
  }

  // ── API Handlers ───────────────────────────────────────────────────

  async function getIlinkStatus() {
    if (!bridge) return { connected: false };
    const status = bridge.status;
    if (!status.connected) {
      try {
        const restored = await bridge.tryRestore();
        if (restored) return bridge.status;
      } catch {}
    }
    return status;
  }

  async function startIlinkLogin() {
    return ensureBridge().startLogin();
  }

  async function pollIlinkQrcode({ qrcode }: { qrcode: string }) {
    const b = ensureBridge();
    const status = await b.checkQrcodeStatus(qrcode);
    return { status };
  }

  async function stopIlink() {
    if (bridge) {
      await bridge.stop();
      bridge = null;
    }
    activeSessionId = null;
    replyBuffer = "";
    await writeActiveSessionId(null);
    sendEvent("ilink-active-session-changed", { sessionId: null });
  }

  async function setActiveIlinkSession({ sessionId }: { sessionId: string | null }) {
    if (!sessionId) {
      activeSessionId = null;
      replyBuffer = "";
      await writeActiveSessionId(null);
      sendEvent("ilink-active-session-changed", { sessionId: null });
      return;
    }
    const session = storage.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    activeSessionId = sessionId;
    replyBuffer = "";
    await writeActiveSessionId(sessionId);
    sendEvent("ilink-active-session-changed", { sessionId });
  }

  async function getActiveIlinkSession() {
    if (activeSessionId) return { sessionId: activeSessionId };
    try {
      const savedId = await readActiveSessionId();
      if (savedId && storage.getSession(savedId)) {
        activeSessionId = savedId;
        return { sessionId: savedId };
      }
    } catch {}
    return { sessionId: null };
  }

  async function tryRestore() {
    const b = ensureBridge();
    const restored = await b.tryRestore();
    if (restored) {
      const savedId = await readActiveSessionId();
      if (savedId && storage.getSession(savedId)) {
        activeSessionId = savedId;
        sendEvent("ilink-active-session-changed", { sessionId: savedId });
      }
    }
  }

  return {
    state,
    getIlinkStatus,
    startIlinkLogin,
    pollIlinkQrcode,
    stopIlink,
    setActiveIlinkSession,
    getActiveIlinkSession,
    tryRestore,
    setHandlers,
  };
}
