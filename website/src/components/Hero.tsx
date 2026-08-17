import { Download } from "lucide-react";
import GitHubIcon from "./GitHubIcon";
import { useI18n } from "../i18n";
import { LINKS } from "../links";
import screenshot from "../../../screenshots/screenshot-theme.png?webp";

export default function Hero() {
  const { t } = useI18n();

  return (
    <section id="top" className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-25%] h-[560px] w-[880px] -translate-x-1/2 rounded-full bg-teal-500/15 blur-[130px]" />
        <div className="absolute right-[-12%] top-[25%] h-[420px] w-[520px] rounded-full bg-indigo-500/10 blur-[130px]" />
        <div className="absolute left-[-12%] top-[55%] h-[380px] w-[480px] rounded-full bg-cyan-500/10 blur-[130px]" />
      </div>

      <div className="mx-auto max-w-6xl px-6 pb-20 pt-16 text-center sm:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/10 px-4 py-1.5 text-xs font-medium text-teal-300">
          {t.hero.badge}
        </span>

        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
          {t.hero.title1}
          <br />
          <span className="bg-gradient-to-r from-teal-300 via-cyan-300 to-indigo-300 bg-clip-text text-transparent">
            {t.hero.title2}
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
          {t.hero.subtitle}
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={LINKS.releases}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-teal-400 px-7 py-3 text-sm font-semibold text-teal-950 shadow-lg shadow-teal-500/25 transition hover:bg-teal-300 sm:w-auto"
          >
            <Download className="h-4 w-4" />
            {t.hero.ctaDownload}
          </a>
          <a
            href={LINKS.repo}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-7 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/10 sm:w-auto"
          >
            <GitHubIcon className="h-4 w-4" />
            {t.hero.ctaGithub}
          </a>
        </div>

        <dl className="mx-auto mt-12 grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-3">
          {t.hero.stats.map((s) => (
            <div key={s.value} className="flex flex-col items-center gap-1">
              <dt className="text-sm font-semibold text-white">{s.value}</dt>
              <dd className="text-xs text-slate-500">{s.label}</dd>
            </div>
          ))}
        </dl>

        <div className="relative mx-auto mt-14 max-w-4xl">
          <div className="absolute -inset-1.5 rounded-[1.75rem] bg-gradient-to-r from-teal-500/30 via-cyan-500/20 to-indigo-500/30 blur-2xl" />
          <div className="relative -mx-4">
            <img src={screenshot} alt={t.hero.screenshotAlt} className="w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
