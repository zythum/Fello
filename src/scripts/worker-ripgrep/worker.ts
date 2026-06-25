/**
 * Disposable ripgrep child process worker.
 * Forked per-request, runs one search, then exits.
 * Isolates WASI/WebAssembly from the Electron main process.
 */
import { ripgrep } from "ripgrep";
import type {
  RipgrepWorkerRequest,
  RipgrepWorkerResponse,
} from "../../shared/zod/worker-ripgrep-schema";

process.once("message", async (msg: RipgrepWorkerRequest) => {
  try {
    const { code, stdout, stderr } = await ripgrep(msg.args, {
      buffer: true,
      preopens: { ".": msg.cwd },
    });
    const response: RipgrepWorkerResponse = {
      type: "result",
      code,
      stdout: stdout || "",
      stderr: stderr || "",
    };
    process.send!(response, () => process.exit(0));
  } catch (e: unknown) {
    const response: RipgrepWorkerResponse = {
      type: "error",
      error: e instanceof Error ? e.message : String(e),
    };
    process.send!(response, () => process.exit(1));
  }
});
