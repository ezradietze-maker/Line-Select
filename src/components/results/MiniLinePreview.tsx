import { buildRawSegments, type RawSegment, type TimelineSegmentKind } from "@/lib/trip-timeline";
import type { Line } from "@/types/bidpack";

/**
 * A real, readable shape of the whole line, visible without opening the
 * drop-down: one full-width row per trip, filled with the same real flying/
 * deadhead/layover/ground/connection proportions the full chart draws — just
 * one trip's whole span compressed onto a single bar instead of split into
 * day-by-day rows. Sized to actually be read at a glance (the first version
 * of this was an 80x8px sliver — real information, but too small to mean
 * anything to a pilot looking at it), with the same legend and color
 * language as the full chart so the two never need to be learned twice.
 */

const MINUTES_PER_DAY = 24 * 60;

function segmentClass(kind: TimelineSegmentKind): string {
  if (kind === "layover") return "bg-good";
  if (kind === "ground") return "bg-accent";
  if (kind === "connection") return "bg-border-strong";
  if (kind === "deadhead") {
    return "bg-brand/40 [background-image:repeating-linear-gradient(135deg,transparent,transparent_3px,rgba(255,255,255,0.35)_3px,rgba(255,255,255,0.35)_6px)]";
  }
  return "bg-brand";
}

function inlineTextClass(kind: TimelineSegmentKind): string {
  return kind === "deadhead" ? "text-ink" : "text-white";
}

/** Percent-of-bar thresholds, not fixed minutes — a whole trip's real duration (2 days vs. 9 days) is compressed onto one same-width bar here, so what counts as "wide enough for text" has to scale with that trip's own total span, not an absolute clock duration like the day-by-day chart uses. */
const MIN_PERCENT_FOR_FLIGHT_LABELS = 11;
const MIN_PERCENT_FOR_LAYOVER_LABEL = 3.5;

function showsInlineText(seg: RawSegment, widthPercent: number): boolean {
  if (seg.kind === "flying" || seg.kind === "deadhead") return widthPercent >= MIN_PERCENT_FOR_FLIGHT_LABELS;
  if (seg.kind === "layover") return widthPercent >= MIN_PERCENT_FOR_LAYOVER_LABEL;
  return false;
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-3 shrink-0 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

function TripBar({ trip }: { trip: Line["trips"][number] }) {
  const raw = buildRawSegments(trip);
  const span = raw.length > 0 ? Math.max(...raw.map((s) => s.endMinutes)) : MINUTES_PER_DAY * trip.days;
  const dayCount = Math.max(1, Math.round(span / MINUTES_PER_DAY));
  const cities = trip.layoverCities.length > 0 ? trip.layoverCities.join(" → ") : "no layovers";

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 shrink-0 font-mono text-[10px] font-medium text-brand" title={`${trip.days}-day trip — ${cities}`}>
        {trip.days}-day
      </div>
      <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-canvas">
        {Array.from({ length: dayCount - 1 }).map((_, d) => (
          <div
            key={d}
            className="absolute top-0 bottom-0 w-px bg-border/70"
            style={{ left: `${(((d + 1) * MINUTES_PER_DAY) / span) * 100}%` }}
          />
        ))}
        {raw.length === 0 ? (
          <div className="absolute inset-0 bg-border-strong/50" title="Trip shape estimated, not a verified schedule" />
        ) : (
          raw.map((seg, i) => {
            const widthPercent = Math.max(0.8, ((seg.endMinutes - seg.startMinutes) / span) * 100);
            return (
              <div
                key={i}
                title={`${seg.label} — ${seg.detail}`}
                className={`absolute top-0 bottom-0 ${segmentClass(seg.kind)}`}
                style={{ left: `${(seg.startMinutes / span) * 100}%`, width: `${widthPercent}%` }}
              >
                {showsInlineText(seg, widthPercent) && (
                  <div
                    className={`flex h-full items-center gap-1 px-1 font-mono text-[9px] font-medium leading-none ${inlineTextClass(seg.kind)}`}
                  >
                    {/* A whole trip (up to ~13 days) is compressed onto one bar here, so even a "wide" layover has far less real estate than the same layover gets in the day-by-day chart — city code alone fits cleanly at sizes where "city · duration" would just cut off mid-number; the duration is still one hover away. */}
                    <span className="min-w-0 flex-1 truncate text-left">
                      {seg.kind === "layover" ? seg.inlineStart.split(" · ")[0] : seg.inlineStart}
                    </span>
                    {seg.inlineEnd && <span className="min-w-0 flex-1 truncate text-right">{seg.inlineEnd}</span>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function MiniLinePreview({ line }: { line: Line }) {
  const trips = line.trips;
  if (trips.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-medium text-brand">
        <LegendSwatch className="bg-brand" label="Flying" />
        <LegendSwatch className={segmentClass("deadhead")} label="Deadhead" />
        <LegendSwatch className="bg-good" label="Layover" />
        <LegendSwatch className="bg-accent" label="Ground" />
        <LegendSwatch className="bg-border-strong" label="Connection" />
      </div>
      <div className="mt-1.5 space-y-1.5">
        {trips.map((trip, tripIndex) => (
          // `trip.id` alone isn't unique — the same short pairing flown
          // more than once in a month legitimately repeats in this array.
          <TripBar key={`${trip.id}-${tripIndex}`} trip={trip} />
        ))}
      </div>
    </div>
  );
}
