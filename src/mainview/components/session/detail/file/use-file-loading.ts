import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../../../backend";
import type { FileKind, ViewMode } from "./file-types";
import { FILE_MODES_MAP, IMAGE_EXTENSIONS, OFFICE_EXTENSIONS } from "./file-types";

export interface FileLoadingResult {
  content: string;
  gitContent: string | null;
  fileKind: FileKind | null;
  viewMode: ViewMode;
  viewModes: ViewMode[];
  loading: boolean;
  errorMsg: string;
  imageBase64: string;
  setViewMode: (mode: ViewMode) => void;
}

/** 将 Base64 字符串解码为 ArrayBuffer */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

export function useFileLoading(projectId: string | null, file: string | null): FileLoadingResult {
  const { t } = useTranslation();

  const [content, setContent] = useState<string>("");
  const [gitContent, setGitContent] = useState<string | null>(null);
  const [fileKind, setFileKind] = useState<FileKind | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(FILE_MODES_MAP["text"][0]);
  const [viewModes, setViewModes] = useState<ViewMode[]>(FILE_MODES_MAP["text"]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [imageBase64, setImageBase64] = useState("");

  // Synchronously reset view mode when file changes (before async load completes)
  useEffect(() => {
    setFileKind(null);
    setViewMode(FILE_MODES_MAP["text"][0]);
  }, [projectId, file]);

  // Main file loading logic
  useEffect(() => {
    if (!projectId || !file) return;
    const safeProjectId: string = projectId;
    const safeRelativePath: string = file;
    let active = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setImageBase64("");
      setContent("");
      setGitContent(null);
      setFileKind(null);
      setViewMode(FILE_MODES_MAP["text"][0]);

      try {
        const info = await request.getFileInfo({
          projectId: safeProjectId,
          relativePath: safeRelativePath,
        });
        if (!active) return;

        if (!info || !info.isFile) {
          setErrorMsg(t("fileDetail.fileNotFound"));
          setLoading(false);
          return;
        }

        if (info.size > 10 * 1024 * 1024) {
          setErrorMsg(t("fileDetail.fileTooLarge"));
          setLoading(false);
          return;
        }

        const ext = safeRelativePath.split(".").pop()?.toLowerCase() || "";

        // Image files
        if (IMAGE_EXTENSIONS.includes(ext)) {
          setFileKind("image");
          setViewModes(FILE_MODES_MAP["image"]);
          setViewMode(FILE_MODES_MAP["image"][0]);
          const base64 = await request.readFile({
            projectId: safeProjectId,
            relativePath: safeRelativePath,
            encoding: "base64",
          });
          if (!active) return;
          let mimeType = ext;
          if (ext === "svg") mimeType = "svg+xml";
          else if (ext === "jpg") mimeType = "jpeg";
          setImageBase64(`data:image/${mimeType};base64,${base64}`);
          setLoading(false);
          return;
        }

        // Office documents (binary but previewable)
        const officeKind = OFFICE_EXTENSIONS[ext];
        if (officeKind) {
          setFileKind(officeKind);
          setViewModes(FILE_MODES_MAP[officeKind]);
          setViewMode(FILE_MODES_MAP[officeKind][0]);
          const base64 = await request.readFile({
            projectId: safeProjectId,
            relativePath: safeRelativePath,
            encoding: "base64",
          });
          if (!active) return;
          setImageBase64(base64);
          setLoading(false);
          return;
        }

        // Unsupported binary format
        if (info.isBinary) {
          setErrorMsg(t("fileDetail.fileFormatNotSupported"));
          setLoading(false);
          return;
        }

        // Text files (code / markdown)
        const [current, git] = await Promise.all([
          request.readFile({ projectId: safeProjectId, relativePath: safeRelativePath }),
          request.readGitHeadFile({ projectId: safeProjectId, relativePath: safeRelativePath }),
          new Promise((resolve) => setTimeout(resolve, 300)),
        ]);
        if (!active) return;

        const isMarkdown = ext === "md";
        const kind: FileKind = isMarkdown ? "markdown" : "text";
        setFileKind(kind);
        setViewModes(FILE_MODES_MAP[kind]);
        setViewMode(FILE_MODES_MAP[kind][0]);
        setContent(current);
        setGitContent(git);
      } catch (e) {
        if (!active) return;
        console.error(e);
        setErrorMsg(t("fileDetail.errorLoading"));
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
    // Note: t is stable (from i18next), can be safely excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, file]);

  return {
    content,
    gitContent,
    fileKind,
    viewMode,
    viewModes,
    loading,
    errorMsg,
    imageBase64,
    setViewMode,
  };
}
