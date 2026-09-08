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
  return (
    <div role="tablist" className="flex gap-1 border-b border-border">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
              isActive ? "text-brand" : "text-ink-faint hover:text-ink-muted"
            }`}
          >
            {tab.label}
            {tab.badge && <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />}
            {isActive && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />}
          </button>
        );
      })}
    </div>
  );
}
