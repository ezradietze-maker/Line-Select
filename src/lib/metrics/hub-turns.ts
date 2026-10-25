import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { tripStartUtc } from "@/lib/flights/needs";
import type { BidPack, Trip } from "@/types/bidpack";

/**
 * Hub turns, the way pilots mean them (as the ex-pilot defined them, Oct 21 2026): an operated leg into a sort hub, a
 * scheduled sit while the packages are sorted and loaded, then an operated leg out to an outstation. The two legs can go
 * back and forth between the same two airports or to different ones (PHX–MEM, hub turn, MEM–DFW).
 *
 * A pack prints a hub turn in more than one way: inside one duty line (DFW → IND 00:59 · IND 03:35 → DFW), across two
 * duty lines with no layover between them (DFW → MEM 00:33, then MEM 02:30 → DFW), and even across two pairings flown
 * back to back. So hub turns are found on the line's whole run of legs, in time order: an operated leg into a hub, a
 * sit with no hotel layover, then an operated leg back out of the same hub.
 *
 * What pilots feel about them depends on the kind (in his telling: one night hub turn inside an easy trip is fine; four
 * nights of them in a row is hard going; two weeks back to back wrecks the body clock):
 * - a **night** hub turn sits through the small hours, the back-of-the-clock kind;
 * - a **week of night hub turns** is three or more nights of them in a row;
 * - a **crew-rest** hub turn has the short airport hotel the contract gives on sits over about 4 hours — some pilots
 *   like the nap, he found the leg after it felt like a whole extra duty period.
 */

/** The sort hubs he named. GSO he wasn't sure of; the sweep of every October pack found no hub outside this list. */
export const SORT_HUBS = ["MEM", "IND", "OAK", "EWR", "AFW", "GSO", "ANC", "CDG", "CAN"];
/** A stop shorter than this isn't a sort; longer than this, it's a layover however the pack prints it. */
export const HUB_SIT_MIN_HOURS = 0.5;
export const HUB_SIT_MAX_HOURS = 8;
/** A hub turn whose sit reaches into these local hours is a night hub turn. */
export const NIGHT_FROM_HOUR = 0;
export const NIGHT_TO_HOUR = 5;
/** This many nights of night hub turns in a row is a week of them. */
export const WEEK_OF_NIGHTS = 3;

const HOUR = 3_600_000;

export interface HubTurn {
  hub: string;
  /** Block-in at the hub and block-off back out (ms, UTC). */
  arrive: number;
  depart: number;
  sitHours: number;
  night: boolean;
  /** The short airport hotel for a nap on the sit, as the pack prints it; null without one. */
  restHotel: string | null;
  /** The local date the night began on (a 00:33–02:30 sit belongs to the evening before); for counting nights in a row. */
  nightOf: string;
  /** Where the flying came from and goes to, and the trips (by pairing number) the two legs belong to. */
  from: string;
  to: string;
  inTrip: string;
  outTrip: string;
}

interface TimedLeg {
  from: string;
  to: string;
  dep: number;
  arr: number;
  deadhead: boolean;
  /** A hotel layover follows this leg. */
  restAfter: boolean;
  dayRoom: string | null;
  trip: string;
}

/** The line's trips as one run of legs in time order (trips the pack can't place on a date are left out). */
function timedLegs(trips: Trip[], ctx: Pick<BidPack, "bidPeriodStart" | "base">): TimedLeg[] {
  const out: TimedLeg[] = [];
  for (const t of trips) {
    const start = tripStartUtc(ctx, t);
    if (start === null) continue;
    for (const d of t.schedule) {
      const legs = d.legs.filter((l) => !l.isStandby);
      legs.forEach((l, i) =>
        out.push({
          from: l.depAirport,
          to: l.arrAirport,
          dep: start + l.startMinutes * 60_000,
          arr: start + l.endMinutes * 60_000,
          deadhead: l.isDeadhead,
          restAfter: i === legs.length - 1 && !!d.layover,
          dayRoom: l.dayRoomHotel ?? null,
          trip: t.pairingNumber ?? t.id,
        })
      );
    }
  }
  return out.sort((a, b) => a.dep - b.dep);
}

