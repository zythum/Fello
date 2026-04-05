import { useEffect, useState } from "react";
import { request } from "../backend";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { codeToHtml } from "shiki";
import * as Diff from "diff";
import { ScrollArea } from "./ui/scroll-area";
import { File } from "lucide-react";

interface FilePreviewProps {
  filePath: string | null;
  cwd: string | null;
  onClose: () => void;
}

export function FilePreviewSheet({ filePath, cwd, onClose }: FilePreviewProps) {
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
          request.readFile(filePath!),
          request.getGitFileContent({ cwd: cwd!, path: filePath! }),
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
    <Sheet open={!!filePath} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="left" className="p-0 flex flex-col" style={{ width: '90%', maxWidth: 'none' }}>
        <SheetHeader className="h-12 px-4 border-b flex flex-row items-center justify-between space-y-0 shrink-0 bg-sidebar/50 pr-12">
          <SheetTitle
            className="text-sm font-medium truncate pr-4 flex items-center gap-1.5"
            title={filePath || ""}
          >
            <File className="size-4 shrink-0 text-muted-foreground/60" />
            {fileName}
          </SheetTitle>
          <div className="flex items-center">
            <Tabs
              value={isDiffMode ? "diff" : "preview"}
              onValueChange={(v) => setIsDiffMode(v === "diff")}
              className="h-8"
            >
              <TabsList className="h-8">
                <TabsTrigger value="preview" className="text-xs">
                  Preview
                </TabsTrigger>
                <TabsTrigger value="diff" disabled={gitContent === ""} className="text-xs">
                  Diff
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1 w-full h-0 text-[13px] font-mono">
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
