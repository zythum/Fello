import { useState, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { MessageSquare, ArrowLeft, Bot, FolderPlus, MessageCirclePlus, Check } from "lucide-react";
import { useAppStore } from "../../store";
import { request } from "../../backend";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const agents = useAppStore((s) => s.configuredAgents);
  const projects = useAppStore((s) => s.projects);
  const setI18n = useAppStore((s) => s.setI18n);

  const enabledAgentCount = useMemo(() => agents.filter((a) => !a.disabled).length, [agents]);
  const hasAgents = enabledAgentCount > 0;
  const hasProjects = projects.length > 0;
  const allDone = hasAgents && hasProjects;

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
      {/* Version */}
      <span className="absolute bottom-3 right-4 text-[11px] text-muted-foreground/40 z-10 pointer-events-none">
        v{__APP_VERSION__}
      </span>

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
          className="absolute inset-0 -m-20 rounded-full bg-primary/1.5 animate-pulse-glow"
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
          <AnimatedTitle text={t("welcome.title")} />
        </div>
        <p
          className="mt-2 max-w-md text-sm text-muted-foreground animate-text-fade-in"
          style={{ animationDelay: "0.6s", animationFillMode: "both" }}
        >
          {t("welcome.desc")}
        </p>
      </div>

      {/* Getting Started Steps */}
      {!allDone ? (
        <div
          className="relative z-10 flex flex-col gap-3 w-full max-w-xs animate-text-fade-in"
          style={{ animationDelay: "0.8s", animationFillMode: "both" }}
        >
          <p className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wide text-center">
            {t("welcome.getStarted")}
          </p>

          {/* Language Tabs */}
          <Tabs
            value={i18n.language}
            onValueChange={(lang) => {
              if (!lang) return;
              setI18n({ language: lang });
              i18n.changeLanguage(lang);
              request.updateSettings({ i18n: { language: lang } }).catch(() => {});
            }}
            className="self-center w-full"
          >
            <TabsList className="w-full">
              <TabsTrigger value="en" className="flex-1 text-xs">{t("settings.general.english")}</TabsTrigger>
              <TabsTrigger value="zh-CN" className="flex-1 text-xs">{t("settings.general.chinese")}</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Step 1: Configure Agent */}
          <button
            type="button"
            onClick={() => !hasAgents && navigate("/settings/agents")}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              hasAgents
                ? "border-green-500/30 bg-green-500/5 cursor-default"
                : "border-border hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
            }`}
          >
            <div
              className={`flex size-7 shrink-0 items-center justify-center rounded-md ${
                hasAgents ? "bg-green-500/15 text-green-600" : "bg-primary/10 text-primary"
              }`}
            >
              {hasAgents ? <Check className="size-3.5" /> : <Bot className="size-3.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">
                {hasAgents
                  ? t("welcome.stepAgentDone", { count: enabledAgentCount })
                  : t("welcome.stepAgent")}
              </div>
              {!hasAgents && (
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {t("welcome.stepAgentDesc")}
                </div>
              )}
            </div>
          </button>

          {/* Step 2: Add Project */}
          <button
            type="button"
            onClick={() => {
              if (!hasProjects) {
                // Dispatch custom event that sidebar listens to for adding project
                window.dispatchEvent(new CustomEvent("fello:add-project"));
              }
            }}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              hasProjects
                ? "border-green-500/30 bg-green-500/5 cursor-default"
                : !hasAgents
                  ? "border-border/50 opacity-50 cursor-not-allowed"
                  : "border-border hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
            }`}
            disabled={!hasAgents}
          >
            <div
              className={`flex size-7 shrink-0 items-center justify-center rounded-md ${
                hasProjects ? "bg-green-500/15 text-green-600" : "bg-primary/10 text-primary"
              }`}
            >
              {hasProjects ? <Check className="size-3.5" /> : <FolderPlus className="size-3.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">
                {hasProjects
                  ? t("welcome.stepProjectDone", { count: projects.length })
                  : t("welcome.stepProject")}
              </div>
              {!hasProjects && (
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {t("welcome.stepProjectDesc")}
                </div>
              )}
            </div>
          </button>

          {/* Step 3: Start Chat */}
          <div
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${
              !hasAgents || !hasProjects ? "border-border/50 opacity-50" : "border-border"
            }`}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <MessageCirclePlus className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">{t("welcome.stepChat")}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {t("welcome.stepChatDesc")}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground/50 relative z-10 animate-text-fade-in pointer-events-none"
          style={{ animationDelay: "1s", animationFillMode: "both" }}
        >
          <ArrowLeft className="size-3 animate-bounce-horizontal" />
          <span>{t("welcome.allDone")}</span>
        </div>
      )}
    </div>
  );
}
