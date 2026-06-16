import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { WeixinMessage } from "./ilink/ilink-client";
import {
  ILinkBridge,
  readActiveSessionId,
  writeActiveSessionId,
  hasImageItems,
  extractMessageText,
  extractVoiceText,
} from "./ilink/ilink-bridge";
import { storageOps } from "./storage";
import { broadcastWebUIEvent } from "./webui";
import { pendingAskUserRequests } from "./ask-user";
import {
  getIlinkBridge,
  getIlinkActiveSessionId,
  getILinkCommandPending,
  setIlinkBridge,
  setIlinkActiveSessionId,
  setIlinkReplyBuffer,
  setILinkCommandPending,
} from "./ilink-state";
import { ALL_FEATURES } from "../shared/constants";
import type { FelloIPCSchema } from "../shared/schema";
import { t } from "./i18n";

// ── Dependencies injected at init ────────────────────────────────────

let sendEvent: <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => boolean = () => false;

/** backendHandlers reference for cross-module calls (sendPrompt, newSession, etc.) */
type BackendHandlers = {
  [K in keyof FelloIPCSchema["requests"]]: (
    params: FelloIPCSchema["requests"][K]["params"],
  ) => Promise<FelloIPCSchema["requests"][K]["response"]>;
};
let backendHandlers: BackendHandlers;

export function initIlinkHandlers(deps: {
  sendEvent: typeof sendEvent;
  backendHandlers: BackendHandlers;
}) {
  sendEvent = deps.sendEvent;
  backendHandlers = deps.backendHandlers;
}

// ── getILinkBridge ───────────────────────────────────────────────────

export function getILinkBridge(): ILinkBridge {
  let bridge = getIlinkBridge();
  if (!bridge) {
    bridge = new ILinkBridge({
      onStatusChange: (status) => {
        sendEvent("ilink-status-changed", { status });
        broadcastWebUIEvent("ilink-status-changed", { status });
      },
      onMessage: async (msg) => {
        const text = extractMessageText(msg);
        const voiceText = extractVoiceText(msg);
        const hasImages = hasImageItems(msg);
        const combinedText = [text, voiceText].filter(Boolean).join("\n");
        if (!combinedText.trim() && !hasImages) return;

        const trimmed = text.trim();

        const commandPending = getILinkCommandPending();
        if (commandPending) {
          commandPending(trimmed);
          setILinkCommandPending(null);
          return;
        }

        if (trimmed[0] === "!" || trimmed[0] === "！") {
          await handleIlinkCommand(trimmed, msg);
          return;
        }

        const sessionId = getIlinkActiveSessionId() ?? "";
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
        if (combinedText.trim()) {
          contents.push({ type: "text", text: combinedText });
        }

        if (hasImages && bridge) {
          const { useOriginalImage } = storageOps.getSettings().ilink;
          for (const item of msg.item_list ?? []) {
            if (item.type !== 2 || !item.image_item) continue;
            try {
              const base64 = await bridge.downloadImage(item.image_item, { useOriginalImage });
              if (base64) {
                contents.push({ type: "image", data: base64, mimeType: "image/jpeg" });
              }
            } catch (err) {
              console.error("[iLink] Failed to download image:", err);
            }
          }
        }

        if (contents.length === 0) return;

        // askUser intercept
        const pendingEntry = Array.from(pendingAskUserRequests.entries()).find(
          ([, p]) => p.sessionId === sessionId,
        );
        if (pendingEntry) {
          const [askUserId, pendingReq] = pendingEntry;
          const options = pendingReq.request.options;
          let respondedValue: string | null = null;

          if (/^\d+$/.test(trimmed)) {
            const index = parseInt(trimmed, 10) - 1;
            const option = options[index];
            if (option) respondedValue = option.value;
          }

          if (respondedValue !== null) {
            await backendHandlers.respondAskUser({ sessionId, askUserId, value: respondedValue });
          } else {
            await backendHandlers.respondAskUser({
              sessionId,
              askUserId,
              value: null,
              reason: trimmed || t("ilink.noInput"),
            });
          }

          if (bridge?.isConnected && getIlinkActiveSessionId() === sessionId) {
            const userId = bridge.userId;
            if (userId) bridge.sendTyping(userId, true).catch(() => {});
          }
          return;
        }

        try {
          await backendHandlers.sendPrompt({ sessionId, contents });
        } catch (err) {
          console.error("[iLink] Failed to route message to session:", err);
          if (msg.from_user_id) {
            await bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
          }
        }
      },
    });
    setIlinkBridge(bridge);
  }
  return bridge;
}

