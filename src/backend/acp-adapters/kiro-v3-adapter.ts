import { randomUUID } from "crypto";
import type {
  CompactionStatus,
  PromptRequest,
  PromptResponse,
  SessionNotification,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { AddonSessionUpdate, SubagentStatus } from "../../shared/schema";
import type { ACPBridge } from "../agent/agent-bridge";
import { AcpAdapter } from "./acp-adapter";

// ── Protocol notes (kiro-cli v3, `kiro-cli acp --agent-engine=v3`) ────
//
// Unlike v2 (KiroAdapter), v3 no longer sends `_kiro.dev/*` extension
// notifications. Everything is inlined into standard session notifications
// under `update._meta.kiro`:
//
// - session_info_update + _meta.kiro.kind="context_usage"
//     → context window usage (usagePercentage 0-100 + breakdown)
// - session_info_update + _meta.kiro.kind="focus_update"
//     → session title / status (kept, so the title still flows to Fello)
// - session_info_update + _meta.kiro.kind= turn_start/turn_end/
//   turn_completion/user_message_id_assigned → housekeeping (dropped)
// - tool_call / tool_call_update + _meta.kiro.kind="agent-subtask"
//     → sub-agent registration + lifecycle
// - agent_message_chunk / agent_thought_chunk / tool_call / tool_call_update
//   carrying _meta.kiro.agentSubtaskId → sub-agent content. It reuses the
//   MAIN sessionId, so it must be re-routed to the sub-agent bucket.

// ── Types ────────────────────────────────────────────────────────────

/** Subset of the `_meta.kiro` payload this adapter reads. */
interface KiroMeta {
  kind?: string;
  toolId?: string;
  usagePercentage?: number;
  contextUsage?: { usagePercentage?: number };
  agentSubtaskId?: string;
  summarization?: KiroSummarization;
}

/**
 * v3's proprietary compaction result, delivered on a `session_info_update`
 * under `_meta.kiro.summarization` (sibling `kind: "summarization_completed"`).
 * `status` is kiro's own vocabulary ("success" / in-progress / failure); the
 * user-displayable text lives in `summary.conversationSummary`.
 */
interface KiroSummarization {
  status?: string;
  summary?: { conversationSummary?: string };
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Kiro v3 tool_call status → Fello SubagentStatus (identical vocabulary). */
const STATUS_MAP: Record<string, SubagentStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  failed: "failed",
};

/**
 * Kiro `_meta.kiro.summarization.status` → ACP CompactionStatus. v3 reports
 * `success` for a finished compaction; anything error-shaped maps to `failed`.
 * An in-progress/unknown value falls back to `in_progress`.
 */
const COMPACTION_STATUS_MAP: Record<string, CompactionStatus> = {
  success: "completed",
  completed: "completed",
  in_progress: "in_progress",
  failure: "failed",
  failed: "failed",
  error: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

/**
 * `_meta.kiro.toolId` values for kiro-internal plumbing tool calls that must
 * not surface in the chat (e.g. "fetch_cloud_config" on session startup /
 * each turn). Their follow-up `tool_call_update` carries no `_meta.kiro`.
 */
const INTERNAL_TOOL_IDS = new Set(["fetch_cloud_config"]);

function getKiroMeta(notification: SessionNotification): KiroMeta | null {
  const kiro = notification.update._meta?.["kiro"];
  if (typeof kiro !== "object" || kiro === null) return null;
  return kiro as KiroMeta;
}

/** Build the synthetic session_info_update carrying an AddonSessionUpdate. */
function makeSubagentUpdate(mainSessionId: string, addon: AddonSessionUpdate): SessionNotification {
  return {
    sessionId: mainSessionId,
    update: {
      sessionUpdate: "session_info_update",
      _meta: { fello: { update: addon } },
    },
  };
}

const COMPACTION_METHOD_NAME = "_kiro/session/compact";
const COMPACTION_COMMAND = "compact";

// ── Adapter ──────────────────────────────────────────────────────────

/**
 * Adapts kiro-cli v3 protocol extensions (all under `_meta.kiro`) into
 * Fello's canonical SessionNotification stream.
 *
 * Handles:
 * - `context_usage` → usage_update
 * - `agent-subtask` tool calls → subagent_update (registration + lifecycle)
 * - sub-agent content tagged with `agentSubtaskId` → re-keyed to the
 *   sub-agent's sessionId so the reducer routes it into the sub-agent bucket
 * - kiro-internal plumbing tool calls (e.g. `fetch_cloud_config`) → dropped,
 *   together with their follow-up `tool_call_update`
 * - remaining v3 housekeeping session_info_updates → dropped
 */
export class KiroV3Adapter extends AcpAdapter {
  /** toolCallIds of suppressed kiro-internal tool calls, keyed by session key. */
  private hiddenToolCalls = new Map<string, Set<string>>();

  /** In-flight `/compact` requests keyed by sessionId, so a terminal result or
   *  a cancel can be matched back to the optimistic in_progress card. */
  private compactions = new Map<
    string,
    { compactionId: string; abort: (reason?: unknown) => void }
  >();

  /**
   * True when the connected kiro-cli advertises `method` in its
   * `agentCapabilities._meta.kiro.extensionMethods`. Centralises the capability
   * probe shared by compaction send/cancel and command injection.
   */
  private supportsExtensionMethod(bridge: ACPBridge, method: string): boolean {
    const meta = bridge.initializeInfo?.agentCapabilities?._meta?.kiro;
    return (
      !!meta &&
      typeof meta === "object" &&
      "extensionMethods" in meta &&
      Array.isArray(meta.extensionMethods) &&
      meta.extensionMethods.includes(method)
    );
  }

  override preprocessNotification(
    bridge: ACPBridge,
    sessionId: string,
    notification: SessionNotification,
  ): SessionNotification[] | null {
    const update = notification.update;

    if (
      update.sessionUpdate === "available_commands_update" &&
      this.supportsExtensionMethod(bridge, COMPACTION_METHOD_NAME)
    ) {
      const availableCommands = update.availableCommands.slice();
      availableCommands.unshift({
        name: COMPACTION_COMMAND,
        description: "Compress conversation context",
      });
      return [
        {
          sessionId: notification.sessionId,
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands,
          },
        },
      ];
    }

    // ── Drop follow-up updates of hidden internal tool calls ────────
    // These updates carry no `_meta.kiro`, so the recorded toolCallId is
    // the only handle; without this they'd render as empty tool cards.
    if (
      update.sessionUpdate === "tool_call_update" &&
      this.isHiddenToolCall(sessionId, update.toolCallId)
    ) {
      if (update.status === "completed" || update.status === "failed") {
        this.forgetHiddenToolCall(sessionId, update.toolCallId);
      }
      return null;
    }

    const kiro = getKiroMeta(notification);

    // ── Drop kiro-internal plumbing tool calls ──────────────────────
    if (
      kiro &&
      update.sessionUpdate === "tool_call" &&
      typeof kiro.toolId === "string" &&
      INTERNAL_TOOL_IDS.has(kiro.toolId)
    ) {
      this.hideToolCall(sessionId, update.toolCallId);
      return null;
    }

    if (!kiro) return [notification];

    const subtaskId = typeof kiro.agentSubtaskId === "string" ? kiro.agentSubtaskId : null;

    // ── Compaction result → compaction_update ───────────────────────
    // v3 reports the outcome of `_kiro/session/compact` as a
    // session_info_update carrying `_meta.kiro.summarization`. Translate it
    // into the ACP-standard `compaction_update` timeline entity so the
    // reducer / UI only ever deal with the standard shape.
    //
    // We only emit a terminal update when this result matches a `/compact`
    // we triggered (reuse the pending compactionId so the terminal update
    // replaces the optimistic in_progress card in place). v3 is assumed not
    // to auto-compact, so a summarization without a pending id is dropped
    // rather than synthesising a fresh entity. Revisit here if v3 ever
    // starts emitting unsolicited summarization_completed.
    if (update.sessionUpdate === "session_info_update" && kiro.kind === "summarization_completed") {
      const summarization = kiro.summarization;
      const status =
        COMPACTION_STATUS_MAP[summarization?.status?.toLowerCase() ?? ""] ?? "in_progress";
      const summaryText = summarization?.summary?.conversationSummary;
      const summary =
        typeof summaryText === "string" && summaryText.length > 0 ? summaryText : undefined;
      const compactionId = sessionId ? this.compactions.get(sessionId)?.compactionId : null;
      if (compactionId) {
        this.compactions.delete(sessionId);
        return [
          {
            sessionId: notification.sessionId,
            update: {
              sessionUpdate: "compaction_update",
              compactionId,
              status,
              ...(summary !== undefined ? { summary: [{ type: "text", text: summary }] } : {}),
            },
          },
        ];
      }
    }

    // ── Context usage → usage_update ────────────────────────────────
    if (update.sessionUpdate === "session_info_update" && kiro.kind === "context_usage") {
      const percentage =
        typeof kiro.usagePercentage === "number"
          ? kiro.usagePercentage
          : typeof kiro.contextUsage?.usagePercentage === "number"
            ? kiro.contextUsage.usagePercentage
            : null;
      if (percentage === null) return null;
      return [
        {
          sessionId: notification.sessionId,
          update: { sessionUpdate: "usage_update", used: percentage / 100, size: 1 },
        },
      ];
    }

    // ── Sub-agent registration / lifecycle → subagent_update ────────
    if (kiro.kind === "agent-subtask") {
      if (
        subtaskId &&
        (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update")
      ) {
        const { name, prompt } = readSubtaskInput(update);
        const status = typeof update.status === "string" ? STATUS_MAP[update.status] : undefined;
        const addon: AddonSessionUpdate = {
          sessionUpdate: "subagent_update",
          sessionId: subtaskId,
          ...(name !== undefined && { name }),
          ...(prompt !== undefined && { prompt }),
          ...(status !== undefined && { status }),
        };
        return [makeSubagentUpdate(notification.sessionId, addon)];
      }
      return null;
    }

    // ── Re-route sub-agent content into its own session bucket ──────
    if (
      subtaskId &&
      (update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk" ||
        update.sessionUpdate === "tool_call" ||
        update.sessionUpdate === "tool_call_update")
    ) {
      return [{ ...notification, sessionId: subtaskId }];
    }

    // ── Drop remaining v3 housekeeping updates ──────────────────────
    // focus_update is deliberately kept: it carries the session title /
    // status that bridge-connect surfaces to the UI.
    if (
      update.sessionUpdate === "session_info_update" &&
      typeof kiro.kind === "string" &&
      kiro.kind !== "focus_update"
    ) {
      return null;
    }

    return [notification];
  }

  // ── Hidden internal tool calls ──────────────────────────────────

  private hideToolCall(sessionId: string, toolCallId: string): void {
    let hidden = this.hiddenToolCalls.get(sessionId);
    if (!hidden) {
      hidden = new Set();
      this.hiddenToolCalls.set(sessionId, hidden);
    }
    hidden.add(toolCallId);
  }

  private isHiddenToolCall(sessionId: string, toolCallId: string): boolean {
    return this.hiddenToolCalls.get(sessionId)?.has(toolCallId) ?? false;
  }

  private forgetHiddenToolCall(sessionId: string, toolCallId: string): void {
    this.hiddenToolCalls.get(sessionId)?.delete(toolCallId);
  }

  /**
   * 拦截用户输入的 `/compact` 命令，把它翻译成 v3 的 `_kiro/session/compact`
   * 扩展方法调用，而不是把 "compact" 当成普通 prompt 发给 agent。
   *
   * 只有当输入正好是 `compact` 且 kiro-cli 在能力声明里支持该扩展方法时才接管；
   * 其它情况返回 null，交回 bridge 走标准 prompt 流程。
   *
   * 接管时的时序：
   * 1. 生成 compactionId，建一个外部可 resolve/reject 的 deferred，记入
   *    `this.compactions`，使后续的 summarization 结果通知 / 取消请求能按
   *    sessionId 匹配回这次压缩。
   * 2. 调用扩展方法触发真正的压缩；其 Promise 决定 deferred 的成败。
   * 3. 乐观地推一张 in_progress 的 compaction_update 卡片，让 UI 立即有反馈
   *    （真正的结果由 preprocessNotification 收到 summarization_completed 时
   *    用同一个 compactionId 原地替换）。
   * 4. 把 deferred 映射成 PromptResponse：成功 → end_turn，失败/取消 → cancelled，
   *    无论哪种结果都清掉 `this.compactions` 里的登记。
   */
  override handlePromptSend(
    bridge: ACPBridge,
    sessionId: string,
    req: PromptRequest,
  ): null | Promise<PromptResponse> {
    const contentBlock = req.prompt[0] ?? { text: "", type: "text" };
    const text = (contentBlock.type === "text" ? contentBlock.text : "").trim();

    if (
      text === COMPACTION_COMMAND &&
      this.supportsExtensionMethod(bridge, COMPACTION_METHOD_NAME)
    ) {
      const compactionId = `kiro-compaction-${randomUUID()}`;
      // 手搓 deferred：把 resolve/reject 暴露到外部，供扩展方法回调与 abort() 调用。
      // 不用 Promise.withResolvers 是因为主 tsconfig 的 lib 仍是 ES2020，缺该 API。
      let resolve!: () => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });

      // 登记在册：abort 即 deferred 的 reject，取消时由 handlePromptCancel 调用。
      this.compactions.set(sessionId, { compactionId, abort: reject });
      bridge.execMethod(COMPACTION_METHOD_NAME, { sessionId }).then(() => resolve(), reject);
      // 乐观 in_progress 卡片：先让用户看到“正在压缩”，终态随后原地替换。
      bridge.onSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "compaction_update",
          compactionId,
          summary: [],
          status: "in_progress",
        },
      });

      // 把这次压缩包装成一轮 prompt 的结果：成功结束回合，被 abort 则记为取消。
      return promise.then(
        () => {
          this.compactions.delete(sessionId);
          return { stopReason: "end_turn" } satisfies PromptResponse;
        },
        () => {
          this.compactions.delete(sessionId);
          return { stopReason: "cancelled" } satisfies PromptResponse;
        },
      );
    }
    return null;
  }

  /**
   * 取消正在进行的 `/compact`。只有当前 session 确有在册的压缩任务时才接管：
   * 推一张 cancelled 的 compaction_update 把乐观卡片收尾，再 abort() 让
   * handlePromptSend 里挂起的 Promise 走 reject 分支（返回 cancelled）。
   *
   * 没有在册任务则返回 null，让 bridge 走标准 session/cancel 通知。
   */
  override handlePromptCancel(bridge: ACPBridge, sessionId: string): null | Promise<void> {
    if (!this.supportsExtensionMethod(bridge, COMPACTION_METHOD_NAME)) return null;

    const compaction = this.compactions.get(sessionId);
    if (!compaction) return null;

    const { compactionId, abort } = compaction;
    bridge.onSessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "compaction_update",
        compactionId,
        summary: [],
        status: "cancelled",
      },
    });
    abort();
    return Promise.resolve();
  }

  // ── State lifecycle ─────────────────────────────────────────────

  override rekey(oldKey: string, newKey: string): void {
    const hidden = this.hiddenToolCalls.get(oldKey);
    if (hidden) {
      this.hiddenToolCalls.delete(oldKey);
      this.hiddenToolCalls.set(newKey, hidden);
    }
    // 压缩登记随 session key 迁移，避免 resume 后匹配不回在飞的 /compact。
    const compaction = this.compactions.get(oldKey);
    if (compaction) {
      this.compactions.delete(oldKey);
      this.compactions.set(newKey, compaction);
    }
  }

  override cleanup(sessionKey: string): void {
    this.hiddenToolCalls.delete(sessionKey);
    this.compactions.delete(sessionKey);
  }

  override clearAll(): void {
    this.hiddenToolCalls.clear();
    this.compactions.clear();
  }
}

/** Read `{ name, prompt }` out of a sub-agent tool_call's rawInput. */
function readSubtaskInput(update: ToolCall | ToolCallUpdate): {
  name?: string;
  prompt?: string;
} {
  const rawInput = update.rawInput;
  if (typeof rawInput !== "object" || rawInput === null) return {};
  const record = rawInput as Record<string, unknown>;
  return {
    ...(typeof record.name === "string" && { name: record.name }),
    ...(typeof record.prompt === "string" && { prompt: record.prompt }),
  };
}