/** Every hub turn on a line (or on one trip, given just that trip), in time order. */
export function hubTurnsOf(trips: Trip[], ctx: Pick<BidPack, "bidPeriodStart" | "base">, hubs: readonly string[] = SORT_HUBS): HubTurn[] {
  const legs = timedLegs(trips, ctx);
  const out: HubTurn[] = [];
  for (let i = 0; i + 1 < legs.length; i++) {
    const a = legs[i];
    const b = legs[i + 1];
    if (a.deadhead || b.deadhead || a.restAfter || !hubs.includes(a.to) || b.from !== a.to) continue;
    const sitHours = (b.dep - a.arr) / HOUR;
    if (sitHours < HUB_SIT_MIN_HOURS || sitHours > HUB_SIT_MAX_HOURS) continue;
    const zone = timezoneForAirport(a.to) ?? "UTC";
    let night = false;
    for (let t = a.arr; t <= b.dep && !night; t += 15 * 60_000) {
      const h = DateTime.fromMillis(t, { zone }).hour;
      night = h >= NIGHT_FROM_HOUR && h < NIGHT_TO_HOUR;
    }
    out.push({
      hub: a.to,
      arrive: a.arr,
      depart: b.dep,
      sitHours,
      night,
      restHotel: a.dayRoom,
      nightOf: DateTime.fromMillis(a.arr, { zone }).minus({ hours: 12 }).toISODate() ?? "",
      from: a.from,
      to: b.to,
      inTrip: a.trip,
      outTrip: b.trip,
    });
  }
  return out;
}

export interface HubTurnSummary {
  all: number;
  night: number;
  day: number;
  withRestHotel: number;
  /** Night hub turns that come in runs of `WEEK_OF_NIGHTS` or more nights in a row. */
  inWeeks: number;
  /** Most nights of night hub turns in a row. */
  longestRun: number;
  /** The hubs, most used first. */
  hubs: string[];
}

export function summarizeHubTurns(turns: HubTurn[]): HubTurnSummary {
  const nights = [...new Set(turns.filter((t) => t.night).map((t) => t.nightOf))].sort();
  let longestRun = 0;
  let inWeeks = 0;
  let run: string[] = [];
  const close = () => {
    longestRun = Math.max(longestRun, run.length);
    if (run.length >= WEEK_OF_NIGHTS) inWeeks += turns.filter((t) => t.night && run.includes(t.nightOf)).length;
    run = [];
  };
  for (const d of nights) {
    if (run.length && DateTime.fromISO(d).diff(DateTime.fromISO(run[run.length - 1]), "days").days !== 1) close();
    run.push(d);
  }
  close();
  const count = new Map<string, number>();
  for (const t of turns) count.set(t.hub, (count.get(t.hub) ?? 0) + 1);
  return {
    all: turns.length,
    night: turns.filter((t) => t.night).length,
    day: turns.filter((t) => !t.night).length,
    withRestHotel: turns.filter((t) => t.restHotel).length,
    inWeeks,
    longestRun,
    hubs: [...count].sort((a, b) => b[1] - a[1]).map(([h]) => h),
  };
}

/** "Hub turns ×4 · IND, nights · with crew-rest hotel" — how a trip or line is labelled; null without hub turns. */
export function hubTurnLabel(s: HubTurnSummary): string | null {
  if (!s.all) return null;
  const when = s.night === s.all ? "nights" : s.night ? `${s.night} at night` : "by day";
  return `Hub turns ×${s.all} · ${s.hubs.join(", ")}, ${when}${s.withRestHotel ? ` · ${s.withRestHotel === s.all ? "with" : `${s.withRestHotel} with`} crew-rest hotel` : ""}`;
}
