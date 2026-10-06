import type { ReactNode } from "react";

interface SectionHeadingProps {
  children: ReactNode;
  /** How many items the section holds, shown as a readout after the label. */
  count?: number;
  /** Something on the right of the rule — a filter, a link. */
  action?: ReactNode;
  id?: string;
  className?: string;
}

/**
 * A section label with a hairline running out to the edge — the way an
 * instrument panel labels its banks. Same face, size and spacing on every
 * screen.
 */
export function SectionHeading({ children, count, action, id, className = "" }: SectionHeadingProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <h2 id={id} className="flex shrink-0 items-baseline gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
        {children}
        {count !== undefined && <span className="tabular-nums text-ink-muted">{count}</span>}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-hairline" />
      {action}
    </div>
  );
}