// ── Command Router ───────────────────────────────────────────────────

async function handleIlinkCommand(trimmed: string, msg: WeixinMessage) {
  const ilinkActiveSessionId = getIlinkActiveSessionId();

  const session = ilinkActiveSessionId ? storageOps.getSession(ilinkActiveSessionId) : null;
  if (session && session.isStreaming) {
    backendHandlers.cancelPrompt({ sessionId: session.id }).catch((err: unknown) => {
      console.warn("[iLink] Failed to cancel prompt:", err);
    });
  }

  const [command, ..._args] = trimmed.slice(1).split(/\s+/);

  if (command.toLowerCase() === "s") {
    await handleCommandSwitchSession(msg);
  } else if (command.toLowerCase() === "n") {
    await handleCommandNewSession(msg);
  } else if (command.toLowerCase() === "m") {
    await handleCommandSwitchModel(msg);
  } else if (command.toLowerCase() === "q") {
    await handleCommandSnippet(msg);
  } else {
    await handleCommandInfo(msg);
  }
}

async function handleCommandSwitchSession(msg: WeixinMessage) {
  const bridge = getIlinkBridge();
  const ilinkActiveSessionId = getIlinkActiveSessionId();
  const allSessions = storageOps.listSessions();
  if (allSessions.length === 0) {
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, t("ilink.noSessions"));
    return;
  }

  const projects = storageOps.listProjects();
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
      const marker = s.id === ilinkActiveSessionId ? " 👈" : "";
      const label = s.title || t("ilink.newSession");
      lines.push(`  ${index}. ${label}${marker}`);
      sessionEntries.push({ sessionId: s.id, label });
      index++;
    }
  }

  lines.push("", "---", t("ilink.switchSessionHint"));
  if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, lines.join("\n"));

  setILinkCommandPending((input: string) => {
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > sessionEntries.length) {
      if (msg.from_user_id) {
        bridge?.sendTextReply(
          msg.from_user_id,
          t("ilink.invalidSessionNumber", { min: "1", max: String(sessionEntries.length) }),
        );
      }
      return;
    }
    const entry = sessionEntries[num - 1];
    setIlinkActiveSessionId(entry.sessionId);
    setIlinkReplyBuffer("");
    writeActiveSessionId(entry.sessionId).catch(() => {});
    sendEvent("ilink-active-session-changed", { sessionId: entry.sessionId });
    if (msg.from_user_id) {
      bridge?.sendTextReply(msg.from_user_id, t("ilink.switchedToSession", { label: entry.label }));
    }
  });
}

async function handleCommandNewSession(msg: WeixinMessage) {
  const bridge = getIlinkBridge();
  const allProjects = storageOps.listProjects();
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

  setILinkCommandPending((input: string) => {
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > projectEntries.length) {
      if (msg.from_user_id) {
        bridge?.sendTextReply(
          msg.from_user_id,
          t("ilink.invalidSessionNumber", { min: "1", max: String(projectEntries.length) }),
        );
      }
      return;
    }
    const entry = projectEntries[num - 1];
    const settings = storageOps.getSettings();
    const agent = settings.agents.find((a) => !a.disabled);
    if (!agent) {
      if (msg.from_user_id) bridge?.sendTextReply(msg.from_user_id, t("ilink.noAgent"));
      return;
    }
    const globalSettings = storageOps.getSettings();
    const defaultMcpIds = (globalSettings.mcpServers || [])
      .filter((s) => !s.disabled)
      .map((s) => s.id);
    backendHandlers
      .newSession({
        projectId: entry.projectId,
        agentId: agent.id,
        mcpServers: defaultMcpIds,
        features: ALL_FEATURES,
        permissionMode: "allow-all",
      })
      .then((result) => {
        setIlinkActiveSessionId(result.sessionId);
        setIlinkReplyBuffer("");
        writeActiveSessionId(result.sessionId).catch(() => {});
        sendEvent("ilink-active-session-changed", { sessionId: result.sessionId });
        if (msg.from_user_id) {
          bridge?.sendTextReply(
            msg.from_user_id,
            t("ilink.createdAndSwitched", { project: entry.title }),
          );
        }
      })
      .catch((err: unknown) => {
        console.error("[iLink] Failed to create new session:", err);
        if (msg.from_user_id) bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
      });
  });
}

