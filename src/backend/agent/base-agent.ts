import type { AssistantDreamStartResult } from "../../shared/schema";

export interface AgentProcess {
  input: WritableStream<any>;
  output: ReadableStream<any>;
  close(): Promise<void>;
  /**
   * 仅内建个人助理提供：手动触发一次 Dream（记忆沉淀），立即返回是否已启动。
   * 其他 Agent 进程没有这个能力。
   */
  runDreamNow?(): Promise<AssistantDreamStartResult>;
}
