import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Search, Copy, Download, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getBasename, formatBytes, downloadDataUrl, isSubPath } from "../../lib/utils";
import { request, isWebUI } from "../../backend";
import { electron } from "../../electron";
import { toast } from "sonner";
import { SessionInfo } from "../../../shared/schema";
import type { ResourceLink } from "@agentclientprotocol/sdk";

interface ResourceLinkBlockProps {
  block: ResourceLink;
  session?: SessionInfo;
  isStreaming?: boolean;
}

export const ResourceLinkBlock = memo(function ResourceLinkBlock({
  block,
  session,
  isStreaming: _isStreaming,
}: ResourceLinkBlockProps) {
  const { t } = useTranslation();
  const uri = block.uri;
  const name = block.name;
  const mimeType = block.mimeType ?? undefined;
  const title = block.title;
  const description = block.description;
  const size = block.size;
  const projectId = session?.projectId;
  const sessionCwd = session?.cwd;

  const isHttp = uri.startsWith("http://") || uri.startsWith("https://");
  const isFile = uri.startsWith("file://");

  const handleOpenHttp = useCallback(() => {
    if (isWebUI) {
      window.open(uri, "_blank", "noopener,noreferrer");
    } else {
      electron.openInBrowser(uri);
    }
  }, [uri]);

  const handleReveal = useCallback(() => {
    if (!isWebUI) {
      const path = decodeURIComponent(uri.slice(7));
      electron.revealInFinder(path);
    }
  }, [uri]);

  const handleDownload = useCallback(async () => {
    if (isWebUI) {
      try {
        const dataUrl = await request.readUrlAsDataUrl({ url: uri, mimeType });
        downloadDataUrl(dataUrl, name || getBasename(uri));
      } catch (err) {
        const msg = (err as Error).message || String(err);
        if (msg.includes("exceeds 20MB")) {
          toast.error(t("contentBlock.fileTooLarge", "File is too large (exceeds 20MB)"));
        } else {
          console.error("Failed to download resource link", err);
        }
      }
    }
  }, [uri, mimeType, name, t]);

  const handleCopyToWorkspace = useCallback(async () => {
    if (projectId && sessionCwd && !isWebUI) {
      const path = decodeURIComponent(uri.slice(7));
      try {
        const res = await request.copyFileToWorkspace({
          projectId,
          sourcePath: path,
          destDir: sessionCwd,
        });
        if (res.success) {
          toast.success(t("contentBlock.copySuccess", "Copied to workspace"));
        }
      } catch (err) {
        console.error("Failed to copy file", err);
      }
    }
  }, [uri, projectId, sessionCwd, t]);

  const path = isFile ? decodeURIComponent(uri.slice(7)) : null;
  const showCopyToWorkspace =
    !isWebUI && isFile && sessionCwd && path && !isSubPath(sessionCwd, path);

  return (
    <Card className="flex flex-col gap-2 p-3 hover:bg-muted/30 transition-colors shadow-none">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-sm bg-primary/10 p-1.5 shrink-0 text-primary">
          <Link2 className="h-4 w-4" />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-xs font-medium truncate" title={title || name}>
            {title || name}
          </span>
          {(description || mimeType || size != null) && (
            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground truncate">
              {mimeType && <span className="truncate">{mimeType}</span>}
              {size != null && <span className="shrink-0">{formatBytes(size)}</span>}
              {description && <span className="truncate opacity-75">{description}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 mt-1 border-t border-border pt-2">
        {isHttp && (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={handleOpenHttp}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            {t("contentBlock.openLink", "Open Link")}
          </Button>
        )}

        {isFile && isWebUI && (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={handleDownload}
          >
            <Download className="h-3 w-3 mr-1" />
            {t("contentBlock.download", "Download")}
          </Button>
        )}

        {isFile && !isWebUI && (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={handleReveal}
          >
            <Search className="h-3 w-3 mr-1" />
            {t("contentBlock.revealInFinder", "Reveal in Finder")}
          </Button>
        )}

        {showCopyToWorkspace && (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={handleCopyToWorkspace}
          >
            <Copy className="h-3 w-3 mr-1" />
            {t("contentBlock.copyToWorkspace", "Copy to Workspace")}
          </Button>
        )}
      </div>
    </Card>
  );
});
