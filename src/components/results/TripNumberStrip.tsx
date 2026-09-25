import type { Trip } from "@/types/bidpack";

/** In calendar order when the grid gave every trip a real start day; otherwise the order the line lists them. */
function inFlyingOrder(trips: Trip[]): Trip[] {
  if (trips.some((t) => t.startDayIndex === null)) return trips;
  return [...trips].sort((a, b) => (a.startDayIndex ?? 0) - (b.startDayIndex ?? 0));
}

/**
 * The bid pack's own trip (pairing) numbers for a line, each with its
 * landings — the identifiers pilots actually use to look a trip up in the
 * pack or offer it on the Trade Board, shown right above the calendar.
 */
export function TripNumberStrip({ trips }: { trips: Trip[] }) {
  const numbered = inFlyingOrder(trips).filter((t) => t.pairingNumber !== null);
  if (numbered.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1.5" aria-label="Trip numbers on this line">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Trips</span>
      {numbered.map((trip, i) => (
        <span
          key={`${trip.id}-${i}`}
          className="inline-flex items-baseline gap-1 rounded-md border border-border bg-canvas px-2 py-0.5 font-mono text-xs text-ink"
          title={`Trip ${trip.pairingNumber} — ${trip.landings} landing${trip.landings === 1 ? "" : "s"}`}
        >
          <span className="font-semibold">{trip.pairingNumber}</span>
          <span className="text-ink-muted">
            &middot; {trip.landings} ldg{trip.landings === 1 ? "" : "s"}
          </span>
        </span>
      ))}
    </div>
  );
}
