import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { Feature, SessionInfo, SessionModelState } from "../../shared/schema";
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
  stopIlink: (params: { logout: boolean }) => Promise<void>;
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
  updateSession: SessionModule["updateSession"];
  loadSession: SessionModule["loadSession"];
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
  let commandPending: ((index: number) => void | Promise<void>) | null = null;

  // Late-bound handler deps (set after session/askUser modules are created)
  let handlers: IlinkHandlerDeps | null = null;

  function setHandlers(h: IlinkHandlerDeps) {
    handlers = h;
  }

  function getHandlers(): IlinkHandlerDeps {
    if (!handlers) throw new Error("[ilink] handlers not yet initialized");
    return handlers;
  }

  // ── Menu helpers ───────────────────────────────────────────────────
  //
  // Numbered menus share one reply rule: a reply that starts with a digit is a menu selection,
  // anything else is a normal message for the agent (see the onMessage dispatch).

  /** Parse the leading number of a menu reply; null when the reply does not start with a digit. */
  function parseMenuIndex(input: string): number | null {
    const match = input.match(/^\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  /** Report an out-of-range menu reply. Callers keep their menu armed so the user can retry. */
  async function replyInvalidIndex(msg: WeixinMessage, max: number) {
    if (!msg.from_user_id) return;
    await bridge?.sendTextReply(
      msg.from_user_id,
      t("ilink.invalidMenuNumber", { min: "1", max: String(max) }),
    );
  }

  async function replyUnknownCommand(msg: WeixinMessage) {
    if (!msg.from_user_id) return;
    await bridge?.sendTextReply(msg.from_user_id, t("ilink.unknownCommand"));
  }

  /** Feature → i18n key, so menus and the status view show localized names instead of raw ids. */
  const FEATURE_LABEL_KEYS = {
    skills: "ilink.featureSkills",
    search: "ilink.featureSearch",
    image_generation: "ilink.featureImageGeneration",
    memory: "ilink.featureMemory",
    ask_user: "ilink.featureAskUser",
    share_to_user: "ilink.featureShareToUser",
  } as const satisfies Record<Feature, string>;

  function getFeatureLabel(feature: Feature): string {
    return t(FEATURE_LABEL_KEYS[feature]);
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

          // Commands always win: sending a new command drops any menu that is waiting for a reply.
          if (trimmed[0] === "!" || trimmed[0] === "！") {
            commandPending = null;
            await handleIlinkCommand(trimmed, msg);
            return;
          }

          if (commandPending) {
            const index = parseMenuIndex(trimmed);
            if (index !== null) {
              const pending = commandPending;
              // Clear before awaiting so the handler can re-arm the menu when it wants to.
              commandPending = null;
              await pending(index);
              return;
            }
            // Not a menu reply: close the menu and fall through, so the text is forwarded to the
            // agent instead of being swallowed by the menu.
            commandPending = null;
          }

          await handleUserMessage(msg, { trimmed, combinedText, hasImages });
        },
      });
    }
    return bridge;
  }

  // ── Plain messages ─────────────────────────────────────────────────

  async function handleUserMessage(
    msg: WeixinMessage,
    input: { trimmed: string; combinedText: string; hasImages: boolean },
  ) {
    const { trimmed, combinedText, hasImages } = input;

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
    const name = command.toLowerCase();
    // Branches follow the order the commands are listed in (settings page and guides).
    // Bare "!" (and only that) shows the status view; unknown commands get an explicit hint.
    if (name === "") await handleCommandInfo(msg);
    else if (name === "s") await handleCommandSwitchSession(msg);
    else if (name === "n") await handleCommandNewSession(msg);
    else if (name === "m") await handleCommandSwitchModel(msg);
    else if (name === "p") await handleCommandPermission(msg);
    else if (name === "f") await handleCommandFeatures(msg);
    else if (name === "c") await handleCommandMcpServers(msg);
    else if (name === "q") await handleCommandSnippet(msg);
    else await replyUnknownCommand(msg);
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
        const agentId = s.agentId;
        lines.push(`  ${index}. [${agentId}] ${label}${marker}`);
        sessionEntries.push({ sessionId: s.id, label });
        index++;
      }
    }
    lines.push("", "---", t("ilink.switchSessionHint"));
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, lines.join("\n"));

    const pending = async (index: number) => {
      const entry = sessionEntries[index - 1];
      if (!entry) {
        await replyInvalidIndex(msg, sessionEntries.length);
        commandPending = pending; // keep the menu open so the user can retry
        return;
      }
      activeSessionId = entry.sessionId;
      replyBuffer = "";
      writeActiveSessionId(entry.sessionId).catch(() => {});
      sendEvent("ilink-active-session-changed", { sessionId: entry.sessionId });
      if (msg.from_user_id)
        await bridge?.sendTextReply(
          msg.from_user_id,
          t("ilink.switchedToSession", { label: entry.label }),
        );
    };
    commandPending = pending;
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

    const pending = (index: number) => {
      const entry = projectEntries[index - 1];
      if (!entry) {
        void replyInvalidIndex(msg, projectEntries.length);
        commandPending = pending; // keep the menu open so the user can retry
        return;
      }
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
    commandPending = pending;
  }

  async function handleCommandSwitchModel(msg: WeixinMessage) {
    const sessionId = activeSessionId ?? "";
    if (!sessionId) {
      await replyNoActiveSession(msg);
      return;
    }

    // `getModels` reads live bridge state, so a session that was never loaded (e.g. restored
    // after an app restart) would look like it has no models. Load it on demand first — without
    // `force`, so an already loaded session returns its cached state and a loading one shares its
    // in-flight promise instead of restarting anything.
    let modelState: SessionModelState | null;
    try {
      modelState = await getHandlers().getModels({ sessionId });
      if (!modelState) {
        await getHandlers().loadSession({ sessionId });
        modelState = await getHandlers().getModels({ sessionId });
      }
    } catch (err) {
      console.error("[iLink] Failed to prepare model list:", err);
      if (msg.from_user_id)
        await bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
      return;
    }

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

    const pending = (index: number) => {
      const entry = modelEntries[index - 1];
      if (!entry) {
        void replyInvalidIndex(msg, modelEntries.length);
        commandPending = pending; // keep the menu open so the user can retry
        return;
      }
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
    commandPending = pending;
  }

  // ── Shared command helpers ─────────────────────────────────────────

  async function replyNoActiveSession(msg: WeixinMessage) {
    if (!msg.from_user_id) return;
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

  // ── Permission mode ───────────────────────────────────────────────

  const PERMISSION_MODES: SessionInfo["permissionMode"][] = ["ask", "allow-all"];

  function getPermissionModeLabel(mode: SessionInfo["permissionMode"]): string {
    return mode === "allow-all" ? t("ilink.permissionAllowAll") : t("ilink.permissionAsk");
  }

  /**
   * Switch the session permission mode.
   *
   * Single-choice menu, handled like `!m` (model): reply once and the menu is done.
   *
   * Unlike features / MCP servers this needs no session reload: the mode is read from storage
   * on every permission request (`bridge-connect`), so the change is live immediately.
   */
  async function handleCommandPermission(msg: WeixinMessage) {
    const sessionId = activeSessionId ?? "";
    const session = sessionId ? storage.getSession(sessionId) : null;
    if (!session) {
      await replyNoActiveSession(msg);
      return;
    }

    const lines: string[] = [];
    lines.push(`📋 **${t("ilink.permissionMenu")}**`);
    lines.push(t("ilink.permissionMenuDesc"));
    const modeEntries: Array<{ mode: SessionInfo["permissionMode"]; label: string }> = [];
    PERMISSION_MODES.forEach((mode, index) => {
      const marker = mode === session.permissionMode ? " 👈" : "";
      const label = getPermissionModeLabel(mode);
      lines.push(`  ${index + 1}. ${label}${marker}`);
      modeEntries.push({ mode, label });
    });
    lines.push("", "---", t("ilink.switchPermissionHint"));
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, lines.join("\n"));

    const pending = (index: number) => {
      const entry = modeEntries[index - 1];
      if (!entry) {
        void replyInvalidIndex(msg, modeEntries.length);
        commandPending = pending; // keep the menu open so the user can retry
        return;
      }
      getHandlers()
        .updateSession({ sessionId, permissionMode: entry.mode })
        .then(() => {
          if (msg.from_user_id)
            bridge?.sendTextReply(
              msg.from_user_id,
              t("ilink.permissionSwitched", { mode: entry.label }),
            );
        })
        .catch((err: unknown) => {
          console.error("[iLink] Failed to update permission mode:", err);
          if (msg.from_user_id) bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
        });
    };
    commandPending = pending;
  }

  // ── Feature switches ───────────────────────────────────────────────

  /**
   * Toggle one feature and apply it immediately.
   *
   * Features are Agent session startup parameters: they are only read when the session is
   * (re)loaded, so the session is restarted for the change to take effect.
   */
  async function handleCommandFeatures(msg: WeixinMessage) {
    const sessionId = activeSessionId ?? "";
    if (!sessionId || !storage.getSession(sessionId)) {
      await replyNoActiveSession(msg);
      return;
    }

    /** Features in ALL_FEATURES order so the numbering stays stable across replies. */
    const getEntries = () => {
      const enabled = new Set(storage.getSession(sessionId)?.features ?? []);
      return ALL_FEATURES.map((feature) => ({
        id: feature,
        label: getFeatureLabel(feature),
        enabled: enabled.has(feature),
      }));
    };

    const buildMenuText = (entries: ReturnType<typeof getEntries>) => {
      const lines: string[] = [];
      lines.push(`📋 **${t("ilink.featuresMenu")}**`);
      lines.push(t("ilink.featuresMenuDesc"));
      entries.forEach((entry, index) => {
        lines.push(`  ${index + 1}. ${entry.enabled ? "✓" : "✗"} ${entry.label}`);
      });
      lines.push("", "---", t("ilink.toggleHint"));
      return lines.join("\n");
    };

    const entries = getEntries();
    if (entries.length === 0) {
      if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, t("ilink.noToggleItems"));
      return;
    }
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, buildMenuText(entries));

    // Immediate-apply menu: replying a number flips that switch right away, then the menu is
    // re-sent so the user can keep toggling without sending the command again. `0` exits it.
    const pending = async (index: number) => {
      if (index === 0) {
        if (msg.from_user_id)
          await bridge?.sendTextReply(msg.from_user_id, t("ilink.toggleCancelled"));
        return;
      }
      const current = getEntries();
      const target = current[index - 1];
      if (!target) {
        await replyInvalidIndex(msg, current.length);
        commandPending = pending; // keep the menu open so the user can retry
        return;
      }
      const label = `${t(target.enabled ? "ilink.toggledOff" : "ilink.toggledOn")} ${target.label}`;
      const nextIds: Feature[] = current
        .filter((entry) => entry.enabled && entry.id !== target.id)
        .map((entry) => entry.id);
      if (!target.enabled) nextIds.push(target.id);

      try {
        await getHandlers().updateSession({ sessionId, features: nextIds });
      } catch (err) {
        console.error("[iLink] Failed to update session features:", err);
        if (msg.from_user_id)
          await bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
        return;
      }

      try {
        await getHandlers().loadSession({ sessionId, force: true });
        // `label` already carries the ✅ 已开启/已关闭 prefix — no extra suffix needed.
        if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, label);
      } catch (err) {
        console.error("[iLink] Failed to restart session after feature toggle:", err);
        if (msg.from_user_id)
          await bridge?.sendTextReply(
            msg.from_user_id,
            t("ilink.toggleSavedRestartFailed", { label }),
          );
      }

      const fresh = getEntries();
      if (msg.from_user_id && fresh.length > 0)
        await bridge?.sendTextReply(msg.from_user_id, buildMenuText(fresh));
      commandPending = pending;
    };
    commandPending = pending;
  }

  // ── MCP switches ───────────────────────────────────────────────────

  /**
   * Toggle one MCP server and apply it immediately.
   *
   * Same flow as the feature switches: MCP servers are Agent session startup parameters, so the
   * session is restarted for the change to take effect.
   */
  async function handleCommandMcpServers(msg: WeixinMessage) {
    const sessionId = activeSessionId ?? "";
    if (!sessionId || !storage.getSession(sessionId)) {
      await replyNoActiveSession(msg);
      return;
    }

    /** Configured servers in settings order, so the numbering stays stable across replies. */
    const getEntries = () => {
      const enabled = new Set(storage.getSession(sessionId)?.mcpServers ?? []);
      return (storage.getSettings().mcpServers ?? []).map((server) => ({
        id: server.id,
        label: server.id,
        enabled: enabled.has(server.id),
      }));
    };

    const buildMenuText = (entries: ReturnType<typeof getEntries>) => {
      const lines: string[] = [];
      lines.push(`📋 **${t("ilink.mcpMenu")}**`);
      lines.push(t("ilink.mcpMenuDesc"));
      entries.forEach((entry, index) => {
        lines.push(`  ${index + 1}. ${entry.enabled ? "✓" : "✗"} ${entry.label}`);
      });
      lines.push("", "---", t("ilink.toggleHint"));
      return lines.join("\n");
    };

    const entries = getEntries();
    if (entries.length === 0) {
      if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, t("ilink.noToggleItems"));
      return;
    }
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, buildMenuText(entries));

    // Immediate-apply menu: replying a number flips that switch right away, then the menu is
    // re-sent so the user can keep toggling without sending the command again. `0` exits it.
    const pending = async (index: number) => {
      if (index === 0) {
        if (msg.from_user_id)
          await bridge?.sendTextReply(msg.from_user_id, t("ilink.toggleCancelled"));
        return;
      }
      const current = getEntries();
      const target = current[index - 1];
      if (!target) {
        await replyInvalidIndex(msg, current.length);
        commandPending = pending; // keep the menu open so the user can retry
        return;
      }
      const label = `${t(target.enabled ? "ilink.toggledOff" : "ilink.toggledOn")} ${target.label}`;
      const nextIds = current
        .filter((entry) => entry.enabled && entry.id !== target.id)
        .map((entry) => entry.id);
      if (!target.enabled) nextIds.push(target.id);

      try {
        await getHandlers().updateSession({ sessionId, mcpServers: nextIds });
      } catch (err) {
        console.error("[iLink] Failed to update session MCP servers:", err);
        if (msg.from_user_id)
          await bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
        return;
      }

      try {
        await getHandlers().loadSession({ sessionId, force: true });
        // `label` already carries the ✅ 已开启/已关闭 prefix — no extra suffix needed.
        if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, label);
      } catch (err) {
        console.error("[iLink] Failed to restart session after MCP toggle:", err);
        if (msg.from_user_id)
          await bridge?.sendTextReply(
            msg.from_user_id,
            t("ilink.toggleSavedRestartFailed", { label }),
          );
      }

      const fresh = getEntries();
      if (msg.from_user_id && fresh.length > 0)
        await bridge?.sendTextReply(msg.from_user_id, buildMenuText(fresh));
      commandPending = pending;
    };
    commandPending = pending;
  }

  // ── Snippets ───────────────────────────────────────────────────────

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

    const pending = (index: number) => {
      const entry = snippetEntries[index - 1];
      if (!entry) {
        void replyInvalidIndex(msg, snippetEntries.length);
        commandPending = pending; // keep the menu open so the user can retry
        return;
      }
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
    commandPending = pending;
  }

  // ── Session status ─────────────────────────────────────────────────

  async function handleCommandInfo(msg: WeixinMessage) {
    const currentSession = activeSessionId ? storage.getSession(activeSessionId) : null;
    const message = (() => {
      const lines: string[] = [];
      if (!currentSession) {
        lines.push(t("ilink.noActiveSession"));
        lines.push("", "---", t("ilink.switchSessionGuide"), t("ilink.createSessionGuide"));
        return lines.join("\n");
      }
      const projects = storage.listProjects();
      const project = projects.find((p) => p.id === currentSession.projectId);
      lines.push(`📋 **${currentSession.title || t("ilink.newSession")}**\n`);
      if (project) lines.push(`**${t("ilink.project")}**: ${project.title}\n`);
      lines.push(`**${t("ilink.projectDir")}**: \`${currentSession.cwd}\`\n`);
      lines.push(`**${t("ilink.agent")}**: \`${currentSession.agentId}\`\n`);
      lines.push(
        `**${t("ilink.permissionMenu")}**: ${getPermissionModeLabel(currentSession.permissionMode)}\n`,
      );
      const enabledFeatures = new Set(currentSession.features ?? []);
      lines.push(`**${t("ilink.features")}**:`);
      for (const f of ALL_FEATURES)
        lines.push(`  - ${enabledFeatures.has(f) ? "✓" : "✗"} ${getFeatureLabel(f)}`);
      const sessionMcpIds = new Set(currentSession.mcpServers ?? []);
      const allMcpServers = storage.getSettings().mcpServers ?? [];
      lines.push(`\n`);
      if (allMcpServers.length > 0) {
        lines.push(`**${t("ilink.mcpServers")}**:`);
        // Membership only — a globally disabled server still shows the session's own state here.
        for (const srv of allMcpServers)
          lines.push(`  - ${sessionMcpIds.has(srv.id) ? "✓" : "✗"} ${srv.id}`);
      } else {
        lines.push(`**${t("ilink.mcpServers")}**: —`);
      }
      lines.push(
        "",
        "---",
        "- " + t("ilink.switchSessionGuide"),
        "- " + t("ilink.createSessionGuide"),
        "- " + t("ilink.modelGuide"),
        "- " + t("ilink.permissionGuide"),
        "- " + t("ilink.featureGuide"),
        "- " + t("ilink.mcpServerGuide"),
        "- " + t("ilink.snippetGuide"),
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

  async function stopIlink({ logout }: { logout: boolean }) {
    if (bridge) {
      await bridge.stop({ logout });
      bridge = null;
    }
    activeSessionId = null;
    replyBuffer = "";

    if (logout) {
      await writeActiveSessionId(null);
      sendEvent("ilink-active-session-changed", { sessionId: null });
    }
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
