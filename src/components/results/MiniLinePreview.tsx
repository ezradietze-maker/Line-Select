import { buildRawSegments, type TimelineSegmentKind } from "@/lib/trip-timeline";
import type { Line } from "@/types/bidpack";

/**
 * A tiny, always-visible shape of the whole line — one thin bar per trip,
 * each sized by real day-count share and filled with the same real flying/
 * deadhead/layover proportions as the full drop-down chart, just collapsed
 * to a single continuous strip instead of day-by-day rows. The point is
 * recognition at a glance, the way a pilot reads the shape of a line
 * printed in the bid pack itself, without opening anything.
 */

function miniSegmentClass(kind: TimelineSegmentKind): string {
  if (kind === "layover") return "bg-good";
  if (kind === "ground") return "bg-accent";
  if (kind === "connection") return "bg-border-strong";
  if (kind === "deadhead") return "bg-brand/40";
  return "bg-brand";
}

function tripTitle(trip: Line["trips"][number]): string {
  const cities = trip.layoverCities.length > 0 ? trip.layoverCities.join(" → ") : "no layovers";
  return `${trip.days}-day trip — ${cities}`;
}

export function MiniLinePreview({ line }: { line: Line }) {
  const trips = line.trips;
  if (trips.length === 0) return null;

  const totalDays = trips.reduce((sum, t) => sum + t.days, 0) || 1;

  return (
    <div className="flex h-2 w-full max-w-28 shrink-0 gap-0.5" title="Shape of this line's trips, at a glance">
      {trips.map((trip, tripIndex) => {
        const raw = buildRawSegments(trip);
        const widthShare = Math.max(trip.days / totalDays, 0.08);
        const span = raw.length > 0 ? Math.max(...raw.map((s) => s.endMinutes)) : 1;

        return (
          <div
            // `trip.id` alone isn't unique here — a short pairing flown
            // several times in the same month legitimately appears more
            // than once in one line's `trips` array (same pairing, same
            // id, counted once per occurrence).
            key={`${trip.id}-${tripIndex}`}
            className="relative h-full overflow-hidden rounded-[1px] bg-canvas"
            style={{ flexGrow: widthShare, flexBasis: 0 }}
            title={tripTitle(trip)}
          >
            {raw.length === 0 ? (
              <div className="absolute inset-0 bg-border-strong/50" />
            ) : (
              raw.map((seg, i) => (
                <div
                  key={i}
                  className={`absolute top-0 bottom-0 ${miniSegmentClass(seg.kind)}`}
                  style={{
                    left: `${(seg.startMinutes / span) * 100}%`,
                    width: `${Math.max(1.5, ((seg.endMinutes - seg.startMinutes) / span) * 100)}%`,
                  }}
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
