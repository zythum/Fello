import { useEffect, useRef, useState, useCallback } from "react";
import { loadPresentation, renderSlideToElement } from "pptx-viewer";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PptxViewProps {
  data: ArrayBuffer;
  filename?: string;
}

export function PptxView({ data }: PptxViewProps) {
  const { t } = useTranslation();
  const [container, setContnet] = useState<HTMLDivElement | null>(null);
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const [slideCount, setSlideCount] = useState(0);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<Awaited<
    ReturnType<typeof loadPresentation>
  > | null>(null);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);

  useEffect(() => {
    if (!container || !wrapper || !presentation) return;

    container.innerHTML = "";

    const wrapperWidth = wrapper.clientWidth - 32;
    const renderWidth = Math.min(wrapperWidth, 960);
    const renderHeight = renderWidth / aspectRatio;

    renderSlideToElement(presentation, currentSlide, container, {
      width: renderWidth,
      height: renderHeight,
    });

    container.style.width = `${renderWidth}px`;
    container.style.height = `${renderHeight}px`;
  }, [container, wrapper, aspectRatio, presentation, currentSlide]);

  useEffect(() => {
    let cancelled = false;

    let currentPres: typeof presentation = null;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const pres = await loadPresentation(data);
        if (cancelled) {
          pres.cleanup();
          return;
        }
        setPresentation((currentPres = pres));
        const { width, height } = pres.slideSize;
        setAspectRatio(width / height);
        setSlideCount(pres.slides.length);
        setCurrentSlide(0);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load presentation");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      currentPres?.cleanup();
    };
  }, [data]);

  const goToPrev = useCallback(() => {
    const next = Math.max(0, currentSlide - 1);
    setCurrentSlide(next);
  }, [currentSlide]);

  const goToNext = useCallback(() => {
    const next = Math.min(slideCount - 1, currentSlide + 1);
    setCurrentSlide(next);
  }, [currentSlide, slideCount]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {t("fileDetail.loadError", "Failed to load presentation")}: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full h-full min-h-0">
      {slideCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 shrink-0 border-b border-border w-full bg-background/80 backdrop-blur-sm">
          <button
            type="button"
            onClick={goToPrev}
            disabled={currentSlide <= 0}
            className="flex items-center justify-center size-7 rounded hover:bg-muted transition-colors disabled:opacity-30"
            title={t("fileDetail.previousSlide", "Previous slide")}
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-xs tabular-nums text-foreground">
            {currentSlide + 1} / {slideCount}
          </span>
          <button
            type="button"
            onClick={goToNext}
            disabled={currentSlide >= slideCount - 1}
            className="flex items-center justify-center size-7 rounded hover:bg-muted transition-colors disabled:opacity-30"
            title={t("fileDetail.nextSlide", "Next slide")}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
      <div
        ref={setWrapper}
        className="flex-1 overflow-auto w-full flex justify-center p-4 bg-[#80808020]"
      >
        {loading ? (
          <div className="text-sm text-muted-foreground mt-10">{t("fileDetail.loading")}</div>
        ) : (
          <div ref={setContnet} className="shadow-lg bg-white shrink-0" />
        )}
      </div>
    </div>
  );
}
