import { useEffect, useState } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/legacy/web/pdf_viewer.css";
import PdfWorkerConstructor from "./pdf-worker-wrapper?worker";
import { useTranslation } from "react-i18next";
import { ZoomIn, ZoomOut } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface PdfViewProps {
  data: ArrayBuffer;
  filename?: string;
}

let pdfWorker: pdfjs.PDFWorker | null = null;

async function getPdfWorker(): Promise<pdfjs.PDFWorker> {
  if (!pdfWorker || pdfWorker.destroyed) {
    const rawWorker = new PdfWorkerConstructor();
    pdfWorker = pdfjs.PDFWorker.create({ port: rawWorker });
    await pdfWorker.promise;
  }
  return pdfWorker;
}

export function PdfView({ data }: PdfViewProps) {
  const { t } = useTranslation();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    let instance: pdfjs.PDFDocumentProxy | null = null;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const pdfData = new Uint8Array(data.slice(0));
        const worker = await getPdfWorker();
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data: pdfData, worker }).promise;
        if (cancelled) {
          pdf.cleanup();
          return;
        }
        instance = pdf;
        setPdfDoc(pdf);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      instance?.cleanup();
      setPdfDoc(null);
    };
  }, [data]);

  useEffect(() => {
    if (!pdfDoc || !container) return;
    let cancelled = false;
    const pdf = pdfDoc;
    while (container.lastChild) container.lastChild.remove();

    async function renderAll(container: HTMLDivElement) {
      const dpr = window.devicePixelRatio || 1;
      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) return;
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: scale * (96 / 72) });

        // Page wrapper (relative positioning for text layer overlay)
        const pageDiv = document.createElement("div");
        pageDiv.className = "shadow-lg bg-white mb-4 mx-auto relative";
        pageDiv.style.width = `${viewport.width}px`;
        pageDiv.style.height = `${viewport.height}px`;
        container.appendChild(pageDiv);

        // Canvas
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        pageDiv.appendChild(canvas);
        const ctx = canvas.getContext("2d")!;
        ctx.scale(dpr, dpr);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;

        // Text layer
        if (cancelled) return;
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const textDiv = document.createElement("div");
        textDiv.className = "absolute inset-0 textLayer";
        pageDiv.appendChild(textDiv);

        pdfjs.setLayerDimensions(textDiv, viewport);
        textDiv.style.setProperty("--total-scale-factor", `${viewport.scale}`);

        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport,
        });
        await textLayer.render();
      }
    }

    renderAll(container);
    return () => {
      cancelled = true;
      while (container.lastChild) container.lastChild.remove();
    };
  }, [pdfDoc, scale, container]);

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
        {t("fileDetail.loadError", "Failed to load PDF")}: {error}
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
      <ScrollArea className="flex-1 w-full min-h-0 overflow-hidden bg-muted">
        <div className="p-4">
          <div ref={setContainer} />
        </div>
      </ScrollArea>
    </div>
  );
}
