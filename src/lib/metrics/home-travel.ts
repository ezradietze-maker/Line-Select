import { coordinatesForAirport } from "@/lib/airport-coordinates";
import type { TripFacts } from "@/lib/metrics/trip-facts";

/**
 * Door-to-door time away for a pilot who doesn't live at base. A trip's
 * printed time away (TAFB) runs base to base; a commuter's real time away
 * runs from leaving home to getting back. Two things change it:
 *
 * - Commuting: a trip that starts or ends with operated flying at base
 *   means getting to base before the report (with the buffer the pilot
 *   keeps) and home again after.
 * - Deviating: a trip that starts with a deadhead can often be joined by
 *   flying from home straight to where the flying starts, arriving with the
 *   buffer the pilot wants before the first operated leg; one that ends with
 *   a deadhead can be left after the last operated leg and the rest the
 *   pilot wants. The pilot picks whichever gets him out later and home
 *   sooner.
 *
 * Travel time comes from a `TravelTimeProvider` — an estimate from real
 * airport distances — except where real airline schedules have been looked
 * up for the trip (`RealTravel`): then the last flight that still makes it,
 * and the first flight home.
 */

export interface TravelTimeProvider {
  /** Hours door-gate to gate from `from` to `to`, or null when unknown. */
  hours(from: string, to: string): number | null;
}

const EARTH_KM = 6371;
export function distanceKm(a: string, b: string): number | null {
  const pa = coordinatesForAirport(a);
  const pb = coordinatesForAirport(b);
  if (!pa || !pb) return null;
  const [lat1, lon1] = pa.map((x) => (x * Math.PI) / 180);
  const [lat2, lon2] = pb.map((x) => (x * Math.PI) / 180);
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/**
 * Distance-based estimate: cruise at ~800 km/h plus an hour of taxi and
 * airport, and two more for a connection on anything past ~2,500 km (most
 * long trips from a secondary airport connect). A stand-in until real
 * schedules are wired; labelled as an estimate wherever it's shown.
 */
export const estimatedTravel: TravelTimeProvider = {
  hours(from, to) {
    if (from === to) return 0;
    const km = distanceKm(from, to);
    if (km === null) return null;
    return 1 + km / 800 + (km > 2500 ? 2 : 0);
  },
};

export interface HomeParams {
  homeAirports: string[];
  /** Hours a commuter arrives at base ahead of the report. */
  commuteBufferHours: number;
  /** Hours ahead of the first operated leg when deviating on a front-end deadhead (backup flights and rest). */
  frontBufferHours: number;
  /** Rest after the last operated leg before heading home on a back-end deviation. */
  backRestHours: number;
}

export const DEFAULT_HOME_PARAMS: Omit<HomeParams, "homeAirports"> = { commuteBufferHours: 10, frontBufferHours: 12, backRestHours: 10 };

function bestTravel(provider: TravelTimeProvider, homes: string[], city: string, toHome: boolean): number | null {
  const hs = homes.map((h) => (toHome ? provider.hours(city, h) : provider.hours(h, city))).filter((x): x is number => x !== null);
  return hs.length ? Math.min(...hs) : null;
}

/**
 * Real airline times for one trip, in minutes on the trip's own clock (0 = first report at base): the last departure
 * from home that still makes it (to base, or straight to where the flying starts) and the first arrival home (from base,
 * or from where the flying ends). Undefined = not looked up (estimate instead); null = looked up, and no airline flight
 * makes it (a deviation that can't be done; to or from base, the estimate stands in — there's always the jumpseat).
 */
export interface RealTravel {
  leaveBase?: number | null;
  leaveDeviate?: number | null;
  homeBase?: number | null;
  homeDeviate?: number | null;
}

export interface HomeAway {
  /** Hours from leaving home to getting back, door to door (gate to gate). */
  awayHours: number;
  /** When he leaves home and gets back, in minutes on the trip's own clock (0 = first report at base; leaving is usually negative). */
  leaveMinute: number;
  backMinute: number;
  /** How each end was handled — for explanations. */
  start: "base" | "deviate";
  end: "base" | "deviate";
}

/** Door-to-door hours away for one trip; null when the pilot's home or the trip's cities can't be placed. Minutes are on the trip's own clock (0 = first report at base). */
export function homeAwayForTrip(f: TripFacts, base: string, params: HomeParams, provider: TravelTimeProvider = estimatedTravel, real: RealTravel = {}): HomeAway | null {
  if (params.homeAirports.length === 0) return null;
  const lastLeg = f.legs[f.legs.length - 1];
  const tripEnd = lastLeg ? lastLeg.end : f.tafbHours * 60;

  const toBase = bestTravel(provider, params.homeAirports, base, false);
  const fromBase = bestTravel(provider, params.homeAirports, base, true);
  if (toBase === null || fromBase === null) return null;

  // Leaving: commute to base for the report, or fly straight to where the flying starts.
  const leaveViaBase = real.leaveBase ?? -(params.commuteBufferHours + toBase) * 60;
  let leave = leaveViaBase;
  let start: HomeAway["start"] = "base";
  if (f.front && f.front.city && f.front.slackHours !== null && f.front.legs.length) {
    const t = bestTravel(provider, params.homeAirports, f.front.city, false);
    if (t !== null && real.leaveDeviate !== null) {
      // Must be there before the first operated leg — or before any standby ahead of it (see TripFacts.front).
      const needAt = f.front.legs[f.front.legs.length - 1].end + f.front.slackHours * 60;
      const leaveDeviating = real.leaveDeviate ?? needAt - (params.frontBufferHours + t) * 60;
      if (leaveDeviating > leave) {
        leave = leaveDeviating;
        start = "deviate";
      }
    }
  }

  // Coming home: the scheduled trip back to base then the commute, or straight home after the last operated leg.
  let back = real.homeBase ?? tripEnd + fromBase * 60;
  let end: HomeAway["end"] = "base";
  if (f.back && f.back.city && f.back.slackHours !== null && f.back.legs.length) {
    const t = bestTravel(provider, params.homeAirports, f.back.city, true);
    if (t !== null && real.homeDeviate !== null) {
      // Free once the flying and any standby after it are done (see TripFacts.back).
      const freeAt = f.back.legs[0].start - f.back.slackHours * 60;
      const homeDeviating = real.homeDeviate ?? freeAt + (params.backRestHours + t) * 60;
      if (homeDeviating < back) {
        back = homeDeviating;
        end = "deviate";
      }
    }
  }

  return { awayHours: Math.max(0, back - leave) / 60, leaveMinute: leave, backMinute: back, start, end };
}
