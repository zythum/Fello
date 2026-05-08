import type { AgentProcess } from "./type";

interface openaiCompatibleApiAgentOptions {
  baseUrl: "";
  headers?: Record<string, string>;
}

export function spawnOpenaiCompatibleApiAgent(
  _options: openaiCompatibleApiAgentOptions,
): AgentProcess {
  const inputStream = new TransformStream();
  const outputStream = new TransformStream();

  const close = async (): Promise<void> => {};

  return {
    input: inputStream.writable,
    output: outputStream.readable,
    close,
  };
}
