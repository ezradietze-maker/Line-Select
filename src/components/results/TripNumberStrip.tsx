import { CreditHours } from "@/components/results/TripMarks";
import { tripStandbyDays } from "@/lib/standby";
import type { Trip } from "@/types/bidpack";

/** In calendar order when the grid gave every trip a real start day; otherwise the order the line lists them. */
function inFlyingOrder(trips: Trip[]): Trip[] {
  if (trips.some((t) => t.startDayIndex === null)) return trips;
  return [...trips].sort((a, b) => (a.startDayIndex ?? 0) - (b.startDayIndex ?? 0));
}

function TripChip({ trip }: { trip: Trip }) {
  const standby = tripStandbyDays(trip);
  return (
    <span
      className="inline-flex items-baseline gap-1 rounded-md border border-border bg-canvas px-2 py-0.5 font-mono text-xs text-ink"
      title={`Trip ${trip.pairingNumber} — ${trip.creditHours.toFixed(2)} credit hours, ${trip.landings} landing${trip.landings === 1 ? "" : "s"}${standby > 0 ? `, ${standby} standby day${standby === 1 ? "" : "s"}` : ""}`}
    >
      <span className="font-semibold">{trip.pairingNumber}</span>
      <span className="text-ink-muted">
        &middot; <CreditHours hours={trip.creditHours} /> &middot; {trip.landings} ldg{trip.landings === 1 ? "" : "s"}
      </span>
      {standby > 0 && (
        <span className="text-warn" title="Days on standby at a layover hotel — paid, not flying">
          &middot; {standby} standby
        </span>
      )}
    </span>
  );
}

/**
 * The bid pack's own trip (pairing) numbers for a line, each with its credit and landings — the identifiers pilots
 * actually use to look a trip up in the pack or offer it on the Trade Board, shown right above the calendar. Trips
 * flown back to back without getting home between (`departures`, from `groupDepartures`) sit together in one tinted
 * box: one departure from home, however many trips.
 */
export function TripNumberStrip({ trips, departures }: { trips: Trip[]; departures?: Trip[][] }) {
  const numbered = inFlyingOrder(trips).filter((t) => t.pairingNumber !== null);
  if (numbered.length === 0) return null;
  // Each trip's departure, then the strip as runs: a lone trip, or the trips of one departure together.
  const groupOf = new Map<Trip, Trip[]>();
  for (const group of departures ?? []) for (const t of group) groupOf.set(t, group);
  const runs: Trip[][] = [];
  for (const trip of numbered) {
    const last = runs.at(-1);
    if (last && groupOf.has(trip) && groupOf.get(trip) === groupOf.get(last[0])) last.push(trip);
    else runs.push([trip]);
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1.5" aria-label="Trip numbers on this line">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Trips</span>
      {runs.map((run, i) =>
        run.length > 1 ? (
          <span
            key={i}
            className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-chain/50 bg-chain/15 p-1"
            title={`${run.length} trips flown back to back — one departure from home`}
          >
            {run.map((trip, k) => (
              <TripChip key={`${trip.id}-${k}`} trip={trip} />
            ))}
          </span>
        ) : (
          <TripChip key={`${run[0].id}-${i}`} trip={run[0]} />
        )
      )}
    </div>
  );
}
