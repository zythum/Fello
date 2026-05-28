import { useEffect, useRef } from "react";
import { renderAsync } from "docx-preview";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "../ui/scroll-area";

export interface DocxViewProps {
  data: ArrayBuffer;
  filename?: string;
}

export function DocxView({ data }: DocxViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    (async () => {
      try {
        await renderAsync(data, container, undefined, {
          className: "docx-preview",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: true,
        });
      } catch (err) {
        if (!cancelled) {
          console.error("DOCX render error:", err);
          container.innerHTML = `<div class="text-sm text-muted-foreground text-center mt-10">${t("fileDetail.loadError", "Failed to load document")}</div>`;
        }
      }
    })();

    return () => {
      cancelled = true;
      if (container) container.innerHTML = "";
    };
  }, [data, t]);

  return (
    <ScrollArea className="w-full h-full bg-muted">
      <style>{`.docx-preview-wrapper { background: var(--muted)!important; padding: 16px!important; }`}</style>
      <div
        ref={containerRef}
        className="min-h-full min-w-full w-max p-0"
        style={{ padding: "0" }}
      />
    </ScrollArea>
  );
}
