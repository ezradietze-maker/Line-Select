"use client";

import { HEAT_GRADIENT, heatColor } from "@/lib/heat-scale";
import { heatPieceName, sharePercents, type HeatPiece, type HeatShare, type TripHeat } from "@/lib/line-heat";
import type { TimelineSegment } from "@/lib/trip-timeline";

/**
 * The Heat Map's words beside its colours (`lib/line-heat.ts`): how much of a line or a trip runs hot, mild and cold,
 * and — on a tap, since a phone can't point — why each duty period and layover is as hot or cold as it is.
 */

/** Which heat piece a drawn bar is, from the timeline piece it was drawn from; undefined off the Heat Map. */
export type HeatOf = (seg: TimelineSegment | undefined, kind: "duty" | "layover") => HeatPiece | undefined;

/** `HeatOf` for bars from one trip (and, on a calendar day, the tail of another: `spill`). */
export function heatOfTrips(trips: Map<number, TripHeat> | null | undefined, trip: number | null, spill?: { trip: number; segments: TimelineSegment[] } | null): HeatOf | undefined {
  if (!trips) return undefined;
  return (seg, kind) => {
    if (!seg || seg.dutyIndex === undefined) return undefined;
    const t = spill?.segments.includes(seg) ? trips.get(spill.trip) : trip !== null ? trips.get(trip) : undefined;
    return (kind === "duty" ? t?.duty : t?.layover)?.get(seg.dutyIndex);
  };
}

/** How much of the time runs hot, mild and cold, as one bar and three percents that add up to 100. */
export function HeatShareLine({ share, label, className = "" }: { share: HeatShare; label: string; className?: string }) {
  const p = sharePercents(share);
  if (p.hot + p.mild + p.cold === 0) return null;
  const bands = [
    { key: "hot", pct: p.hot, color: heatColor(0.85) },
    { key: "mild", pct: p.mild, color: heatColor(0.5) },
    { key: "cold", pct: p.cold, color: heatColor(0.12) },
  ] as const;
  const said = `${label} ${p.hot}% hot, ${p.mild}% mild, ${p.cold}% cold`;
  return (
    <div className={className} title={said}>
      <div aria-hidden className="flex h-1.5 overflow-hidden rounded-[2px] border border-border-strong/50">
        {bands.map((b) => (b.pct > 0 ? <span key={b.key} style={{ width: `${b.pct}%`, background: b.color }} /> : null))}
      </div>
      {/* Each share kept whole, the three free to wrap: on one line at 320px and 200% text it ran past the card, cut at "Trips 48%". */}
      <div className="mt-0.5 text-2xs leading-[0.75rem] text-ink-muted">
        <span className="sr-only">{said}</span>
        <span aria-hidden>
          <span className="whitespace-nowrap">
            {label} <span className="font-mono font-semibold tabular-nums text-ink">{p.hot}%</span> hot ·
          </span>{" "}
          <span className="whitespace-nowrap">
            <span className="font-mono tabular-nums text-ink">{p.mild}%</span> mild ·
          </span>{" "}
          <span className="whitespace-nowrap">
            <span className="font-mono tabular-nums text-ink">{p.cold}%</span> cold
          </span>
        </span>
      </div>
    </div>
  );
}

/** A small square of a piece's (or a reason's) heat. */
function Swatch({ heat, size = "h-2.5 w-2.5" }: { heat: number; size?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-[2px] border border-border-strong/50 ${size}`} style={{ background: heatColor(heat) }} />;
}

/** Each piece and its reasons, warmest first, each reason with its own heat — what a tap on a day shows. */
export function HeatReasons({ pieces, className = "" }: { pieces: HeatPiece[]; className?: string }) {
  if (!pieces.length) return null;
  return (
    <ul className={`space-y-1.5 ${className}`} aria-label="Why it's hot or cold">
      {pieces.map((p, i) => (
        <li key={i} className="flex gap-2">
          <Swatch heat={p.heat} size="mt-0.5 h-3 w-3" />
          <span className="min-w-0">
            <span className="font-medium text-ink">{heatPieceName(p)}</span>
            <span className="ml-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
              {/* Each reason wraps rather than running on unbroken: on a 320px phone at 200% text "Commute in to the domicile"
                  ran past the card and was cut off. */}
              {p.factors.map((f, k) => (
                <span key={k} className="inline-flex max-w-full items-center gap-1">
                  <Swatch heat={f.heat} size="h-2 w-2" />
                  {f.text}
                  {f.dealbreaker && <span className="font-semibold text-danger">past your limit</span>}
                </span>
              ))}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The Heat Map's key over a calendar or a trip's days: the colours say heat, and a tap says why. */
export function HeatKey({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-muted ${className}`}>
      {/* No wider than the key, as the strip's: on a 320px phone at 200% text the scale ran off the card and cut "Hot". */}
      <span className="inline-flex max-w-full items-center gap-1.5">
        Cold
        <span aria-hidden className="inline-block h-2.5 w-20 rounded-[2px] border border-border-strong/60" style={{ background: HEAT_GRADIENT }} />
        Hot
      </span>
      <span>each duty period with its flights, and each layover, colder the worse it is for you</span>
      <span>Tap a day for why.</span>
    </div>
  );
}

/** The pieces a day's bars draw, once each, in time order. */
export function heatPiecesOn(segments: TimelineSegment[], heatOf: HeatOf | undefined): HeatPiece[] {
  if (!heatOf) return [];
  const out: HeatPiece[] = [];
  for (const s of segments) {
    const p = heatOf(s, s.kind === "layover" ? "layover" : "duty");
    if (p && (s.kind === "layover" || s.kind === "flying" || s.kind === "deadhead" || s.kind === "standby" || s.kind === "ground" || s.kind === "connection") && !out.includes(p)) out.push(p);
  }
  return out.sort((a, b) => a.start - b.start);
}
