import { BookOpen, Download as DownloadIcon } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { useI18n } from "../i18n";
import { LINKS } from "../links";

export default function Download() {
  const { t, lang } = useI18n();
  const manualLink = lang === "zh" ? LINKS.manualZh : LINKS.manualEn;

  return (
    <section id="download" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-teal-500/[0.08] via-surface/50 to-indigo-500/[0.08] px-6 py-12 text-center sm:px-12 sm:py-16">
          <div className="pointer-events-none absolute left-1/2 top-[-40%] h-[320px] w-[640px] -translate-x-1/2 rounded-full bg-teal-500/10 blur-[100px]" />

          <SectionHeading
            label={t.download.label}
            title={t.download.title}
            subtitle={t.download.subtitle}
          />

          <div className="mx-auto mb-10 grid max-w-3xl gap-4 sm:grid-cols-3">
            {t.download.steps.map((step, i) => (
              <div
                key={step.title}
                className="rounded-2xl border border-white/10 bg-base/50 p-5 text-left"
              >
                <span className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-teal-400/15 text-sm font-semibold text-teal-300 ring-1 ring-teal-400/30">
                  {i + 1}
                </span>
                <h3 className="mb-1.5 text-sm font-semibold text-white">{step.title}</h3>
                <p className="text-xs leading-relaxed text-slate-400">{step.desc}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={LINKS.releases}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-teal-400 px-8 py-3.5 text-sm font-semibold text-teal-950 shadow-lg shadow-teal-500/25 transition hover:bg-teal-300 sm:w-auto"
            >
              <DownloadIcon className="h-4 w-4" />
              {t.download.cta}
            </a>
            <a
              href={manualLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-8 py-3.5 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/10 sm:w-auto"
            >
              <BookOpen className="h-4 w-4" />
              {t.download.manual}
            </a>
          </div>

          <a
            href={LINKS.releases}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-xs text-slate-500 transition hover:text-teal-300 hover:underline"
          >
            {t.download.ctaHint}
          </a>
        </div>
      </div>
    </section>
  );
}
