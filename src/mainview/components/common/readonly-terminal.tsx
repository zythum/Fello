import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store";
import { request } from "../../backend";
import { useTranslation } from "react-i18next";

export function ReadonlyTerminal({ terminalId }: { terminalId: string }) {
  const { t } = useTranslation();
  const log = useAppStore((state) => state.terminalLogs[terminalId] || "");
  const setTerminalLog = useAppStore((state) => state.setTerminalLog);
  const containerRef = useRef<HTMLPreElement>(null);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (hasFetched) return;
    setHasFetched(true);
    request
      .getAgentTerminalOutput({ terminalId })
      .then((fullLog) => {
        if (fullLog) {
          setTerminalLog(terminalId, fullLog);
        }
      })
      .catch(console.error);
  }, [terminalId, hasFetched, setTerminalLog]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [log]);

  return (
    <pre
      ref={containerRef}
      className="max-h-75 bg-black text-gray-200 p-2 whitespace-pre-wrap break-all font-mono text-xs overflow-auto"
    >
      <code>
        {log || t("readonlyTerminal.waitingForOutput")}
      </code>
    </pre>
  );
}
