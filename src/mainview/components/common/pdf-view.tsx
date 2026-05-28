import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import PdfWorkerConstructor from "./pdf-worker-wrapper?worker";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface PdfViewProps {
  data: ArrayBuffer;
  filename?: string;
}

let pdfWorker: pdfjs.PDFWorker | null = null;

async function getPdfWorker(): Promise<pdfjs.PDFWorker> {
  if (!pdfWorker || pdfWorker.destroyed) {
    // 用 Vite 打包的 Worker + PDFWorker 封装
    const rawWorker = new PdfWorkerConstructor();
    pdfWorker = pdfjs.PDFWorker.create({ port: rawWorker });
    // 等待 worker 初始化完成
    await pdfWorker.promise;
  }
  return pdfWorker;
}

export function PdfView({ data }: PdfViewProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);

  const renderPage = useCallback(async (pdf: pdfjs.PDFDocumentProxy, num: number, s: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const page = await pdf.getPage(num);
      const viewport = page.getViewport({ scale: s });
      const dpr = window.devicePixelRatio || 1;

      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      setCanvasSize({ w: viewport.width, h: viewport.height });

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    } catch (err) {
      console.error("PDF render error:", err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // 复制一份数据，避免原 ArrayBuffer 被 transfer 后 detached
        const pdfData = new Uint8Array(data.slice(0));
        const worker = await getPdfWorker();
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data: pdfData, worker }).promise;
        if (cancelled) return;
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        setPageNum(1);
        // Don't render here — the <canvas> is not yet in the DOM
        // (loading is still true). The render effect below will
        // trigger once loading becomes false and the canvas appears.
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load PDF");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [data]);

  // Render when: loading completes (canvas appears), page changes, or zoom changes
  useEffect(() => {
    if (!loading && pdfDoc) {
      renderPage(pdfDoc, pageNum, scale);
    }
  }, [pdfDoc, loading, pageNum, scale]);

  const goToPrev = () => setPageNum((p) => Math.max(1, p - 1));
  const goToNext = () => setPageNum((p) => Math.min(numPages, p + 1));
  const zoomIn = () => setScale((s) => Math.min(3, s + 0.2));
  const zoomOut = () => setScale((s) => Math.max(0.5, s - 0.2));

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {t("fileDetail.loadError", "Failed to load PDF")}: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full h-full min-h-0">
      {numPages > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 h-10 shrink-0 border-b border-border w-full bg-background/80 backdrop-blur-sm">
          <button
            type="button"
            onClick={zoomOut}
            className="flex items-center justify-center size-7 rounded hover:bg-muted transition-colors"
            title={t("fileDetail.zoomOut", "Zoom out")}
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="text-xs tabular-nums text-muted-foreground min-w-8 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={zoomIn}
            className="flex items-center justify-center size-7 rounded hover:bg-muted transition-colors"
            title={t("fileDetail.zoomIn", "Zoom in")}
          >
            <ZoomIn className="size-4" />
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            type="button"
            onClick={goToPrev}
            disabled={pageNum <= 1}
            className="flex items-center justify-center size-7 rounded hover:bg-muted transition-colors disabled:opacity-30"
            title={t("fileDetail.previousPage", "Previous page")}
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-xs tabular-nums text-foreground">
            {pageNum} / {numPages}
          </span>
          <button
            type="button"
            onClick={goToNext}
            disabled={pageNum >= numPages}
            className="flex items-center justify-center size-7 rounded hover:bg-muted transition-colors disabled:opacity-30"
            title={t("fileDetail.nextPage", "Next page")}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
      <ScrollArea className="flex-1 w-full min-h-0 overflow-hidden bg-muted">
        <div className="p-4">
          {loading ? (
            <div className="text-sm text-muted-foreground mt-10">{t("fileDetail.loading")}</div>
          ) : (
            <canvas
              ref={canvasRef}
              className="shadow-lg bg-white m-auto"
              style={canvasSize ? { width: canvasSize.w, height: canvasSize.h } : undefined}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
