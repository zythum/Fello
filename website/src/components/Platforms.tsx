import { Check, Minus } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { useI18n } from "../i18n";

export default function Platforms() {
  const { t } = useI18n();

  return (
    <section id="platforms" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-4xl px-6">
        <SectionHeading
          label={t.platforms.label}
          title={t.platforms.title}
        />
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-surface/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03] text-left">
                <th className="px-6 py-4 font-medium text-slate-300">
                  {t.platforms.headers.platform}
                </th>
                <th className="px-6 py-4 font-medium text-slate-300">
                  {t.platforms.headers.desktop}
                </th>
                <th className="px-6 py-4 font-medium text-slate-300">
                  {t.platforms.headers.webui}
                </th>
              </tr>
            </thead>
            <tbody>
              {t.platforms.rows.map((row) => (
                <tr key={row.name} className="border-b border-white/5 last:border-0">
                  <td className="px-6 py-4 text-slate-200">{row.name}</td>
                  <td className="px-6 py-4">
                    {row.desktop ? (
                      <Check className="h-4 w-4 text-teal-400" />
                    ) : (
                      <Minus className="h-4 w-4 text-slate-600" />
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {row.webui ? (
                      <Check className="h-4 w-4 text-teal-400" />
                    ) : (
                      <Minus className="h-4 w-4 text-slate-600" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
