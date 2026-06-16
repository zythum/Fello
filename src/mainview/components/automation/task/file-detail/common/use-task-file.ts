import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../../../../backend";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

interface UseTaskFileOptions {
  encoding?: "text" | "base64";
}

interface UseTaskFileResult {
  content: string;
  arrayBuffer: ArrayBuffer;
  loading: boolean;
  errorMsg: string;
}

export function useTaskFile(
  scheduleId: string,
  taskId: string,
  filePath: string,
  options: UseTaskFileOptions = {},
): UseTaskFileResult {
  const { encoding = "text" } = options;
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg("");
    setContent("");

    async function load() {
      try {
        const data = await request.readTaskFile({
          scheduleId,
          taskId,
          filePath,
          encoding: encoding === "base64" ? "base64" : undefined,
        });
        if (!active) return;
        setContent(data ?? "");
      } catch {
        if (active) setErrorMsg(t("fileDetail.errorLoading", "Failed to load file"));
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [scheduleId, taskId, filePath, encoding, t]);

  const arrayBuffer = useMemo(
    () => (encoding === "base64" ? base64ToArrayBuffer(content) : new ArrayBuffer(0)),
    [content, encoding],
  );

  return { content, arrayBuffer, loading, errorMsg };
}
