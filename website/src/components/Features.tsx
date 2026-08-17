import {
  Brain,
  Clock,
  Globe,
  KeyRound,
  LayoutGrid,
  MessageCircle,
  Puzzle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import SectionHeading from "./SectionHeading";
import { useI18n } from "../i18n";

const icons = [
  Puzzle,
  ShieldCheck,
  LayoutGrid,
  Brain,
  KeyRound,
  Globe,
  Clock,
  MessageCircle,
  Sparkles,
];

export default function Features() {
  const { t } = useI18n();

  return (
    <section id="features" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          label={t.features.label}
          title={t.features.title}
          subtitle={t.features.subtitle}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.features.items.map((f, i) => {
            const Icon = icons[i % icons.length];
            return (
              <div
                key={f.title}
                className="group rounded-2xl border border-white/10 bg-surface/50 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-teal-400/30 hover:bg-surface"
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400/10 text-teal-300 ring-1 ring-teal-400/20 transition group-hover:bg-teal-400/20">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-base font-semibold text-white">{f.title}</h3>
                <p className="text-sm leading-relaxed text-slate-400">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
