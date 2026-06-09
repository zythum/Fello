import { useMemo } from "react";

interface HtmlDetailProps {
  fileName: string;
  content: string;
}

export function HtmlDetail({ content }: HtmlDetailProps) {
  const srcDoc = useMemo(() => {
    // Wrap in minimal HTML if it's a fragment
    if (
      content.trim().startsWith("<") &&
      !content.toLowerCase().includes("<!doctype") &&
      !content.toLowerCase().includes("<html")
    ) {
      return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`;
    }
    return content;
  }, [content]);

  return (
    <iframe
      srcDoc={srcDoc}
      className="w-full h-full border-0 bg-white"
      title="HTML Preview"
      sandbox="allow-scripts"
    />
  );
}
