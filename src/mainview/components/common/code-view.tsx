import { useEffect, useState, memo } from "react";
import { useTheme } from "next-themes";
import {
  getShikiHighlighter,
  getShikiLanguageFromFilename,
  getShikiTheme,
} from "./shiki-highlighter";

export interface CodeViewProps {
  content: string;
  filename?: string;
}

export const CodeView = memo(function CodeView({ content, filename }: CodeViewProps) {
  const { resolvedTheme } = useTheme();
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function renderCode() {
      setLoading(true);
      try {
        const hl = await getShikiHighlighter();
        if (!active) return;

        const lang = getShikiLanguageFromFilename(filename);
        const theme = getShikiTheme(resolvedTheme);

        try {
          const finalHtml = hl.codeToHtml(content, {
            lang,
            theme,
          });

          if (active) setHtml(finalHtml);
        } catch (e) {
          console.error(e);
          if (active) {
            try {
              const fallback = hl.codeToHtml(content, {
                lang: "text",
                theme,
              });
              setHtml(fallback);
            } catch {
              setHtml(
                `<pre><code>${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`,
              );
            }
          }
        }
      } catch (e) {
        console.error(e);
        if (!active) return;
        setHtml(`<pre><code>${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
      } finally {
        if (active) setLoading(false);
      }
    }

    renderCode();
    return () => {
      active = false;
    };
  }, [content, filename, resolvedTheme]);

  if (loading) {
    return null;
  }

  return (
    <div
      dangerouslySetInnerHTML={{ __html: html }}
      className="[&_pre]:bg-transparent [&_pre]:p-4 [&_pre]:m-0 [&_code]:block [&_code]:w-max [&_code]:[counter-reset:step] [&_code]:[counter-increment:step_0] [&_.line::before]:content-[counter(step)] [&_.line::before]:[counter-increment:step] [&_.line::before]:w-6 [&_.line::before]:mr-4 [&_.line::before]:inline-block [&_.line::before]:text-right [&_.line::before]:text-muted-foreground/60 [&_.line::before]:select-none"
    />
  );
});
