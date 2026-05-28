import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../../../../backend";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const base64Data = base64.includes(",") ? base64.split(",")[1]! : base64;
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

interface UseFileOptions {
  encoding?: "text" | "base64";
  gitHead?: boolean;
}

interface UseFileResult {
  content: string;
  gitContent: string | null;
  arrayBuffer: ArrayBuffer;
  loading: boolean;
  errorMsg: string;
}

export function useFile(
  projectId: string,
  file: string,
  options: UseFileOptions = {},
): UseFileResult {
  const { encoding = "text", gitHead = false } = options;
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [gitContent, setGitContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg("");
    setContent("");
    setGitContent(null);

    async function load() {
      try {
        const info = await request.getFileInfo({ projectId, relativePath: file });
        if (!active) return;
        if (!info || !info.isFile) {
          setErrorMsg(t("fileDetail.fileNotFound"));
          return;
        }
        if (info.size > 10 * 1024 * 1024) {
          setErrorMsg(t("fileDetail.fileTooLarge"));
          return;
        }
        if (encoding === "text" && info.isBinary) {
          setErrorMsg(t("fileDetail.fileFormatNotSupported"));
          return;
        }

        const promises: Promise<unknown>[] = [
          request.readFile({
            projectId,
            relativePath: file,
            encoding: encoding === "base64" ? "base64" : undefined,
          }),
        ];
        if (gitHead) {
          promises.push(request.readGitHeadFile({ projectId, relativePath: file }));
        }
        // minimum loading time to avoid flash
        promises.push(new Promise((resolve) => setTimeout(resolve, 300)));

        const results = await Promise.all(promises);
        if (!active) return;
        setContent(results[0] as string);
        if (gitHead) setGitContent((results[1] as string) ?? null);
      } catch {
        if (active) setErrorMsg(t("fileDetail.errorLoading"));
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [projectId, file, encoding, gitHead, t]);

  const arrayBuffer = useMemo(
    () => (encoding === "base64" ? base64ToArrayBuffer(content) : new ArrayBuffer(0)),
    [content, encoding],
  );

  return { content, gitContent, arrayBuffer, loading, errorMsg };
}
