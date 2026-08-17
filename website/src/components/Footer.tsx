import GitHubIcon from "./GitHubIcon";
import { useI18n } from "../i18n";
import { LINKS } from "../links";

const logoUrl = `${import.meta.env.BASE_URL}fello.svg`;

export default function Footer() {
  const { t, lang } = useI18n();
  const manualLink = lang === "zh" ? LINKS.manualZh : LINKS.manualEn;

  return (
    <footer className="border-t border-white/5 py-14">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <img src={logoUrl} alt="Fello" className="h-7 w-7" />
              <span className="text-lg font-bold text-white">Fello</span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
              {t.footer.tagline}
            </p>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">{t.footer.resources}</h4>
            <ul className="space-y-2.5 text-sm text-slate-400">
              <li>
                <a href={manualLink} target="_blank" rel="noreferrer" className="transition hover:text-white">
                  {t.footer.manual}
                </a>
              </li>
              <li>
                <a href={LINKS.developer} target="_blank" rel="noreferrer" className="transition hover:text-white">
                  {t.footer.developer}
                </a>
              </li>
              <li>
                <a href={LINKS.license} target="_blank" rel="noreferrer" className="transition hover:text-white">
                  {t.footer.license}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">{t.footer.community}</h4>
            <ul className="space-y-2.5 text-sm text-slate-400">
              <li>
                <a href={LINKS.repo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 transition hover:text-white">
                  <GitHubIcon className="h-4 w-4" />
                  GitHub
                </a>
              </li>
              <li>
                <a href={LINKS.issues} target="_blank" rel="noreferrer" className="transition hover:text-white">
                  {t.footer.issues}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/5 pt-6 text-xs text-slate-500 sm:flex-row">
          <span>
            © {new Date().getFullYear()} Zythum · {t.footer.license}
          </span>
          <span className="flex items-center gap-1.5">
            {t.footer.built}
          </span>
        </div>
      </div>
    </footer>
  );
}
