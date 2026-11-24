import { agent, ndJsonStream, methods, type AgentConnection } from "@agentclientprotocol/sdk";
import { AssistantAgent, type AssistantAgentOptions } from "../../assistant/assistant-agent";
import { ASSISTANT_AGENT_ID } from "../../assistant/constants";
import type { AgentProcess } from "./base-agent";

export function spawnAssistantAgent(options: AssistantAgentOptions): AgentProcess {
  const inputStream = new TransformStream<Uint8Array, Uint8Array>();
  const outputStream = new TransformStream<Uint8Array, Uint8Array>();
  const stream = ndJsonStream(outputStream.writable, inputStream.readable);
  const impl = new AssistantAgent(options);

  const app = agent({ name: ASSISTANT_AGENT_ID })
    .onRequest(methods.agent.initialize, (ctx) => impl.initialize(ctx.params))
    .onRequest(methods.agent.authenticate, () => impl.authenticate())
    .onRequest(methods.agent.session.new, (ctx) => impl.newSession(ctx.params))
    .onRequest(methods.agent.session.resume, (ctx) => impl.resumeSession(ctx.params))
    .onRequest(methods.agent.session.load, (ctx) => impl.loadSession(ctx.params))
    .onRequest(methods.agent.session.close, (ctx) => impl.closeSession(ctx.params))
    .onRequest(methods.agent.session.delete, (ctx) => impl.deleteSession(ctx.params))
    .onRequest(methods.agent.session.setConfigOption, (ctx) =>
      impl.setSessionConfigOption(ctx.params),
    )
    .onRequest(methods.agent.session.prompt, (ctx) => impl.prompt(ctx.params))
    .onNotification(methods.agent.session.cancel, (ctx) => impl.cancel(ctx.params));

  const connection: AgentConnection = app.connect(stream);
  impl.setConnection(connection.client);

  return {
    input: inputStream.writable,
    output: outputStream.readable,
    runDreamNow: () => impl.dreamNow(),
    async close(): Promise<void> {
      await impl.abortAll();
      const writer = outputStream.writable.getWriter();
      try {
        await writer.close();
      } catch {}
      writer.releaseLock();
    },
  };
}
