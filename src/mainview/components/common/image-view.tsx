import { useCallback, useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent, useControls } from "react-zoom-pan-pinch";
import { ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

function Controls({ scale }: { scale: number }) {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-end gap-3 px-4 py-2 h-10 shrink-0 border-b border-border w-full bg-background/80 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => zoomOut()}
        className="flex items-center justify-center size-7 rounded hover:bg-muted transition-colors"
        aria-label={t("fileDetail.zoomOut", "Zoom out")}
        title={t("fileDetail.zoomOut", "Zoom out")}
      >
        <ZoomOut className="size-4" />
      </button>
      <button
        type="button"
        onDoubleClick={() => resetTransform()}
        className="text-xs tabular-nums text-muted-foreground min-w-8 text-center hover:text-foreground transition-colors"
        aria-label={t("fileDetail.resetZoom", "Reset")}
        title={t("fileDetail.resetZoom", "Reset")}
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        onClick={() => zoomIn()}
        className="flex items-center justify-center size-7 rounded hover:bg-muted transition-colors"
        aria-label={t("fileDetail.zoomIn", "Zoom in")}
        title={t("fileDetail.zoomIn", "Zoom in")}
      >
        <ZoomIn className="size-4" />
      </button>
    </div>
  );
}

export interface ImageViewProps {
  src: string;
  alt?: string;
}

export function ImageView({ src, alt }: ImageViewProps) {
  const [scale, setScale] = useState(1);
  const [baseRatio, setBaseRatio] = useState(1);
  const imgRef = useRef<HTMLImageElement>(null);

  const recalcBaseRatio = useCallback(() => {
    const img = imgRef.current;
    if (img && img.naturalWidth > 0) {
      setBaseRatio(img.clientWidth / img.naturalWidth);
    }
  }, []);

  useEffect(() => {
    setScale(1);
    setBaseRatio(1);
  }, [src]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(recalcBaseRatio);
    ro.observe(img);
    return () => ro.disconnect();
  }, [recalcBaseRatio]);

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <TransformWrapper
        initialScale={1}
        minScale={0.1}
        maxScale={10}
        centerOnInit
        wheel={{ step: 0.002 }}
        onTransform={(_ref, state) => setScale(state.scale)}
      >
        <Controls scale={scale * baseRatio} />
        <TransformComponent
          wrapperClass="flex-1 min-h-0"
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            ref={imgRef}
            src={src}
            alt={alt ?? ""}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
            onLoad={recalcBaseRatio}
          />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
