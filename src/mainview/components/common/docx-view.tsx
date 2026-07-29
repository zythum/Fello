import { useEffect, useState } from "react";
import { DocxDocument } from "@silurus/ooxml/docx";
import { math } from "@silurus/ooxml/math";
import { useTranslation } from "react-i18next";
import { ZoomIn, ZoomOut } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface DocxViewProps {
  data: ArrayBuffer;
  filename?: string;
}

export function DocxView({ data }: DocxViewProps) {
  const { t } = useTranslation();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<DocxDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let instance: DocxDocument | null = null;

    async function load() {
      try {
        instance = await DocxDocument.load(data.slice(0), { math });
        if (cancelled) {
          instance.destroy();
          return;
        }
        setDoc(instance);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load document");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      instance?.destroy();
      setDoc(null);
    };
  }, [data]);

  useEffect(() => {
    if (!container || !doc) return;
    let cancelled = false;

    while (container.lastChild) container.lastChild.remove();

    async function renderAll() {
      // pageWidth is in points; convert to CSS px (96dpi): pt / 72 * 96 = pt * 4/3
      const pageWidthPx = doc!.document.section.pageWidth * (96 / 72);
      for (let i = 0; i < doc!.pageCount; i++) {
        if (cancelled) return;

        // Page wrapper
        const pageDiv = document.createElement("div");
        pageDiv.className = "shadow-lg bg-white mb-4 mx-auto relative";
        container!.appendChild(pageDiv);

        // Canvas
        const canvas = document.createElement("canvas");
        pageDiv.appendChild(canvas);

        // Text overlay
        const textLayer = document.createElement("div");
        textLayer.className = "absolute inset-0 overflow-hidden";
        textLayer.style.lineHeight = "1";
        pageDiv.appendChild(textLayer);

        await doc!.renderPage(canvas, i, {
          width: pageWidthPx * scale,
          onTextRun(run) {
            const span = document.createElement("span");
            span.textContent = run.text;
            span.style.cssText = `position:absolute;left:${run.x}px;top:${run.y}px;font-size:${run.fontSize}px;font-family:${run.font};color:transparent;white-space:pre;cursor:text;width:${run.w}px;height:${run.h}px;`;
            textLayer.appendChild(span);
          },
        });

        pageDiv.style.width = `${canvas.offsetWidth}px`;
        pageDiv.style.height = `${canvas.offsetHeight}px`;
      }
    }

    renderAll();
    return () => {
      cancelled = true;
      while (container.lastChild) container.lastChild.remove();
    };
  }, [container, doc, scale]);

  const zoomIn = () => setScale((s) => Math.min(3, s + 0.2));
  const zoomOut = () => setScale((s) => Math.max(0.5, s - 0.2));

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground mt-10 text-center">
        {t("fileDetail.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-muted-foreground mt-10 text-center">
        {t("fileDetail.loadError", "Failed to load document")}: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="flex items-center justify-end gap-3 px-4 py-2 h-10 shrink-0 border-b border-border w-full bg-background/80 backdrop-blur-sm">
        <button
          type="button"
          onClick={zoomOut}
          className="flex items-center justify-center size-7 rounded hover:bg-muted transition-colors"
          aria-label={t("fileDetail.zoomOut", "Zoom out")}
          title={t("fileDetail.zoomOut", "Zoom out")}
        >
          <ZoomOut className="size-4" />
        </button>
        <button
          type="button"
          onDoubleClick={() => setScale(1)}
          className="text-xs tabular-nums text-muted-foreground min-w-8 text-center hover:text-foreground transition-colors"
          aria-label={t("fileDetail.resetZoom", "Reset")}
          title={t("fileDetail.resetZoom", "Reset")}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          className="flex items-center justify-center size-7 rounded hover:bg-muted transition-colors"
          aria-label={t("fileDetail.zoomIn", "Zoom in")}
          title={t("fileDetail.zoomIn", "Zoom in")}
        >
          <ZoomIn className="size-4" />
        </button>
      </div>
      <ScrollArea className="flex-1 w-full min-h-0 bg-muted">
        <div className="p-4">
          <div ref={setContainer} />
        </div>
      </ScrollArea>
    </div>
  );
}
