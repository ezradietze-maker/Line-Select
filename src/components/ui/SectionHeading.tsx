import type { ReactNode } from "react";
import { FlipText } from "@/components/ui/FlipText";

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
      {/* On one line beside the rule, unless it is wider than the whole row (a phone with its text set larger): then it
          wraps, rather than push the page sideways. */}
      <h2 id={id} className="flex max-w-full shrink-0 items-baseline gap-2 text-2xs font-medium text-ink-faint">
        {children}
        {/* The count turns over like a flip counter when it changes. */}
        {count !== undefined && <FlipText text={String(count)} className="tabular-nums text-ink-muted" />}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-hairline" />
      {action}
    </div>
  );
}
