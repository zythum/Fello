import { useEffect, useState } from "react";
import { request } from "../backend";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { ScrollArea } from "./ui/scroll-area";
import { File, XIcon } from "lucide-react";
import { Button } from "./ui/button";
import { useTranslation } from "react-i18next";
import { CodeView } from "./common/code-view";
import { CodeCompareView } from "./common/code-compare-view";
import { StreamMarkdown } from "./common/stream-markdown";
import { ImageView } from "./common/image-view";

export interface FilePreviewSheetProps {
  projectId: string | null;
  relativePath: string | null;
  onClose: () => void;
  panelWidth: number;
}

type FileKind = "image" | "markdown" | "text";
type ViewMode = "preview" | "code" | "compare";

export function FilePreviewSheet({
  projectId,
  relativePath,
  onClose,
  panelWidth = 300,
}: FilePreviewSheetProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string>("");
  const [gitContent, setGitContent] = useState<string | null>(null);
  const [fileKind, setFileKind] = useState<FileKind | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("code");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [imageBase64, setImageBase64] = useState("");

  useEffect(() => {
    setFileKind(null);
    setViewMode("code");
  }, [relativePath]);

  useEffect(() => {
    if (!projectId || !relativePath) return;
    let active = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setImageBase64("");
      setContent("");
      setGitContent(null);
      setFileKind(null);
      setViewMode("code");
      try {
        const safeProjectId = projectId!;
        const safeRelativePath = relativePath!;
        const info = await request.getFileInfo({
          projectId: safeProjectId,
          relativePath: safeRelativePath,
        });
        if (!active) return;
        if (!info || !info.isFile) {
          setErrorMsg(t("filePreview.fileNotFound"));
          setLoading(false);
          return;
        }

        if (info.size > 10 * 1024 * 1024) {
          setErrorMsg(t("filePreview.fileTooLarge"));
          setLoading(false);
          return;
        }

        const ext = safeRelativePath.split(".").pop()?.toLowerCase() || "";
        const isMarkdown = ext === "md";
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"];

        if (imageExts.includes(ext)) {
          setFileKind("image");
          setViewMode("preview");
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

        if (info.isBinary) {
          setErrorMsg(t("filePreview.fileFormatNotSupported"));
          setLoading(false);
          return;
        }

        const [current, git] = await Promise.all([
          request.readFile({ projectId: safeProjectId, relativePath: safeRelativePath }),
          request.readGitHeadFile({ projectId: safeProjectId, relativePath: safeRelativePath }),
        ]);
        if (!active) return;
        setFileKind(isMarkdown ? "markdown" : "text");
        setViewMode(isMarkdown ? "preview" : "code");
        setContent(current);
        setGitContent(git);
      } catch (e) {
        if (!active) return;
        console.error(e);
        setErrorMsg(t("filePreview.errorLoading"));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [projectId, relativePath]);

  const fileName = relativePath?.split("/").pop() ?? "";
  const canCompare = gitContent != null;
  const showTabs = !loading && !errorMsg && fileKind !== null && fileKind !== "image";

  return (
    <Sheet
      open={!!relativePath}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      modal={false}
      disablePointerDismissal={true}
    >
      <SheetContent
        side="left"
        className="p-0 flex flex-col gap-0"
        style={{ width: panelWidth ? `calc(100vw - ${panelWidth}px)` : "90%", maxWidth: "none" }}
        showCloseButton={false}
        showOverlay={false}
      >
        <SheetHeader className="h-12 border-b flex flex-row items-center justify-between px-4 py-0">
          <SheetTitle
            className="text-sm truncate leading-normal flex items-center gap-1.5 flex-1 mr-4"
            title={relativePath || ""}
          >
            <File className="size-3.5 shrink-0 text-muted-foreground/90" />
            {fileName}
          </SheetTitle>
          <div className="flex items-center gap-1">
            {showTabs && (
              <Tabs
                value={viewMode}
                onValueChange={(v) => setViewMode(v as ViewMode)}
                className="h-8"
              >
                <TabsList className="h-8">
                  {fileKind === "markdown" && (
                    <TabsTrigger value="preview" className="text-[12px]">
                      {t("filePreview.preview")}
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="code" className="text-[12px]">
                    {t("filePreview.code")}
                  </TabsTrigger>
                  <TabsTrigger value="compare" disabled={!canCompare} className="text-[12px]">
                    {t("filePreview.compare")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="h-8 w-8 shrink-0 -mr-3"
            >
              <XIcon className="size-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1 w-full h-0">
          {loading ? (
            <div className="text-muted-foreground text-center mt-10">
              {t("filePreview.loading")}
            </div>
          ) : errorMsg ? (
            <div className="text-muted-foreground text-center mt-10">{errorMsg}</div>
          ) : fileKind === "image" ? (
            <ImageView src={imageBase64} filename={fileName} />
          ) : viewMode === "compare" ? (
            <div className="min-h-full bg-[#ffffff] dark:bg-[#24292e] text-[12px] font-mono">
              <CodeCompareView
                oldContent={gitContent ?? ""}
                newContent={content}
                filename={fileName}
              />
            </div>
          ) : fileKind === "markdown" && viewMode === "preview" ? (
            <div className="prose prose-sm dark:prose-invert max-w-none p-6 min-h-full bg-background font-sans">
              <StreamMarkdown>{content}</StreamMarkdown>
            </div>
          ) : (
            <div className="min-h-full bg-[#ffffff] dark:bg-[#24292e] text-[12px] font-mono">
              <CodeView content={content} filename={fileName} />
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
