import { useState } from "react";
import { Download, Menu, X } from "lucide-react";
import GitHubIcon from "./GitHubIcon";
import { useI18n } from "../i18n";
import { LINKS } from "../links";

const logoUrl = `${import.meta.env.BASE_URL}fello.svg`;

export default function Navbar() {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);

  const navLinks = [
    { href: "#features", label: t.nav.features },
    { href: "#integrations", label: t.nav.integrations },
    { href: "#connect", label: t.nav.connect },
    { href: "#server", label: t.nav.server },
    { href: "#download", label: t.nav.download },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-base/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2.5">
          <img src={logoUrl} alt="Fello" className="h-7 w-7" />
          <span className="text-lg font-bold tracking-tight text-white">Fello</span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-slate-300 transition hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            className="hidden rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-teal-400/40 hover:text-white sm:block"
          >
            {t.langSwitch}
          </button>
          <a
            href={LINKS.repo}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="hidden text-slate-300 transition hover:text-white sm:block"
          >
            <GitHubIcon className="h-5 w-5" />
          </a>
          <a
            href={LINKS.releases}
            className="inline-flex items-center gap-2 rounded-full bg-teal-400 px-4 py-2 text-sm font-semibold text-teal-950 transition hover:bg-teal-300"
          >
            <Download className="h-4 w-4" />
            {t.nav.download}
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            className="text-slate-300 md:hidden"
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-white/5 bg-base/95 px-6 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="text-sm text-slate-300 hover:text-white"
              >
                {l.label}
              </a>
            ))}
            <button
              type="button"
              onClick={() => setLang(lang === "zh" ? "en" : "zh")}
              className="self-start rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300"
            >
              {t.langSwitch}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
