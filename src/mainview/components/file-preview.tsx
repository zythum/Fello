import { useEffect, useState } from "react";
import { request } from "../backend";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { codeToHtml } from "shiki";
import * as Diff from "diff";
import { ScrollArea } from "./ui/scroll-area";
import { File, XIcon } from "lucide-react";
import { Button } from "./ui/button";

interface FilePreviewProps {
  filePath: string | null;
  cwd: string | null;
  onClose: () => void;
  panelWidth?: number;
}

export function FilePreviewSheet({ filePath, cwd, onClose, panelWidth }: FilePreviewProps) {
  const [content, setContent] = useState<string>("");
  const [gitContent, setGitContent] = useState<string | null>(null);
  const [isDiffMode, setIsDiffMode] = useState(false);
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath || !cwd) return;
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const [current, git] = await Promise.all([
          request.readFile({ path: filePath! }),
          request.readGitHeadFile({ path: filePath! }),
        ]);
        if (!active) return;
        setContent(current);
        setGitContent(git || "");
      } catch (e) {
        if (!active) return;
        console.error(e);
        setContent("Error loading file");
        setGitContent("");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [filePath, cwd]);

  useEffect(() => {
    if (loading || !content) return;
    let active = true;

    async function renderCode() {
      const ext = filePath?.split(".").pop() || "text";
      let lang = ext;

      const langMap: Record<string, string> = {
        ts: "typescript",
        tsx: "tsx",
        js: "javascript",
        jsx: "jsx",
        json: "json",
        md: "markdown",
        css: "css",
        html: "html",
        rs: "rust",
        py: "python",
        go: "go",
      };
      lang = langMap[ext] || ext;

      try {
        let finalHtml = "";

        if (isDiffMode && gitContent !== null) {
          const patch = Diff.createTwoFilesPatch(
            filePath || "file",
            filePath || "file",
            gitContent,
            content,
            "HEAD",
            "Working Tree",
          );
          finalHtml = await codeToHtml(patch, {
            lang: "diff",
            themes: { light: "github-light", dark: "github-dark" },
          });
        } else {
          finalHtml = await codeToHtml(content, {
            lang,
            themes: { light: "github-light", dark: "github-dark" },
          });
        }

        if (active) setHtml(finalHtml);
      } catch (e) {
        console.error(e);
        if (active) {
          try {
            const fallback = await codeToHtml(content, {
              lang: "text",
              themes: { light: "github-light", dark: "github-dark" },
            });
            setHtml(fallback);
          } catch {
            setHtml(
              `<pre><code>${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`,
            );
          }
        }
      }
    }
    renderCode();
    return () => {
      active = false;
    };
  }, [content, gitContent, isDiffMode, filePath, loading]);

  const fileName = filePath ? filePath.split("/").pop() : "";

  return (
    <Sheet
      open={!!filePath}
      onOpenChange={(open, detail) => {
        !open && onClose()
      }}
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
            title={filePath || ""}
          >
            <File className="size-3.5 shrink-0 text-muted-foreground/75" />
            {fileName}
          </SheetTitle>
          <div className="flex items-center gap-1">
            <Tabs
              value={isDiffMode ? "diff" : "preview"}
              onValueChange={(v) => setIsDiffMode(v === "diff")}
              className="h-8"
            >
              <TabsList className="h-8">
                <TabsTrigger value="preview" className="text-[12px]">
                  Preview
                </TabsTrigger>
                <TabsTrigger value="diff" disabled={gitContent === ""} className="text-[12px]">
                  Compare
                </TabsTrigger>
              </TabsList>
            </Tabs>
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
        <ScrollArea className="flex-1 w-full h-0 text-[12px] font-mono bg-[#ffffff] dark:bg-[#24292e]">
          {loading ? (
            <div className="text-muted-foreground text-center mt-10">Loading...</div>
          ) : (
            <div
              dangerouslySetInnerHTML={{ __html: html }}
              className="[&_pre]:bg-transparent [&_pre]:p-4 [&_pre]:m-0 [&_code]:block [&_code]:w-max [&_code]:[counter-reset:step] [&_code]:[counter-increment:step_0] [&_.line::before]:content-[counter(step)] [&_.line::before]:[counter-increment:step] [&_.line::before]:w-6 [&_.line::before]:mr-4 [&_.line::before]:inline-block [&_.line::before]:text-right [&_.line::before]:text-muted-foreground/40 [&_.line::before]:select-none"
            />
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
