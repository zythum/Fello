import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { request, subscribe } from "./backend";
import { useAppStore } from "./store";

export interface TerminalInstance {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  projectId: string;
}

export const terminalInstances = new Map<string, TerminalInstance>();

let isSubscribed = false;

function ensureGlobalSubscription() {
  if (isSubscribed) return;
  isSubscribed = true;

  subscribe.on("terminal-output", (payload) => {
    const instance = terminalInstances.get(payload.terminalId);
    if (instance) {
      instance.terminal.write(payload.data);
    }
  });

  subscribe.on("terminal-exit", (payload) => {
    const instance = terminalInstances.get(payload.terminalId);
    if (instance) {
      instance.terminal.options.disableStdin = true;
      instance.terminal.writeln(`\r\n[Process exited with code ${payload.exitCode ?? "null"}]`);
    }
    
    // We don't have projectId directly in the payload, but we can look it up from instances
    // or iterate through project states to update the running status
    const store = useAppStore.getState();
    store.projectStates.forEach((state, projectId) => {
      if (state.terminals.some(t => t.id === payload.terminalId)) {
        store.updateProjectState(projectId, (s) => ({
          terminals: s.terminals.map(t => 
            t.id === payload.terminalId ? { ...t, running: false } : t
          )
        }));
      }
    });
  });
}

export function getOrCreateTerminalInstance(
  terminalId: string,
  projectId: string,
  background: string,
): TerminalInstance {
  ensureGlobalSubscription();

  if (terminalInstances.has(terminalId)) {
    return terminalInstances.get(terminalId)!;
  }

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 11,
    lineHeight: 1.35,
    theme: {
      background,
    },
    altClickMovesCursor: false,
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const webLinksAddon = new WebLinksAddon((event, uri) => {
    window.open(uri, "_blank");
  });
  terminal.loadAddon(webLinksAddon);

  terminal.onData((data) => {
    void request.writeTerminal({ terminalId, data });
  });

  const instance: TerminalInstance = { id: terminalId, terminal, fitAddon, projectId };
  terminalInstances.set(terminalId, instance);
  return instance;
}

export function destroyTerminalInstance(terminalId: string) {
  const instance = terminalInstances.get(terminalId);
  if (instance) {
    instance.terminal.dispose();
    terminalInstances.delete(terminalId);
  }
}
