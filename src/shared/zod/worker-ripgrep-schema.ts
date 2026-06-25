// Shared types between ripgrep.ts and worker-ripgrep/worker.ts

export interface RipgrepWorkerRequest {
  args: string[];
  cwd: string;
}

export interface RipgrepWorkerResult {
  type: "result";
  code: number;
  stdout: string;
  stderr: string;
}

export interface RipgrepWorkerError {
  type: "error";
  error: string;
}

export type RipgrepWorkerResponse = RipgrepWorkerResult | RipgrepWorkerError;
