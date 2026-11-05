import type { ReactNode } from "react";

/**
 * A caution kept to one line, the way a NOTAM reads: a tag, the headline that matters, and the full text a tap away.
 * For standing disclaimers that are true on every visit, so they stay in view without taking over the page.
 */
export function NotamStrip({ headline, children, className = "" }: { headline: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={`group rounded-lg border border-warn/30 bg-warn-soft/40 text-sm ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 rounded-[3px] bg-warn px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-canvas">Notam</span>
        <span className="min-w-0 flex-1 font-medium text-warn">{headline}</span>
        <span className="shrink-0 text-xs text-ink-muted underline decoration-dotted underline-offset-4">
          <span className="group-open:hidden">Read more</span>
          <span className="hidden group-open:inline">Less</span>
        </span>
      </summary>
      <div className="border-t border-warn/20 px-3 pb-3 pt-2.5 leading-relaxed text-ink-muted">{children}</div>
    </details>
  );
}
