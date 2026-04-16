# ACP Plan Message UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在聊天时间线中展示 ACP `sessionUpdate = "plan"`，每次收到 plan 追加一条可折叠的 Plan 气泡，包含 entry 的 priority/status 图标与文案。

**Architecture:** 复用现有 `session-update` → `reduceSessionUpdate()` 的状态归并链路；新增 `PlanBubble` 作为 `ChatMessage.role === "plan"` 的渲染实现；Plan 更新在 MVP 阶段不做 upsert/置顶，直接追加到 `SessionState.messages`。

**Tech Stack:** React + TypeScript + Zustand；`react-i18next`；shadcn/ui（可选）；`lucide-react` 图标；ACP SDK 类型（`Plan`, `PlanEntry`）。

---

## Scope / Non-goals
- 本期只解决“能看到 plan”与基本可读性，不做“单条 plan 状态（最新替换）”、“置顶/滚动提示”、“plan 历史管理”。
- 不新增后端能力，不改变 ACP 事件转发逻辑。

## Current Code Touchpoints
- `PlanMessage` 类型已存在：[chat-message.ts](file:///Users/zhuyi/Workspace/Zythum/fello/src/mainview/chat-message.ts#L47-L52)
- `plan` 在 UI 层目前未渲染：[message-bubble.tsx](file:///Users/zhuyi/Workspace/Zythum/fello/src/mainview/components/message-bubble.tsx#L59-L61)
- reducer 目前未处理 `sessionUpdate === "plan"`：[session-state-reducer.ts](file:///Users/zhuyi/Workspace/Zythum/fello/src/mainview/lib/session-state-reducer.ts#L173-L256)
- 时间线渲染 key 使用 `displayId`：[chat-area.tsx](file:///Users/zhuyi/Workspace/Zythum/fello/src/mainview/components/chat-area.tsx#L207-L235)

---

### Task 1: Add i18n Strings for PlanBubble

**Files:**
- Modify: `src/mainview/locales/en.json`
- Modify: `src/mainview/locales/zh-CN.json`

- [ ] Add keys under `planBubble`:
  - `planBubble.title`
  - `planBubble.summary` (interpolation: `completed`, `total`)
  - `planBubble.status.pending`
  - `planBubble.status.inProgress`
  - `planBubble.status.completed`
  - `planBubble.priority.high`
  - `planBubble.priority.medium`
  - `planBubble.priority.low`

- [ ] Ensure both locales contain the same keys (no missing translations).

Example (shape only; translate values accordingly):

```json
{
  "planBubble": {
    "title": "Plan",
    "summary": "{{completed}} / {{total}} completed",
    "status": {
      "pending": "Pending",
      "inProgress": "In progress",
      "completed": "Completed"
    },
    "priority": {
      "high": "High",
      "medium": "Medium",
      "low": "Low"
    }
  }
}
```

---

### Task 2: Implement PlanBubble UI Component

**Files:**
- Create: `src/mainview/components/bubbles/plan-bubble.tsx`

- [ ] Implement `PlanBubble` as a `memo` component similar to [ThinkingBubble](file:///Users/zhuyi/Workspace/Zythum/fello/src/mainview/components/bubbles/thinking-bubble.tsx#L1-L47):
  - Use `<details>` for collapsible behavior.
  - Use `<summary>` row to show title + summary stats.
  - Default `open` behavior:
    - `open={true}` for MVP (plan 默认展开，降低“看不到”的概率)。

- [ ] Render plan entries list:
  - Each entry row shows:
    - status icon + status label
    - priority badge/icon + priority label
    - entry content text
  - Keep layout compact (tool bubble uses `text-xs` and summary row).

- [ ] Icon mapping approach (example):
  - status:
    - pending → `Loader2` (not spinning) or `Circle`
    - in_progress → `Loader2` spinning
    - completed → `Check`
  - priority:
    - high/medium/low → different color dot or `ChevronUp/Minus/ChevronDown`

- [ ] All user-facing text must be via `useTranslation()` with keys from Task 1.

Suggested TypeScript skeleton:

```tsx
import { memo } from "react";
import type { PlanMessage } from "../../chat-message";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";

export const PlanBubble = memo(function PlanBubble({
  message,
  prevBubbleRole,
}: {
  message: PlanMessage;
  prevBubbleRole?: string;
}) {
  const { t } = useTranslation();
  const total = message.entries.length;
  const completed = message.entries.filter((e) => e.status === "completed").length;

  return (
    <details className={cn("mx-4 border border-border bg-card", prevBubbleRole != null && "mt-4")} open>
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
        <span className="flex-1 text-foreground">{t("planBubble.title")}</span>
        <span className="text-[10px] text-muted-foreground">
          {t("planBubble.summary", { completed, total })}
        </span>
      </summary>
      <div className="border-t border-border px-3 py-2">
        <div className="flex flex-col gap-2">
          {message.entries.map((entry, idx) => (
            <div key={idx} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5">
                {entry.status === "completed" ? (
                  <Check className="size-3 text-green-400" />
                ) : (
                  <Loader2
                    className={cn(
                      "size-3",
                      entry.status === "in_progress" ? "animate-spin text-primary" : "text-muted-foreground",
                    )}
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-foreground break-words">{entry.content}</div>
                <div className="text-[10px] text-muted-foreground">
                  {t(`planBubble.priority.${entry.priority}`)} · {t(
                    entry.status === "in_progress"
                      ? "planBubble.status.inProgress"
                      : `planBubble.status.${entry.status}`,
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
});
```

---

### Task 3: Wire PlanBubble into MessageBubble Switch

**Files:**
- Modify: [message-bubble.tsx](file:///Users/zhuyi/Workspace/Zythum/fello/src/mainview/components/message-bubble.tsx#L1-L64)

- [ ] Import `PlanBubble` and replace the `case "plan": return null` branch.

Target structure:

```tsx
case "plan":
  return (
    <PlanBubble
      message={message}
      prevBubbleRole={prevBubbleRole}
      nextBubbleRole={nextBubbleRole}
    />
  );
```

Note:
- `PlanBubble` props can ignore `nextBubbleRole` for MVP, but keep signature consistent with other bubbles if you prefer.

---

### Task 4: Handle sessionUpdate = "plan" in Reducer (Append Mode)

**Files:**
- Modify: [session-state-reducer.ts](file:///Users/zhuyi/Workspace/Zythum/fello/src/mainview/lib/session-state-reducer.ts#L173-L256)

- [ ] Extend `UpdatePayload<...>` usage or add a local helper for plan updates.
- [ ] In `reduceSessionUpdate()` switch, add:
  - `case "plan":` create a `PlanMessage` and append to `messages`.

Suggested reducer branch (shape):

```ts
case "plan":
  nextState = {
    ...currentState,
    messages: [
      ...currentState.messages,
      {
        role: "plan",
        entries: update.entries ?? [],
        _meta: update._meta,
        displayId: crypto.randomUUID(),
      },
    ],
  };
  break;
```

Acceptance notes:
- Each plan becomes a new timeline item (append).
- No upsert, no dedupe, no “latest plan” state yet.

---

### Task 5: Verify & Regression Checks

**Files:**
- None (run commands)

- [ ] Run typecheck:
  - Command: `npm run typecheck`
  - Expected: exit code 0

- [ ] Run lint:
  - Command: `npm run lint`
  - Expected: exit code 0

- [ ] Run format (required because Task 2 adds a new `.tsx` file):
  - Command: `npm run format`
  - Expected: no errors

- [ ] Manual UI verification:
  - Trigger an agent response that includes plan updates (at least 2 plan notifications).
  - Confirm chat timeline shows multiple plan bubbles.
  - Confirm each plan bubble can collapse/expand.
  - Confirm priority/status labels render via i18n (switch language to validate).
  - Confirm no regressions in tool_call, agent_thought, agent_message streaming.

---

## Follow-ups (Optional, after MVP ships)
- Switch to “single plan per session”:
  - Maintain `latestPlan` in `SessionState`
  - Upsert a fixed `displayId` plan message
  - Decide whether to move it to end on update or present as sticky panel
- Add “plan updated” indicator when user is not at bottom.

