import { useEffect, useRef } from "react";
import { renderAsync } from "docx-preview";
import { useTranslation } from "react-i18next";

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
    <div className="w-full h-full overflow-auto bg-white dark:bg-[#1e1e1e]">
      <div
        ref={containerRef}
        className="docx-preview-wrapper min-h-full w-max"
        style={{ padding: "20px 40px" }}
      />
    </div>
  );
}
