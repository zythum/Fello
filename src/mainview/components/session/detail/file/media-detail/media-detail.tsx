import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveFileUrl } from "@/lib/file-url";
import { FileIcon } from "../../../../common/file-icon";
import { parseFileReference } from "../../../../common/file-reference";
import { ErrorState } from "../common/loading-state";
import type { MediaKind } from "../../../../../../shared/constants";

interface MediaDetailProps {
  projectId: string;
  file: string;
  kind: MediaKind;
}

/**
 * 音频 / 视频预览。
 *
 * 与图片（base64 底座）不同，媒体直接把 `/project/...` 文件 URL 交给原生
 * `<audio>` / `<video>`：解码、播放、拖动进度条全由浏览器负责，主进程只按 Range
 * 回分片（见 `backend/serve-file.ts`），长视频不会整份读进内存。
 */
export function MediaDetail({ projectId, file, kind }: MediaDetailProps) {
  const { t } = useTranslation();
  // 记录「加载失败的是哪个 URL」而不是布尔值：切换文件时天然复位，不需要副作用
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const filePath = useMemo(() => parseFileReference(file).path, [file]);
  const url = useMemo(
    () => resolveFileUrl(`/project/${projectId}/${filePath}`),
    [projectId, filePath],
  );

  const handleError = useCallback(() => setFailedUrl(url), [url]);

  if (failedUrl === url) {
    return <ErrorState message={t("fileDetail.mediaPlaybackFailed", "Unable to play this file")} />;
  }

  if (kind === "video") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/20 p-2">
        <video
          key={url}
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={handleError}
          className="max-h-full max-w-full rounded"
        />
      </div>
    );
  }

  const name = filePath.split("/").pop() || filePath;

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon name={name} className="size-4 shrink-0" />
          <span className="truncate text-xs text-foreground/70" title={filePath}>
            {name}
          </span>
        </div>
        <audio
          key={url}
          src={url}
          controls
          preload="metadata"
          onError={handleError}
          className="w-full"
        />
      </div>
    </div>
  );
}
