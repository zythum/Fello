import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import { request } from "../backend";
import { useTranslation } from "react-i18next";

export function ReadonlyTerminal({ terminalId }: { terminalId: string }) {
  const { t } = useTranslation();
  const log = useAppStore((state) => state.terminalLogs[terminalId] || "");
  const setTerminalLog = useAppStore((state) => state.setTerminalLog);
  const containerRef = useRef<HTMLDivElement>(null);
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
    <div
      ref={containerRef}
      className="mt-2 bg-black text-gray-200 p-2 rounded-md font-mono text-xs overflow-y-auto"
      style={{ maxHeight: "300px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
    >
      {log || t("readonlyTerminal.waitingForOutput")}
    </div>
  );
}
