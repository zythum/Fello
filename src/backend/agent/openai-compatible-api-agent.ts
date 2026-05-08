import {
  AgentSideConnection,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import { OpenaiCompatibleAgent } from "../../agents/openai-compatible-agent";
import type { ApiAgentInfo } from "../../shared/schema";
import type { AgentProcess } from "./type";

export function spawnOpenaiCompatibleApiAgent(options: ApiAgentInfo): AgentProcess {
  const inputStream = new TransformStream<Uint8Array, Uint8Array>();
  const outputStream = new TransformStream<Uint8Array, Uint8Array>();
  const stream = ndJsonStream(outputStream.writable, inputStream.readable);
  const agent = new OpenaiCompatibleAgent(options);
  const connection = new AgentSideConnection(() => agent, stream);
  agent.setConnection(connection);

  const close = async (): Promise<void> => {
    await agent.abortAll();
    const writer = outputStream.writable.getWriter();
    try {
      await writer.close();
    } catch {}
    writer.releaseLock();
  };

  return {
    input: inputStream.writable,
    output: outputStream.readable,
    close,
  };
}
