import { Terminal } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { useI18n } from "../i18n";

function CodeBlock({ commands }: { commands: readonly string[] }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs leading-relaxed text-slate-200">
      {commands.map((cmd) => (
        <div key={cmd}>
          <span className="select-none text-teal-400/70">$ </span>
          {cmd}
        </div>
      ))}
    </pre>
  );
}

export default function Server() {
  const { t } = useI18n();
  const s = t.server;

  return (
    <section id="server" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading label={s.label} title={s.title} subtitle={s.subtitle} />

        <div className="mb-10 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-surface/50 p-6 sm:p-8 overflow-hidden">
            <div className="mb-4 flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400/10 text-teal-300 ring-1 ring-teal-400/20">
                <Terminal className="h-5 w-5" />
              </span>
              <h3 className="text-lg font-semibold text-white">{s.runNpx.title}</h3>
            </div>
            <p className="mb-4 text-sm text-slate-400">{s.runNpx.desc}</p>
            <CodeBlock commands={s.runNpx.commands} />
          </div>

          <div className="rounded-2xl border border-white/10 bg-surface/50 p-6 sm:p-8 overflow-hidden">
            <div className="mb-4 flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400/10 text-teal-300 ring-1 ring-teal-400/20">
                <Terminal className="h-5 w-5" />
              </span>
              <h3 className="text-lg font-semibold text-white">{s.runGlobal.title}</h3>
            </div>
            <p className="mb-4 text-sm text-slate-400">{s.runGlobal.desc}</p>
            <CodeBlock commands={s.runGlobal.commands} />
          </div>
        </div>

        <div className="mb-10 overflow-hidden rounded-2xl border border-white/10 bg-surface/50">
          <div className="border-b border-white/10 bg-white/[0.03] px-6 py-4 text-sm font-medium text-slate-300">
            {s.paramsTitle}
          </div>
          <dl>
            {s.params.map((p) => (
              <div
                key={p.flag}
                className="flex flex-col gap-1 border-b border-white/5 px-6 py-4 last:border-0 sm:flex-row sm:items-center sm:gap-6"
              >
                <dt className="w-44 shrink-0 font-mono text-sm text-teal-300">{p.flag}</dt>
                <dd className="text-sm text-slate-400">{p.desc}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mb-10 rounded-2xl border border-white/10 bg-surface/50 p-6 sm:p-8 overflow-hidden">
          <h3 className="mb-2 text-lg font-semibold text-white">{s.accessTitle}</h3>
          <p className="mb-4 text-sm text-slate-400">{s.accessDesc}</p>
          <CodeBlock commands={[s.accessUrl]} />
        </div>

      </div>
    </section>
  );
}
