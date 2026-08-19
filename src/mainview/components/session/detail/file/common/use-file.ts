import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../../../../backend";
import { parseFileReference } from "../../../../common/file-reference";

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
  filePath: string;
  search: string;
  hash: string;
  /** 文件大小（字节），来自 getFileInfo；加载失败时为 0 */
  fileSize: number;
  /** 静默重新读取文件内容（保存成功后调用）：不显示 loading、不清空当前内容 */
  reload: () => void;
}

export function useFile(
  projectId: string,
  file: string,
  options: UseFileOptions = {},
): UseFileResult {
  const { encoding = "text", gitHead = false } = options;
  const { t } = useTranslation();
  const { path: filePath, search, hash } = useMemo(() => parseFileReference(file), [file]);
  const [content, setContent] = useState("");
  const [gitContent, setGitContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [fileSize, setFileSize] = useState(0);
  // 静默刷新标记：reload() 触发时跳过 loading/清空，避免保存后视图闪烁
  const silentRef = useRef(false);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    silentRef.current = true;
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) {
      setLoading(true);
      setErrorMsg("");
      setContent("");
      setGitContent(null);
      setFileSize(0);
    }

    async function load() {
      try {
        const info = await request.getFileInfo({ projectId, relativePath: filePath });
        if (!active) return;
        if (!info || !info.isFile) {
          setErrorMsg(t("fileDetail.fileNotFound"));
          return;
        }
        setFileSize(info.size);
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
            relativePath: filePath,
            encoding: encoding === "base64" ? "base64" : undefined,
          }),
        ];
        if (gitHead) {
          promises.push(request.readGitHeadFile({ projectId, relativePath: filePath }));
        }
        // 最小加载时长避免闪烁；静默刷新跳过
        if (!silent) {
          promises.push(new Promise((resolve) => setTimeout(resolve, 300)));
        }

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
  }, [projectId, filePath, encoding, gitHead, t, reloadToken]);

  const arrayBuffer = useMemo(
    () => (encoding === "base64" ? base64ToArrayBuffer(content) : new ArrayBuffer(0)),
    [content, encoding],
  );

  return {
    content,
    gitContent,
    arrayBuffer,
    loading,
    errorMsg,
    filePath,
    search,
    hash,
    fileSize,
    reload,
  };
}
