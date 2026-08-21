import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionContext } from "../../../lib/session-selectors";
import type { ContextSnapshot } from "../../../../shared/schema";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CurrentComposition } from "./current-composition";
import { ContextHistory } from "./context-history";
import { ContextEvents } from "./context-events";
import { useSeedContext } from "./use-seed-context";

/** 右侧 Panel 的「上下文」标签：非模态的精简视图 */
export function ContextPanel({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const { timeline, events, latest, windowSize } = useSessionContext(sessionId);
  const [selected, setSelected] = useState<ContextSnapshot | null>(null);
  const [hovered, setHovered] = useState<ContextSnapshot | null>(null);

  useSeedContext(sessionId, true);

  const activeSnapshot = selected ?? hovered ?? latest;
  const handleHover = useCallback((snap: ContextSnapshot | null) => setHovered(snap), []);
  const handleSelect = useCallback((snap: ContextSnapshot | null) => setSelected(snap), []);

  return (
    <ScrollArea className="h-full" viewportClassName="px-0 py-0">
      <div className="space-y-3 p-3">
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
            {t("context.composition.title", "Current composition")}
          </h3>
          <CurrentComposition snapshot={activeSnapshot} windowSize={windowSize} />
        </section>
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
            {t("context.history.title", "Context history")}
          </h3>
          <ContextHistory
            timeline={timeline}
            events={events}
            selectedStepId={selected?.stepId ?? null}
            onHover={handleHover}
            onSelect={handleSelect}
          />
        </section>
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
            {t("context.events.title", "Context events")}
          </h3>
          <ContextEvents events={events} />
        </section>
      </div>
    </ScrollArea>
  );
}
