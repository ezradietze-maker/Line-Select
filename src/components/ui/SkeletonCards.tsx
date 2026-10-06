interface SkeletonCardsProps {
  count?: number;
  /** Which real card is about to load, so the placeholder has its shape: a trade offer, a hotel, or a generic row. */
  shape?: "row" | "offer" | "hotel";
  className?: string;
}

function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-hairline ${className}`} />;
}

/** A page-shaped placeholder for a list of cards that's about to load — the same outline as the cards that replace it, so nothing jumps when they arrive. */
export function SkeletonCards({ count = 3, shape = "row", className = "" }: SkeletonCardsProps) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-pulse panel-glass p-4 sm:p-5" style={{ animationDelay: `${i * 120}ms` }} aria-hidden>
          {shape === "offer" ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <Bar className="h-4 w-1/2" />
                <Bar className="h-6 w-16 rounded-full" />
              </div>
              <Bar className="mt-2.5 h-3 w-3/4" />
              <Bar className="mt-4 h-3.5 w-1/3" />
            </>
          ) : shape === "hotel" ? (
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 shrink-0 rounded-full border-4 border-hairline" />
              <div className="flex-1 space-y-2">
                <Bar className="h-4 w-2/5" />
                <Bar className="h-3 w-3/5" />
              </div>
              <Bar className="hidden h-3 w-16 sm:block" />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-hairline" />
              <div className="flex-1 space-y-2">
                <Bar className="h-3.5 w-1/3" />
                <Bar className="h-3 w-1/2" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
