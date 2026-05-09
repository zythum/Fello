import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../store";
import { request } from "../../backend";
import { useTranslation } from "react-i18next";

export function AgentTerminalOutput({
  sessionId,
  terminalId,
}: {
  sessionId: string;
  terminalId: string;
}) {
  const { t } = useTranslation();
  const sessionState = useAppStore((state) => state.getSessionState(sessionId));
  const log = sessionState?.terminalLogs?.[terminalId];
  const setTerminalLog = useAppStore((state) => state.setTerminalLog);
  const containerRef = useRef<HTMLPreElement>(null);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (hasFetched) return;
    setHasFetched(true);
    request
      .getAgentTerminalOutput({ sessionId, terminalId })
      .then((fullLog) => {
        if (fullLog) {
          setTerminalLog(sessionId, terminalId, fullLog);
        }
      })
      .catch(console.error);
  }, [sessionId, terminalId, hasFetched, setTerminalLog]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [log]);

  // Strip ANSI escape sequences (e.g. \x1b[38;5;250m, [38;5;250m) for clean display
  const cleanLog = useMemo(() => {
    // eslint-disable-next-line no-control-regex
    return log?.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "").replace(/\[[0-9;]*[0-9]m/g, "");
  }, [log]);

  return (
    <pre
      ref={containerRef}
      className="max-h-[70vh] bg-sidebar text-foreground/80 p-2 whitespace-pre-wrap break-all font-mono text-xs overflow-auto leading-3.5"
    >
      <code>{cleanLog ?? t("readonlyTerminal.noOutput")}</code>
    </pre>
  );
}
