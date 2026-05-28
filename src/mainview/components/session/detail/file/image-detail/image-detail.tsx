import { TransformWrapper, TransformComponent, useControls } from "react-zoom-pan-pinch";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { LoadingState, ErrorState } from "../common/loading-state";
import { useFile } from "../common/use-file";

interface ImageDetailProps {
  projectId: string;
  file: string;
}

function Controls() {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-popover/90 backdrop-blur border border-border rounded-lg shadow-lg px-2 py-1.5">
      <button
        type="button"
        onClick={() => zoomOut()}
        className="flex size-7 items-center justify-center rounded hover:bg-muted transition-colors"
        aria-label="Zoom out"
      >
        <ZoomOut className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => resetTransform()}
        className="flex size-7 items-center justify-center rounded hover:bg-muted transition-colors"
        aria-label="Reset"
      >
        <RotateCcw className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => zoomIn()}
        className="flex size-7 items-center justify-center rounded hover:bg-muted transition-colors"
        aria-label="Zoom in"
      >
        <ZoomIn className="size-4" />
      </button>
    </div>
  );
}

export function ImageDetail({ projectId, file }: ImageDetailProps) {
  const { content, loading, errorMsg } = useFile(projectId, file, { encoding: "base64" });

  if (loading) return <LoadingState />;
  if (errorMsg) return <ErrorState message={errorMsg} />;

  const ext = file.split(".").pop()?.toLowerCase() || "";
  let mimeType = ext;
  if (ext === "svg") mimeType = "svg+xml";
  else if (ext === "jpg") mimeType = "jpeg";
  const src = `data:image/${mimeType};base64,${content}`;

  return (
    <div className="relative h-full w-full">
      <TransformWrapper
        initialScale={1}
        minScale={0.1}
        maxScale={10}
        centerOnInit
        wheel={{ step: 0.002 }}
      >
        <Controls />
        <TransformComponent
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
            src={src}
            alt={file}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
          />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