async function handleCommandSwitchModel(msg: WeixinMessage) {
  const bridge = getIlinkBridge();
  const sessionId = getIlinkActiveSessionId() ?? "";
  if (!sessionId) {
    if (msg.from_user_id) {
      const noSessionMsg = [
        `📋 **${t("ilink.noActiveSession")}**`,
        "",
        t("ilink.switchSessionGuide"),
        t("ilink.createSessionGuide"),
      ];
      await bridge?.sendTextReply(msg.from_user_id, noSessionMsg.join("\n"));
    }
    return;
  }

  const modelState = await backendHandlers.getModels({ sessionId });
  if (!modelState || !modelState.availableModels || modelState.availableModels.length === 0) {
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, t("ilink.noModels"));
    return;
  }

  const lines: string[] = [];
  lines.push(`🧠 **${t("ilink.modelList")}**`);
  lines.push(t("ilink.modelListDesc"));
  const modelEntries: Array<{ modelId: string; label: string }> = [];
  modelState.availableModels.forEach((m, i) => {
    const marker = m.modelId === modelState.currentModelId ? " 👈" : "";
    const label = m.name || m.modelId;
    lines.push(`  ${i + 1}. ${label}${marker}`);
    modelEntries.push({ modelId: m.modelId, label });
  });
  lines.push("", "---", t("ilink.switchModelHint"));
  if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, lines.join("\n"));

  setILinkCommandPending((input: string) => {
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > modelEntries.length) {
      if (msg.from_user_id) {
        bridge?.sendTextReply(
          msg.from_user_id,
          t("ilink.invalidSessionNumber", { min: "1", max: String(modelEntries.length) }),
        );
      }
      return;
    }
    const entry = modelEntries[num - 1];
    backendHandlers
      .setModel({ sessionId, modelId: entry.modelId })
      .then(() => {
        if (msg.from_user_id) {
          bridge?.sendTextReply(
            msg.from_user_id,
            t("ilink.switchedToModel", { model: entry.label }),
          );
        }
      })
      .catch((err: unknown) => {
        console.error("[iLink] Failed to set model:", err);
        if (msg.from_user_id) bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
      });
  });
}

