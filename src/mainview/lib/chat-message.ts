import { ContentBlock, ToolCall, Plan, ToolCallStatus } from "@agentclientprotocol/sdk";

/**
 * 所有聊天消息的基础接口。
 * 包含每条消息必须具备的元数据（与其具体类型无关）。
 */
export interface BaseMessage<T extends string> {
  role: T;
  readonly displayId: string;
  readonly receivedAt: number;
  _meta?: { [key: string]: unknown } | null;
}

/**
 * 表示用户发送的消息。
 */
export interface UserMessage extends BaseMessage<"user_message"> {
  contents: ContentBlock[];
}

/**
 * 表示 Agent 返回的标准响应消息。
 */
export interface AgentMessage extends BaseMessage<"agent_message"> {
  contents: ContentBlock[];
}

/**
 * 表示 Agent 在生成响应之前的内部推理或思考过程。
 */
export interface AgentThoughtMessage extends BaseMessage<"agent_thought"> {
  contents: ContentBlock[];
}

/**
 * 表示 Agent 发起的工具调用请求。
 * 这是一个完整的数据载荷，不支持增量流式传输。
 */
export interface ToolCallMessage extends BaseMessage<"tool_call">, ToolCall {
  /** 在 UI 中展示的工具标题 */
  title: string;
  /** 工具的执行状态 */
  status?: ToolCallStatus;
  /** 如果该工具调用与终端相关联，则为终端的 ID */
  terminalId?: string | null;
}

/**
 * 表示 Agent 生成的多步执行计划。
 * 协议要求在更新时全量替换，因此它不可进行流式传输。
 */
export interface PlanMessage extends BaseMessage<"plan">, Plan {}

/**
 * 表示系统生成的消息（例如网络错误、超时提示、Token 用量统计）。
 * 由客户端本地创建，不从服务器流式传输。
 */
export interface SystemMessage extends BaseMessage<"system_message"> {
  kind: "info" | "warning" | "error";
  contents: string[];
}

/**
 * 可辨识联合类型 (Discriminated Union)，表示可以出现在聊天视图中的任何消息类型。
 */
export type ChatMessage =
  | UserMessage
  | AgentMessage
  | AgentThoughtMessage
  | ToolCallMessage
  | PlanMessage
  | SystemMessage;

/**
 * 提取所有消息类型中可能出现的 role。
 * 方便在 Reducer 或 Switch/Case 判断中使用。
 */
export type ChatRole = ChatMessage["role"];

/**
 * 判断一条消息是否包含有效内容（不为空）并应该在界面中展示。
 * 过滤掉刚创建但还没开始生成内容块的 agent_message。
 */
export function isValidMessageToDisplay(message: ChatMessage): boolean {
  if (message.role === "agent_message") {
    for (const content of message.contents) {
      if (content.type === "text") {
        if (content.text.length > 0) {
          return true;
        }
      }
      if (content.type === "audio") {
        return true;
      }
      if (content.type === "image") {
        return true;
      }
      if (content.type === "resource") {
        return true;
      }
      if (content.type === "resource_link") {
        return true;
      }
    }
    return false;
  }
  if (message.role === "system_message") {
    return message.contents.length > 0;
  }
  return true;
}
