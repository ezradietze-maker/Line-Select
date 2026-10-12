/**
 * Static audit of everything the commute-flight lookup builds on, across
 * every bid pack in `.cache/packs` — no flight data, no cost:
 *
 * 1. Trip placement: each trip's real start (bid period + calendar day +
 *    printed report time) against the GMT time printed on every leg, the
 *    local time printed beside it, and the line's own days-off grid.
 * 2. Leg classification: every leg is FedEx, an airline deadhead, ground,
 *    or standby — anything else is listed.
 * 3. FedEx flights for the jumpseat: placement, block time, plausible speed,
 *    and one consistent time per flight per day.
 * 4. Runs of a pairing: one schedule per travel key.
 * 5. Travel questions: every placeable trip asks the right ones, with sane
 *    windows; trips that can't be placed are counted, with why.
 * 6. Airports: every one has a time zone and coordinates.
 *
 * Usage: npx tsx scripts/audit/flights-static.ts [home airports, default DEN]
 */
import { readdirSync, readFileSync } from "node:fs";
import { DateTime } from "luxon";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { expandBidPack } from "@/lib/bidpack-storage";
import { isCompanyFlight, jumpseatFlights } from "@/lib/flights/jumpseat";
import { travelKey, travelNeedsForTrip, tripStartUtc } from "@/lib/flights/needs";
import { distanceKm } from "@/lib/metrics/home-travel";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import type { TripLeg } from "@/types/bidpack";

const homes = (process.argv[2] ?? "DEN").split(",");
const DIR = ".cache/packs";
const hhmm = (ms: number, zone = "UTC") => DateTime.fromMillis(ms, { zone }).toFormat("HHmm");
const minutesApart = (a: string, b: string) => {
  const d = Math.abs(Number(a.slice(0, 2)) * 60 + Number(a.slice(2)) - (Number(b.slice(0, 2)) * 60 + Number(b.slice(2))));
  return Math.min(d, 1440 - d);
};
const kindOf = (l: TripLeg) =>
  l.isStandby ? "standby" : isCompanyFlight(l) ? "fedex" : l.equipment === "CAB" || /^GT/.test(l.flightNumber) ? "ground" : /^[A-Z0-9]{2}\d{1,4}$/.test(l.flightNumber) && l.isDeadhead ? "airline" : "OTHER";

