export interface AgentProcess {
  input: WritableStream<any>;
  output: ReadableStream<any>;
  close(): Promise<void>;
}
