import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare, ArrowLeft } from "lucide-react";
import { ParticleBackground } from "./particle-background";
import "./welcome.css";

function AnimatedTitle({ text }: { text: string }) {
  return (
    <h1 className="text-2xl font-semibold tracking-tight">
      {text.split("").map((char, i) => (
        <span
          key={i}
          className="inline-block animate-char-bounce"
          style={{
            animationDelay: `${i * 0.04}s`,
            animationFillMode: "both",
          }}
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </h1>
  );
}

export function Welcome() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = (e.clientX - rect.left) / rect.width - 0.5;
    const cy = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: cy * -20, y: cx * 20 });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTilt({ x: 0, y: 0 });
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex flex-1 flex-col items-center justify-center gap-8 px-8 relative h-full overflow-hidden cursor-default"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* macOS traffic light drag region */}
      <div
        className="absolute left-0 top-0 right-0 h-12 z-10"
        style={{ WebkitAppRegion: "drag" }}
      />

      {/* Particle network background + mouse ripples */}
      <ParticleBackground />

      {/* Icon with 3D tilt & multi-layer glow */}
      <div className="relative z-10 pointer-events-none" style={{ perspective: "400px" }}>
        {/* Outer glow rings */}
        <div className="absolute inset-0 -m-6 rounded-full bg-primary/6 animate-pulse-glow" />
        <div
          className="absolute inset-0 -m-12 rounded-full bg-primary/3 animate-pulse-glow"
          style={{ animationDelay: "0.6s" }}
        />
        <div
          className="absolute inset-0 -m-20 rounded-full bg-primary/[0.015] animate-pulse-glow"
          style={{ animationDelay: "1.2s" }}
        />

        {/* 3D tilt wrapper */}
        <div
          className="transition-transform duration-200 ease-out"
          style={{
            transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
            transformStyle: "preserve-3d",
          }}
        >
          <div className="relative flex size-20 items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-sm ring-1 ring-primary/20 shadow-lg shadow-primary/10">
            <MessageSquare className="size-10 text-primary" />
          </div>
        </div>
      </div>

      {/* Title & Description */}
      <div className="text-center relative z-10 pointer-events-none">
        <div className="mb-1">
          <AnimatedTitle text={t("sessionView.welcomeTitle")} />
        </div>
        <p
          className="mt-2 max-w-md text-sm text-muted-foreground animate-text-fade-in"
          style={{ animationDelay: "0.6s", animationFillMode: "both" }}
        >
          {t("sessionView.welcomeDesc")}
        </p>
      </div>

      {/* Hint */}
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground/50 relative z-10 animate-text-fade-in pointer-events-none"
        style={{ animationDelay: "1s", animationFillMode: "both" }}
      >
        <ArrowLeft className="size-3 animate-bounce-horizontal" />
        <span>{t("sessionView.welcomeHint")}</span>
      </div>
    </div>
  );
}
