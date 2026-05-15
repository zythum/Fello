import { useEffect, useRef, useCallback } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

const PARTICLE_COUNT = 70;
const CONNECTION_DIST = 140;
const RIPPLE_MAX_RADIUS = 200;

// Light / dark colors — CSS vars don't resolve in Canvas, so we pick in JS
const COLOR_LIGHT = "oklch(0.511 0.096 186.391)";
const COLOR_DARK = "oklch(0.78 0.1 175)";

function getParticleColor(): string {
  return document.documentElement.classList.contains("dark") ? COLOR_DARK : COLOR_LIGHT;
}

export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const animIdRef = useRef<number>(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const { clientWidth: w, clientHeight: h } = parent;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    sizeRef.current = { width: w, height: h, dpr };
  }, []);

  const initParticles = useCallback(() => {
    const { width, height } = sizeRef.current;
    const arr = particlesRef.current;
    arr.length = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      arr.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: Math.random() * 1.6 + 0.5,
      });
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    resize();
    initParticles();

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // Multi-ring ripple on click
      ripplesRef.current.push(
        { x: cx, y: cy, radius: 0, maxRadius: RIPPLE_MAX_RADIUS, alpha: 0.8 },
        { x: cx, y: cy, radius: 0, maxRadius: RIPPLE_MAX_RADIUS * 0.65, alpha: 0.5 },
      );
      // Cap ripples
      if (ripplesRef.current.length > 40) {
        ripplesRef.current.splice(0, 2);
      }
    };

    canvas.addEventListener("click", handleClick);

    const draw = () => {
      const { width, height, dpr } = sizeRef.current;
      const particles = particlesRef.current;
      const ripples = ripplesRef.current;
      const color = getParticleColor();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // --- Draw ripples ---
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.radius += 1.5;
        r.alpha -= 0.003;
        if (r.alpha <= 0 || r.radius > r.maxRadius) {
          ripples.splice(i, 1);
          continue;
        }

        const progress = r.radius / r.maxRadius;
        const alpha = r.alpha * (1 - progress);

        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2 * (1 - progress);
        ctx.stroke();
      }

      // --- Draw particles ---
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.fill();
      }

      // --- Draw connections ---
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CONNECTION_DIST) {
            const alpha = (1 - dist / CONNECTION_DIST) * 0.1;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 0.4;
            ctx.stroke();
          }
        }
      }

      ctx.globalAlpha = 1;
      animIdRef.current = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      resize();
      initParticles();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animIdRef.current);
      canvas.removeEventListener("click", handleClick);
      window.removeEventListener("resize", handleResize);
    };
  }, [resize, initParticles]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-auto cursor-pointer"
      aria-hidden="true"
    />
  );
}
