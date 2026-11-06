import type { LineTimeline, TimelineLeg, TimelineSpan, TimelineStay, TimelineTrip } from "@/lib/line-timeline";

/**
 * The results list's Timeline, organised by trip: every word the bid pack prints for a line — each flight number (a
 * deadhead run as one "D/H"), each layover city, each trip's number and credit, each day off — kept, but grouped so it
 * reads as the pilot will fly it. Each trip is one card from report to release; inside it the flights and layovers run
 * as one route in time order, each flight number over its own leg and each city under its own layover.
 */

/** One leg as drawn: a deadhead run inside a duty is one leg, labelled "D/H" once, as the pack prints it. */
export interface RouteLeg extends TimelineSpan {
  label: string;
  from: string;
  to: string;
  kind: TimelineLeg["kind"];
}

export interface TripRoute {
  trip: TimelineTrip;
  legs: RouteLeg[];
  /** Layovers, each with its city. */
  stays: TimelineStay[];
  /** Waits on the ground between two legs with no layover between them: a connection, or a sit at a hub. */
  waits: TimelineSpan[];
}

/** A deadhead after another, this soon after it lands, is the same run of deadheads. */
const DEADHEAD_RUN_GAP_MIN = 6 * 60;

/** Every trip on the line, in time order, with the legs, layovers and waits inside its report-to-release. */
export function routesOf(timeline: LineTimeline): TripRoute[] {
  return timeline.trips.map((trip) => {
    const inside = <T extends TimelineSpan>(s: T) => s.start >= trip.start - 1 && s.end <= trip.end + 1;
    const legs: RouteLeg[] = [];
    for (const l of timeline.legs.filter(inside).sort((a, b) => a.start - b.start)) {
      const prev = legs.at(-1);
      if (l.kind === "deadhead" && prev?.kind === "deadhead" && l.start - prev.end < DEADHEAD_RUN_GAP_MIN) {
        prev.end = l.end;
        prev.to = l.to;
      } else legs.push({ start: l.start, end: l.end, label: l.flight, from: l.from, to: l.to, kind: l.kind });
    }
    const stays = timeline.stays.filter(inside);
    const waits: TimelineSpan[] = [];
    for (let i = 0; i + 1 < legs.length; i++) {
      const [a, b] = [legs[i], legs[i + 1]];
      // A layover starts a little after landing and ends at pickup, before the next takeoff: any layover inside the gap makes it one.
      if (b.start > a.end && !stays.some((s) => s.start < b.start && s.end > a.end)) waits.push({ start: a.end, end: b.start });
    }
    return { trip, legs, stays, waits };
  });
}

export interface LabelSpot {
  /** Left edge, px. */
  x: number;
  /** 0 is the lane nearest the route. */
  lane: number;
}

/**
 * Words laid in `lanes` rows so none touches another: each centred on where it belongs (`at`, px) when it can be, in
 * the nearest lane that's free there, else moved along in whichever lane leaves it closest. Returned in the order given.
 */
export function laneLabels(items: { at: number; width: number }[], lanes: number, maxRight: number, gap = 4): LabelSpot[] {
  const right = Array<number>(lanes).fill(-Infinity);
  const out: LabelSpot[] = new Array(items.length);
  const order = items.map((_, i) => i).sort((a, b) => items[a].at - items[b].at);
  for (const i of order) {
    const { at, width } = items[i];
    const want = Math.min(Math.max(at - width / 2, 0), Math.max(maxRight - width, 0));
    let lane = right.findIndex((r) => want >= r + gap);
    if (lane < 0) lane = right.indexOf(Math.min(...right));
    const x = Math.max(want, right[lane] + gap);
    right[lane] = x + width;
    out[i] = { x, lane };
  }
  return out;
}
