interface SkeletonCardsProps {
  count?: number;
  className?: string;
}

/** A page-shaped placeholder for a list of cards that's about to load — reads as "this is basically ready" instead of a spinner floating over blank space. */
export function SkeletonCards({ count = 3, className = "" }: SkeletonCardsProps) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-pulse rounded-xl border border-border bg-surface p-4" style={{ animationDelay: `${i * 120}ms` }} aria-hidden>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-border" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 rounded bg-border" />
              <div className="h-3 w-1/2 rounded bg-border" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
