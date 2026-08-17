import { Check } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { useI18n } from "../i18n";

function IntegrationCard({
  dotClass,
  name,
  tagline,
  items,
}: {
  dotClass: string;
  name: string;
  tagline: string;
  items: readonly string[];
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-surface/50 p-6 sm:p-8">
      <div className="mb-1 flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
        <h3 className="text-lg font-semibold text-white">{name}</h3>
      </div>
      <p className="mb-6 text-sm text-slate-400">{tagline}</p>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-relaxed text-slate-300">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-400" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Integrations() {
  const { t } = useI18n();

  return (
    <section id="integrations" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          label={t.integrations.label}
          title={t.integrations.title}
          subtitle={t.integrations.subtitle}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <IntegrationCard
            dotClass="bg-sky-400"
            name={t.integrations.kiro.name}
            tagline={t.integrations.kiro.tagline}
            items={t.integrations.kiro.items}
          />
          <IntegrationCard
            dotClass="bg-amber-400"
            name={t.integrations.codebuddy.name}
            tagline={t.integrations.codebuddy.tagline}
            items={t.integrations.codebuddy.items}
          />
        </div>
      </div>
    </section>
  );
}
