import SectionHeading from "./SectionHeading";
import { useI18n } from "../i18n";

function StepCard({
  title,
  desc,
  steps,
  note,
}: {
  title: string;
  desc: string;
  steps: readonly string[];
  note: string;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-surface/50 p-6 sm:p-8">
      <div className="mb-4 flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full bg-teal-400" />
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>
      <p className="mb-6 text-sm text-slate-400">{desc}</p>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3 text-sm leading-relaxed text-slate-300">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-400/15 text-xs font-semibold text-teal-300 ring-1 ring-teal-400/30">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <p className="mt-6 border-t border-white/5 pt-4 text-xs leading-relaxed text-slate-500">
        {note}
      </p>
    </div>
  );
}

export default function Connect() {
  const { t } = useI18n();

  return (
    <section id="connect" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          label={t.connect.label}
          title={t.connect.title}
          subtitle={t.connect.subtitle}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <StepCard
            title={t.connect.ilink.title}
            desc={t.connect.ilink.desc}
            steps={t.connect.ilink.steps}
            note={t.connect.ilink.note}
          />
          <StepCard
            title={t.connect.webui.title}
            desc={t.connect.webui.desc}
            steps={t.connect.webui.steps}
            note={t.connect.webui.note}
          />
        </div>
      </div>
    </section>
  );
}