const totals: Record<string, number> = {};
const bump = (k: string, n = 1) => (totals[k] = (totals[k] ?? 0) + n);
const examples: Record<string, string[]> = {};
const note = (k: string, s: string) => {
  bump(k);
  if ((examples[k] ??= []).length < 6) examples[k].push(s);
};
const airportsNoZone = new Set<string>();
const airportsNoCoords = new Set<string>();

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
  const pack = expandBidPack(JSON.parse(readFileSync(`${DIR}/${file}`, "utf8")));
  const tag = file.replace(".json", "");
  const byKey = new Map<string, string>();
  let trips = 0;
  for (const line of pack.lines) {
    for (const trip of line.trips) {
      trips++;
      bump("trips");
      if (line.estimated) {
        bump("trips on estimated lines (not looked up)");
        continue;
      }
      if (trip.schedule.length === 0) {
        bump("trips with no schedule (not looked up)");
        continue;
      }
      const start = tripStartUtc(pack, trip);
      if (start === null) {
        note("trips that can't be placed in time", `${tag} line ${line.lineNumber} ${trip.id} startDay=${trip.startDayIndex} report=${trip.schedule[0]?.reportTimeLocal}`);
        continue;
      }
      bump("trips placed");

      // 4. One schedule per run of a pairing.
      const sig = trip.schedule.flatMap((d) => d.legs.map((l) => `${l.flightNumber}${l.depAirport}${l.startMinutes}`)).join(",");
      const prev = byKey.get(travelKey(trip));
      if (prev !== undefined && prev !== sig) note("travel-key collisions (same run, different schedule)", `${tag} ${travelKey(trip)} line ${line.lineNumber}`);
      byKey.set(travelKey(trip), sig);

      // 1. Placement against the printed GMT and local times.
      for (const d of trip.schedule)
        for (const l of d.legs) {
          bump("legs checked");
          for (const a of [l.depAirport, l.arrAirport]) {
            if (!timezoneForAirport(a)) airportsNoZone.add(a);
            if (!coordinatesForAirport(a)) airportsNoCoords.add(a);
          }
          const dep = start + l.startMinutes * 60_000;
          const arr = start + l.endMinutes * 60_000;
          if (/^\d{4}$/.test(l.depTimeGmt) && minutesApart(hhmm(dep), l.depTimeGmt) > 1)
            note("legs whose departure is off the printed GMT", `${tag} line ${line.lineNumber} ${trip.id}@${trip.startDayIndex} ${l.flightNumber} ${l.depAirport} printed ${l.depTimeGmt}Z, placed ${hhmm(dep)}Z`);
          if (/^\d{4}$/.test(l.arrTimeGmt) && minutesApart(hhmm(arr), l.arrTimeGmt) > 1)
            note("legs whose arrival is off the printed GMT", `${tag} line ${line.lineNumber} ${trip.id}@${trip.startDayIndex} ${l.flightNumber} ${l.arrAirport} printed ${l.arrTimeGmt}Z, placed ${hhmm(arr)}Z`);
          const zone = timezoneForAirport(l.depAirport);
          if (zone && /^\d{4}$/.test(l.depTimeLocal) && minutesApart(hhmm(dep, zone), l.depTimeLocal) > 1)
            note("legs whose departure is off the printed local time", `${tag} ${l.flightNumber} ${l.depAirport} printed ${l.depTimeLocal} local, placed ${hhmm(dep, zone)} (${zone})`);
          // 2. Classification.
          const k = kindOf(l);
          bump(`legs: ${k}`);
          if (k === "OTHER") note("legs that are none of FedEx / airline / ground / standby", `${tag} ${l.flightNumber} ${l.equipment} ${l.depAirport}-${l.arrAirport} DH=${l.isDeadhead}`);
          if (k === "fedex" && l.blockHours !== null && Math.abs((l.endMinutes - l.startMinutes) / 60 - l.blockHours) > 0.1)
            note("FedEx legs whose times disagree with their block", `${tag} ${l.flightNumber} ${l.depAirport}-${l.arrAirport} block ${l.blockHours} vs ${(l.endMinutes - l.startMinutes) / 60}`);
        }

      // 1b. The trip's days against the line's own days-off grid.
      if (line.gridOffDays && trip.startDayIndex !== null) {
        const off = new Set(line.gridOffDays);
        for (let i = 0; i < trip.days; i++)
          if (off.has(trip.startDayIndex + i)) {
            note("trips that land on a day the line's grid shows off", `${tag} line ${line.lineNumber} ${trip.id}@${trip.startDayIndex} day ${trip.startDayIndex + i}`);
            break;
          }
      }

      // 5. Travel questions.
      const needs = travelNeedsForTrip(pack, trip, { homeAirports: homes, commuteBufferHours: 10, frontBufferHours: 12, backRestHours: 10 });
      const f = computeTripFacts(trip);
      const kinds = new Set(needs.map((n) => n.kind));
      if (!homes.includes(pack.base) && f.legs.length + f.duties.flatMap((d) => d.standbyLegs).length > 0) {
        if (!kinds.has("toBase") || !kinds.has("homeFromBase")) note("trips missing a to-base or home-from-base question", `${tag} ${travelKey(trip)} has ${[...kinds].join(",")}`);
        if (f.front?.city && f.legs.some((l) => !l.deadhead) && !homes.includes(f.front.city) && !kinds.has("deviateOut")) note("front-deadhead trips with no straight-to question", `${tag} ${travelKey(trip)} ${f.front.city}`);
      }
      for (const n of needs) {
        bump(`questions: ${n.kind}`);
        const bad =
          n.departBefore <= n.departAfter ||
          n.departBefore - n.departAfter > 48 * 3600_000 ||
          (n.arriveBy !== undefined && n.arriveBy !== n.departBefore) ||
          (n.kind === "toBase" && n.arriveBy! > start) ||
          (n.kind === "deviateOut" && n.arriveBy! > start + (f.legs.find((l) => !l.deadhead)?.start ?? 0) * 60_000) ||
          (n.kind === "homeFromBase" && n.departAfter < start);
        if (bad) note("questions with a bad window", `${tag} ${n.id} after ${new Date(n.departAfter).toISOString()} before ${new Date(n.departBefore).toISOString()} by ${n.arriveBy && new Date(n.arriveBy).toISOString()}`);
      }
    }
  }

  // 3. FedEx flights for the jumpseat.
  const fx = jumpseatFlights(pack);
  bump("FedEx flights (distinct departures)", fx.length);
  const sameDay = new Map<string, number[]>();
  for (const f of fx) {
    const km = distanceKm(f.from, f.to);
    const hours = (f.arr - f.dep) / 3600_000;
    // Block time includes taxi: a short hop is slow on paper, so the floor only applies to real distance.
    if (km !== null && ((km > 800 && km / hours < 350) || km / hours > 1050)) note("FedEx flights at an implausible speed", `${tag} ${f.n} ${f.from}-${f.to} ${km.toFixed(0)}km in ${hours.toFixed(2)}h`);
    const key = `${f.n}|${f.from}|${DateTime.fromMillis(f.dep, { zone: "UTC" }).toISODate()}`;
    (sameDay.get(key) ?? sameDay.set(key, []).get(key)!).push(f.dep);
  }
  for (const [k, deps] of sameDay)
    if (new Set(deps).size > 1 && Math.max(...deps) - Math.min(...deps) < 6 * 3600_000) note("FedEx flights with two different times the same day", `${tag} ${k} ${deps.map((d) => hhmm(d)).join("/")}Z`);
  console.log(`${tag.padEnd(22)} ${pack.lines.length} lines, ${trips} trips, ${fx.length} FedEx departures`);
}

console.log("\nTotals:");
for (const [k, v] of Object.entries(totals).sort()) console.log(`  ${k}: ${v}`);
console.log("\nAirports with no time zone:", [...airportsNoZone].join(" ") || "none");
console.log("Airports with no coordinates:", [...airportsNoCoords].join(" ") || "none");
for (const [k, xs] of Object.entries(examples)) console.log(`\n${k} — e.g.\n  ${xs.join("\n  ")}`);
