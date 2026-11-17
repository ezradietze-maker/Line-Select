"use client";

import { useId } from "react";
import { PillHighlight } from "@/components/ui/PillHighlight";

interface Tab {
  id: string;
  label: string;
  /** Small dot/count shown next to the label — used to flag a tab has something worth looking at (a dealbreaker near-miss, a rough circadian read) without pre-empting the tab's own content. */
  badge?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
}

/**
 * A small, local underline-style tab strip — first used to split `LineCard`'s
 * expanded detail view (Calendar / Score Breakdown / Circadian / Reviews)
 * into distinct panels instead of one long continuous scroll. Deliberately
 * minimal: no routing, no animation library dependency, just a controlled
 * active-id switch, since every current use case swaps plain content below it.
 */
export function Tabs({ tabs, activeId, onChange }: TabsProps) {
  const group = useId();
  return (
    // Tighter and free to wrap on a phone: at 320px the last tab (the line's Route) sat past the card's edge, out of reach.
    <div role="tablist" className="flex flex-wrap gap-x-1 border-b border-border">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-1.5 px-2 py-2 text-xs sm:px-3 font-medium transition-colors ${
              isActive ? "font-semibold text-ink" : "text-ink-faint hover:text-ink-muted"
            }`}
          >
            {tab.label}
            {tab.badge && <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />}
            {isActive && <PillHighlight group={group} className="absolute inset-x-0 -bottom-px h-[3px] bg-brand" />}
          </button>
        );
      })}
    </div>
  );
}
