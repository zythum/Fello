import { ContentBlock, ToolCall, Plan } from '@agentclientprotocol/sdk';


/**
 * 所有聊天消息的基础接口。
 * 包含每条消息必须具备的元数据（与其具体类型无关）。
 */
export interface BaseMessage {
  /** 消息的唯一标识符 */
  messageId?: string | null;
}

/**
 * 适用于通过文本块增量拼接生成的消息（例如文本、思考过程）。
 * 这些消息需要流式状态来控制 UI 动画（如打字机光标）。
 */
export interface StreamableMessage extends BaseMessage {
  /** 当消息仍在增量接收/流式传输时为 true */
  streaming?: boolean;
  /** 消息内容块数组 */
  contents: ContentBlock[];
}

/**
 * 表示用户发送的消息。
 */
export interface UserMessage extends StreamableMessage {
  role: 'user_message';
}

/**
 * 表示 Agent 返回的标准响应消息。
 */
export interface AgentMessage extends StreamableMessage {
  role: 'agent_message';
}

/**
 * 表示 Agent 在生成响应之前的内部推理或思考过程。
 */
export interface AgentThoughtMessage extends StreamableMessage {
  role: 'agent_thought';
}

/**
 * 表示 Agent 发起的工具调用请求。
 * 这是一个完整的数据载荷，不支持增量流式传输。
 */
export interface ToolCallMessage extends ToolCall, BaseMessage {
  role: 'tool_call';
  /** 如果该工具调用与终端相关联，则为终端的 ID */
  terminalId?: string | null;
}

/**
 * 表示 Agent 生成的多步执行计划。
 * 协议要求在更新时全量替换，因此它不可进行流式传输。
 */
export interface PlanMessage extends Plan, BaseMessage {
  role: 'plan';
}

/**
 * 表示系统生成的消息（例如网络错误、超时提示）。
 * 由客户端本地创建，不从服务器流式传输。
 */
export interface SystemMessage extends BaseMessage {
  role: 'system_message';
  contents: ContentBlock[];
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
export type ChatRole = ChatMessage['role'];
