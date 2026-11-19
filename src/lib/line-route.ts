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

// ---- The Timeline as the month calendar draws it: each duty's route over its flying ----

/** An airport in a duty's route, magenta on the calendar when only deadheads touch it there. */
export interface RouteCity {
  code: string;
  deadhead: boolean;
}

/** One duty period as the Timeline labels it: where it flies ("MEM-IND-DFW"), over the flying it holds. */
export interface DutyRoute extends TimelineSpan {
  /** The flying inside it, first takeoff to last landing. */
  flyStart: number;
  flyEnd: number;
  cities: RouteCity[];
  /** Hotel standby and nothing else: the calendar's violet line, labelled as the pack prints it. */
  standby: boolean;
}

/** Each duty period with legs, in time order, and the airports it flies through, each once where the route passes it. */
export function dutyRoutes(timeline: LineTimeline): DutyRoute[] {
  return timeline.duties.flatMap((duty) => {
    const legs = timeline.legs.filter((l) => l.start >= duty.start - 1 && l.end <= duty.end + 1).sort((a, b) => a.start - b.start);
    if (!legs.length) return [];
    const standby = legs.every((l) => l.kind === "standby");
    const cities: RouteCity[] = [];
    // Every leg that touches each stop: a stop only deadheads touch is a deadhead's.
    const touched: TimelineLeg["kind"][][] = [];
    const visit = (code: string, kind: TimelineLeg["kind"], fresh: boolean) => {
      if (fresh || cities.at(-1)?.code !== code) {
        cities.push({ code, deadhead: false });
        touched.push([]);
      }
      touched.at(-1)!.push(kind);
    };
    legs.forEach((l, i) => {
      visit(l.from, l.kind, i === 0);
      visit(l.to, l.kind, false);
    });
    cities.forEach((c, i) => (c.deadhead = touched[i].every((k) => k === "deadhead")));
    return [{ start: duty.start, end: duty.end, flyStart: legs[0].start, flyEnd: Math.max(...legs.map((l) => l.end)), cities: standby ? cities.slice(0, 1) : cities, standby }];
  });
}

/**
 * A duty's route said in less room, longest first: every stop ("MEM-IND-DFW"), where it starts and ends ("MEM-DFW"),
 * where it ends ("DFW"). A duty back where it started ("DFW-IND-DFW", a hub turn) says where it turns ("IND") instead.
 * Hotel standby is "HSBY" and its airport.
 */
export function routeTextVariants(route: Pick<DutyRoute, "cities" | "standby">): RouteCity[][] {
  if (route.standby) return [[{ code: "HSBY", deadhead: false }, ...route.cities], [{ code: "HSBY", deadhead: false }]];
  const { cities } = route;
  const first = cities[0];
  const last = cities[cities.length - 1];
  const out: RouteCity[][] = [cities];
  if (cities.length > 2 && first.code === last.code) out.push([cities[1]]);
  else {
    if (cities.length > 2) out.push([first, last]);
    if (cities.length > 1) out.push([last]);
  }
  return out;
}

/** "MEM-IND-DFW". */
export const routeText = (cities: RouteCity[]) => cities.map((c) => c.code).join("-");

export interface VariantSpot extends LabelSpot {
  /** Which of the item's words it got, 0 the longest. */
  variant: number;
}

/**
 * Words laid in `lanes` rows, as `laneLabels`, but each item says less rather than move far from where it belongs: it
 * takes its longest words that fit within `maxShift` px of their place in any lane, nearest lane first, and is left
 * off (null) when even its shortest don't — as the calendar leaves off a city it has no room for.
 */
export function placeVariants(items: { at: number; widths: number[] }[], lanes: number, maxRight: number, maxShift: number, gap = 4): (VariantSpot | null)[] {
  const right = Array<number>(lanes).fill(-Infinity);
  const out: (VariantSpot | null)[] = new Array(items.length).fill(null);
  const order = items.map((_, i) => i).sort((a, b) => items[a].at - items[b].at);
  for (const i of order) {
    const { at, widths } = items[i];
    placing: for (let v = 0; v < widths.length; v++) {
      const width = widths[v];
      const want = Math.min(Math.max(at - width / 2, 0), Math.max(maxRight - width, 0));
      for (let lane = 0; lane < lanes; lane++) {
        const x = Math.max(want, right[lane] + gap);
        if (x - want <= maxShift && x + width <= maxRight + 0.5) {
          right[lane] = x + width;
          out[i] = { x, lane, variant: v };
          break placing;
        }
      }
    }
  }
  return out;
}
