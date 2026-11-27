import { agent, ndJsonStream, methods, type AgentConnection } from "@agentclientprotocol/sdk";
import type { ApiAgent } from "../../agents/api-agent";
import { OpenaiCompatibleAgent } from "../../agents/openai-compatible-agent";
import { OpenResponsesAgent } from "../../agents/open-responses-agent";
import type { ApiAgentInfo } from "../../shared/schema";
import type { AgentProcess } from "./base-agent";

/** 按 provider 选择具体协议实现；未知 provider 由实现类的构造函数报错。 */
function createApiAgent(options: ApiAgentInfo): ApiAgent {
  return options.provider === "open-responses"
    ? new OpenResponsesAgent(options)
    : new OpenaiCompatibleAgent(options);
}

export function spawnApiAgent(options: ApiAgentInfo): AgentProcess {
  const inputStream = new TransformStream<Uint8Array, Uint8Array>();
  const outputStream = new TransformStream<Uint8Array, Uint8Array>();
  const stream = ndJsonStream(outputStream.writable, inputStream.readable);
  const impl = createApiAgent(options);

  const app = agent({ name: "api-agent" })
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

  const close = async (): Promise<void> => {
    await impl.abortAll();
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
