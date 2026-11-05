import { DateTime } from "luxon";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import { sunTimes } from "@/lib/sun-times";
import { tripReportUtc } from "@/lib/trip-anchor";
import type { BidPack } from "@/types/bidpack";

/**
 * A layover city as the pack lays it out: every stay there — which trip, which lines fly it, when it lands, how long,
 * how many full days — plus what the city's clock and sky are doing. Read from the pack alone.
 */

export interface CityStay {
  tripNumber: string | null;
  /** The lines that fly this trip, by number. */
  lineNumbers: string[];
  /** Block-in there (ms, UTC); null when the trip can't be placed on its date. */
  arrive: number | null;
  hours: number;
  fullDays: number;
  hotel: string | null;
}

/** Every distinct stay in a city — one per trip as flown on its date — earliest first. */
export function cityStays(pack: Pick<BidPack, "lines" | "bidPeriodStart" | "base">, code: string): CityStay[] {
  const byTrip = new Map<string, CityStay[]>();
  for (const line of pack.lines) {
    for (const trip of line.trips) {
      const key = `${trip.pairingNumber ?? trip.id}|${trip.startDayIndex}`;
      const known = byTrip.get(key);
      if (known) {
        for (const s of known) if (!s.lineNumbers.includes(line.lineNumber)) s.lineNumbers.push(line.lineNumber);
        continue;
      }
      const report = tripReportUtc(pack, trip);
      const facts = computeTripFacts(trip);
      const stays = facts.layovers
        .filter((l) => l.city === code)
        .map((l) => ({ tripNumber: trip.pairingNumber, lineNumbers: [line.lineNumber], arrive: report === null ? null : report + l.start * 60_000, hours: l.hours, fullDays: l.fullDays, hotel: l.hotel }));
      byTrip.set(key, stays);
    }
  }
  return [...byTrip.values()].flat().sort((a, b) => (a.arrive ?? Infinity) - (b.arrive ?? Infinity));
}

/** Hours a city's clock is ahead of (or behind, negative) the base's, at an instant. */
export function hoursFromBase(code: string, base: string, at: number = Date.now()): number | null {
  const zone = timezoneForAirport(code);
  const home = timezoneForAirport(base);
  if (!zone || !home) return null;
  return (DateTime.fromMillis(at, { zone }).offset - DateTime.fromMillis(at, { zone: home }).offset) / 60;
}

/** "+3h", "−5h", "same time", "+5½h" — how a pilot says a time difference. */
export function offsetWords(hours: number | null): string {
  if (hours === null) return "";
  if (hours === 0) return "same time as base";
  const whole = Math.trunc(Math.abs(hours));
  const half = Math.abs(hours) % 1 >= 0.5 ? "½" : Math.abs(hours) % 1 >= 0.25 ? "¼" : "";
  return `${hours > 0 ? "+" : "−"}${whole}${half}h from base`;
}

/** A city's sunrise and sunset on a local date, as local clock times ("07:12"), with the hours of daylight. */
export function cityDaylight(code: string, localDate: string): { sunrise: string; sunset: string; hours: number } | null {
  const at = coordinatesForAirport(code);
  const zone = timezoneForAirport(code);
  if (!at || !zone) return null;
  const t = sunTimes(new Date(`${localDate}T12:00:00Z`), at[0], at[1]);
  if (!t) return null;
  const clock = (ms: number) => DateTime.fromMillis(ms, { zone }).toFormat("HH:mm");
  return { sunrise: clock(t.sunrise), sunset: clock(t.sunset), hours: (t.sunset - t.sunrise) / 3_600_000 };
}