async function handleCommandSnippet(msg: WeixinMessage) {
  const bridge = getIlinkBridge();
  const settings = storageOps.getSettings();
  const snippets = settings.snippets ?? [];
  if (snippets.length === 0) {
    if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, t("ilink.noSnippets"));
    return;
  }

  const lines: string[] = [];
  lines.push(`📝 **${t("ilink.snippetList")}**`);
  lines.push(t("ilink.snippetListDesc"));
  const snippetEntries: Array<{ snippetId: string; title: string; content: string }> = [];
  snippets.forEach((s, i) => {
    const preview = s.content.length > 50 ? s.content.substring(0, 50) + "..." : s.content;
    lines.push(`  ${i + 1}. **${s.title}** — ${preview}`);
    snippetEntries.push({ snippetId: s.id, title: s.title, content: s.content });
  });
  lines.push("", "---", t("ilink.selectSnippetHint"));
  if (msg.from_user_id) await bridge?.sendTextReply(msg.from_user_id, lines.join("\n"));

  setILinkCommandPending((input: string) => {
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > snippetEntries.length) {
      if (msg.from_user_id) {
        bridge?.sendTextReply(
          msg.from_user_id,
          t("ilink.invalidSessionNumber", { min: "1", max: String(snippetEntries.length) }),
        );
      }
      return;
    }
    const entry = snippetEntries[num - 1];
    const sessionId = getIlinkActiveSessionId() ?? "";
    if (!sessionId) {
      if (msg.from_user_id) {
        bridge?.sendTextReply(
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

    backendHandlers
      .sendPrompt({ sessionId, contents: [{ type: "text", text: entry.content }] })
      .then(() => {
        if (msg.from_user_id) {
          bridge?.sendTextReply(msg.from_user_id, t("ilink.snippetSent", { title: entry.title }));
        }
      })
      .catch((err: unknown) => {
        console.error("[iLink] Failed to send snippet:", err);
        if (msg.from_user_id) bridge?.sendTextReply(msg.from_user_id, t("ilink.errorProcessing"));
      });
  });
}

async function handleCommandInfo(msg: WeixinMessage) {
  const bridge = getIlinkBridge();
  const ilinkActiveSessionId = getIlinkActiveSessionId();
  const currentSession = ilinkActiveSessionId ? storageOps.getSession(ilinkActiveSessionId) : null;

  const message = (() => {
    const lines: string[] = [];
    lines.push(`📋 **${t("ilink.sessionInfo")}**`);

    if (!currentSession) {
      lines.push(t("ilink.noActiveSession"));
      lines.push("", "---", t("ilink.switchSessionGuide"), t("ilink.createSessionGuide"));
      return lines.join("\n");
    }

    const projects = storageOps.listProjects();
    const project = projects.find((p) => p.id === currentSession.projectId);
    lines.push(`**${t("ilink.title")}**: ${currentSession.title || t("ilink.newSession")}`);
    if (project) lines.push(`**${t("ilink.project")}**: ${project.title}`);
    lines.push(`**${t("ilink.projectDir")}**: \`${currentSession.cwd}\``);
    lines.push(`**${t("ilink.agent")}**: \`${currentSession.agentId}\``);

    const enabledFeatures = new Set(currentSession.features ?? []);
    lines.push(`**${t("ilink.features")}**:`);
    for (const f of ALL_FEATURES) {
      lines.push(`  - ${enabledFeatures.has(f) ? "✓" : "✗"} ${f}`);
    }

    const globalSettings = storageOps.getSettings();
    const sessionMcpIds = new Set(currentSession.mcpServers ?? []);
    const allMcpServers = globalSettings.mcpServers ?? [];
    if (allMcpServers.length > 0) {
      lines.push(`**${t("ilink.mcpServers")}**:`);
      for (const srv of allMcpServers) {
        const enabled = sessionMcpIds.has(srv.id) && !srv.disabled;
        lines.push(`  - ${enabled ? "✓" : "✗"} \`${srv.id}\``);
      }
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

// ── iLink API Handlers ───────────────────────────────────────────────

export async function getIlinkStatus() {
  const bridge = getIlinkBridge();
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

export async function startIlinkLogin() {
  const bridge = getILinkBridge();
  return bridge.startLogin();
}

export async function pollIlinkQrcode({ qrcode }: { qrcode: string }) {
  const bridge = getILinkBridge();
  const status = await bridge.checkQrcodeStatus(qrcode);
  return { status };
}

export async function stopIlink() {
  const bridge = getIlinkBridge();
  if (bridge) {
    await bridge.stop();
    setIlinkBridge(null);
  }
  setIlinkActiveSessionId(null);
  setIlinkReplyBuffer("");
  await writeActiveSessionId(null);
  sendEvent("ilink-active-session-changed", { sessionId: null });
}

export async function setActiveIlinkSession({ sessionId }: { sessionId: string | null }) {
  if (!sessionId) {
    setIlinkActiveSessionId(null);
    setIlinkReplyBuffer("");
    await writeActiveSessionId(null);
    sendEvent("ilink-active-session-changed", { sessionId: null });
    return;
  }
  const session = storageOps.getSession(sessionId);
  if (!session) throw new Error("Session does not exist");
  setIlinkActiveSessionId(sessionId);
  setIlinkReplyBuffer("");
  await writeActiveSessionId(sessionId);
  sendEvent("ilink-active-session-changed", { sessionId });
}

export async function getActiveIlinkSession() {
  const activeId = getIlinkActiveSessionId();
  if (activeId) return { sessionId: activeId };
  try {
    const savedId = await readActiveSessionId();
    if (savedId && storageOps.getSession(savedId)) {
      setIlinkActiveSessionId(savedId);
      return { sessionId: savedId };
    }
  } catch {}
  return { sessionId: null };
}
