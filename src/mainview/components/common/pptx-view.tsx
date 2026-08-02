import { useEffect, useRef, useState } from "react";
import { PptxPresentation } from "@silurus/ooxml/pptx";
import { math } from "@silurus/ooxml/math";
import { useTranslation } from "react-i18next";
import { MessageSquareText, ZoomIn, ZoomOut } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface PptxViewProps {
  data: ArrayBuffer;
  filename?: string;
}

const BASE_SLIDE_WIDTH = 960;

function PptxSlide({
  pres,
  index,
  scale,
}: {
  pres: PptxPresentation;
  index: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const notes = pres.getNotes(index);

  // Deterministic slide CSS size, mirroring renderSlide's internal math:
  // the canvas is drawn at BASE_SLIDE_WIDTH * scale CSS px wide, with the
  // height following the slide aspect ratio. Sizing the wrapper synchronously
  // (instead of after the async render) guarantees the note overlay's
  // `inset-0` always covers the whole slide.
  const cssWidth = Math.round(BASE_SLIDE_WIDTH * scale);
  const aspect = pres.slideWidth > 0 ? pres.slideHeight / pres.slideWidth : 9 / 16;
  const cssHeight = Math.round(BASE_SLIDE_WIDTH * scale * aspect);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    if (!canvas || !textLayer) return;

    textLayer.innerHTML = "";

    pres
      .renderSlide(canvas, index, {
        width: BASE_SLIDE_WIDTH * scale,
        onTextRun(run) {
          const span = document.createElement("span");
          span.textContent = run.text;
          span.style.cssText = `position:absolute;left:${run.shapeX + run.inShapeX}px;top:${run.shapeY + run.inShapeY}px;font-size:${run.fontSize}px;font-family:${run.font};color:transparent;white-space:pre;cursor:text;width:${run.w}px;height:${run.h}px;`;
          textLayer.appendChild(span);
        },
      })
      .catch(() => {
        // Render failures (e.g. after unmount) should not break the UI.
      });

    return () => {
      textLayer.innerHTML = "";
    };
  }, [pres, index, scale]);

  return (
    <div
      className="shadow-lg bg-white mb-4 mx-auto relative"
      style={{ width: cssWidth, height: cssHeight }}
    >
      <canvas ref={canvasRef} />
      <div
        ref={textLayerRef}
        className="absolute inset-0 overflow-hidden"
        style={{ lineHeight: 1 }}
      />
      {notes && (
        <button
          type="button"
          onClick={() => setNoteOpen((o) => !o)}
          className={`absolute right-1 top-1 z-20 flex size-6 items-center justify-center rounded border border-border transition-colors hover:bg-background hover:text-foreground ${
            noteOpen ? "bg-background text-foreground" : "bg-muted text-muted-foreground"
          }`}
          aria-label={t("fileDetail.speakerNotes", "Notes")}
          title={t("fileDetail.speakerNotes", "Notes")}
          aria-pressed={noteOpen}
        >
          <MessageSquareText className="size-3" />
        </button>
      )}
      {notes && noteOpen && (
        <div className="absolute inset-0 z-10 flex flex-col overflow-hidden">
          <div className="flex h-8 items-center px-3 opacity-95 bg-background text-foreground">
            <span className="text-xs scale-95 text-muted-foreground mr-px">#</span>
            <span className="text-xs font-medium italic">{index + 1}</span>
            <div className="flex-1" />
          </div>
          <ScrollArea className="min-h-0 w-full flex-1 bg-background text-foreground opacity-90">
            <div className="whitespace-pre-wrap px-4 py-3 text-xs leading-relaxed">{notes}</div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

export function PptxView({ data }: PptxViewProps) {
  const { t } = useTranslation();
  const [pres, setPres] = useState<PptxPresentation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let instance: PptxPresentation | null = null;

    async function load() {
      try {
        instance = await PptxPresentation.load(data.slice(0), {
          useGoogleFonts: true,
          math,
        });
        if (cancelled) {
          instance.destroy();
          return;
        }
        setPres(instance);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load presentation");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      instance?.destroy();
      setPres(null);
    };
  }, [data]);

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
        {t("fileDetail.loadError", "Failed to load presentation")}: {error}
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
          {pres &&
            Array.from({ length: pres.slideCount }, (_, i) => (
              <PptxSlide key={i} pres={pres} index={i} scale={scale} />
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
