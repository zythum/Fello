declare namespace NodeJS {
  interface Process {
    rendererPath: string;
    scriptsPath: string;
    treeSitterWasmPath: string;
  }
}