/**
 * Audit of every trip a pilot can open on the rankings page, against the bid
 * pack PDF itself. For every pack in `.cache/packs` (both seats), every line,
 * every trip:
 *
 * 1. Source: the pairing's rows straight from the PDF text (`.cache/raw`,
 *    written by dump-pairings.ts), read here independently of the app's
 *    parser — every leg (flight, airports, both clocks, equipment), every
 *    layover (after which leg, city, length), every hotel and ride (which
 *    layover, or a day room between legs of one duty), every deadhead.
 * 2. The app's trip matches it exactly.
 * 3. What the trip view draws holds together: each flight at its printed
 *    local time, each layover between the right flights in the right city,
 *    nothing overlapping, no long "ground" or "connection" stretch where a
 *    layover belongs, every trip with its detail.
 *
 * Usage: npx tsx scripts/audit/trips.ts [pack filter]
 */
import { readdirSync, readFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { buildLineMonthCalendar } from "@/lib/line-month";
import { tripReportUtc } from "@/lib/trip-anchor";
import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { buildHomeDays, buildRawSegments, buildTimelineDays } from "@/lib/trip-timeline";
import type { BidPack, Trip } from "@/types/bidpack";

const filter = process.argv[2] ?? "";
const totals: Record<string, number> = {};
const bump = (k: string, n = 1) => (totals[k] = (totals[k] ?? 0) + n);
const examples: Record<string, string[]> = {};
const note = (k: string, s: string) => {
  bump(k);
  if ((examples[k] ??= []).length < 10) examples[k].push(s);
};

// ---------------------------------------------------------------------------
// The PDF's own pairing blocks, read independently.
// ---------------------------------------------------------------------------

interface RawLeg {
  flight: string;
  eqp: string;
  dep: string;
  depGmt: string;
  depLocal: string;
  arr: string;
  arrGmt: string;
  arrLocal: string;
  layover: { city: string; hours: string } | null;
  /** Hotel and ride lines printed after this leg, before the next one. */
  hotels: { name: string; city: string }[];
  transTo: string | null;
  transFrom: string | null;
  /** When the pack splits them by trip date ("OCT 02 - 23 TRIP(S) ONLY"): each dated version. */
  dated: { from: number; to: number; hotels: { name: string; city: string }[]; transTo: string | null; transFrom: string | null }[];
}
interface RawPairing {
  page: number;
  seq: string;
  legs: RawLeg[];
}

const HEADER = /^(\d+)\s+((?:[A-Z]{2}\s+)*[A-Z]{2})\s+REPORT\s+AT\s+(\d{3,4})\s*\(/;
const FOOTER = /^LDGS:/;
const TIME = /^(\d{4})\([*#]?(\d{4})\)$/;

/** Pairings by page and sequence number; a pairing whose header sits at the bottom of a page carries on at the top of the next. */
function readRaw(file: string): Map<string, RawPairing[]> {
  const lines = readFileSync(file, "utf8").split("\n");
  const out = new Map<string, RawPairing[]>();
  let page = 0;
  let cur: RawPairing | null = null;
  for (const line of lines) {
    const pm = /^=== PAGE (\d+)/.exec(line);
    if (pm) {
      page = Number(pm[1]);
      continue;
    }
    if (/BID PACK PAIRING SCHEDULE|^Produced on/.test(line)) continue;
    const h = HEADER.exec(line);
    if (h) {
      cur = { page, seq: h[1], legs: [] };
      const key = `${page}|${h[1]}`;
      out.set(key, [...(out.get(key) ?? []), cur]);
      continue;
    }
    if (!cur) continue;
    if (FOOTER.test(line)) {
      cur = null;
      continue;
    }
    const t = line.trim().split(/\s+/);
    // A leg: day, flight, [eqp], dep, time, arr, time, block…
    const ground = /^[A-Z]{3,8}$/.test(t[1] ?? "") && /^[A-Z]{3}$/.test(t[2] ?? "");
    const b = ground ? 2 : 3;
    const dep = TIME.exec(t[b + 1] ?? "");
    const arr = TIME.exec(t[b + 3] ?? "");
    if (t.length >= 6 && /^[A-Z]{3}$/.test(t[b] ?? "") && dep && /^[A-Z]{3}$/.test(t[b + 2] ?? "") && arr) {
      const n = t.length;
      const layover =
        /^[A-Z]{3}$/.test(t[n - 2]) && /^\d{1,3}:\d{2}$/.test(t[n - 1]) && /^\d{1,3}:\d{2}$/.test(t[n - 3]) ? { city: t[n - 2], hours: t[n - 1] } : null;
      cur.legs.push({
        flight: t[1],
        eqp: ground ? "" : t[2],
        dep: t[b],
        depGmt: dep[1],
        depLocal: dep[2],
        arr: t[b + 2],
        arrGmt: arr[1],
        arrLocal: arr[2],
        layover,
        hotels: [],
        transTo: null,
        transFrom: null,
        dated: [],
      });
      continue;
    }
    const last = cur.legs.at(-1);
    if (!last) continue;
    const range = /^([A-Z]{3})\s+(\d{1,2})(?:\s*-\s*(?:([A-Z]{3})\s+)?(\d{1,2}))?\s+TRIP\(S\)\s+ONLY/.exec(line);
    if (range) {
      const mon = (x: string) => ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(x) + 1;
      const from = mon(range[1]) * 100 + Number(range[2]);
      last.dated.push({ from, to: range[4] ? mon(range[3] ?? range[1]) * 100 + Number(range[4]) : from, hotels: [], transTo: null, transFrom: null });
      continue;
    }
    const into = last.dated.at(-1) ?? last;
    const hotel = /^Hotel:\s*(.+?)\s*\(([A-Z]{3})\)/.exec(line);
    if (hotel) into.hotels.push({ name: hotel[1].replace(/\s*\d[\d\s\-()/]{5,}$/, "").trim(), city: hotel[2] });
    const trans = /^Trans\s+(To|From):\s*(.+?)\s*\(([A-Z]{3})\)/.exec(line);
    if (trans) {
      if (trans[1] === "To") into.transTo = trans[2].trim();
      else into.transFrom = trans[2].trim();
    }
  }
  return out;
}

const RAW_FOR: Record<string, string> = {};
for (const f of readdirSync(".cache/raw").filter((f) => f.endsWith(".txt"))) {
  const m = /2026_Oct_(\w+)_(\w+)\.txt/.exec(f);
  if (m) RAW_FOR[`${m[2]}-${m[1]}`] = `.cache/raw/${f}`;
}

// ---------------------------------------------------------------------------
// Checks.
// ---------------------------------------------------------------------------

const hhmmMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(2, 4));
const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
const hoursStr = (h: number) => {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
const isAirline = (f: string) => /^[A-Z][A-Z0-9]\d/.test(f) && !/^\d+$/.test(f);

/** The PDF pairing a trip came from: same page and sequence; where a page prints a sequence twice, the one whose legs match. */
function sourceFor(trip: Trip, raw: Map<string, RawPairing[]>): RawPairing | undefined {
  const m = /^p-(\d+)-(\d+)-([^-]+)-/.exec(trip.id);
  if (!m) return undefined;
  const cands = raw.get(`${m[1]}|${m[2]}`) ?? [];
  const first = trip.schedule[0]?.legs[0];
  return (
    cands.find((c) => c.legs[0]?.flight === m[3] && !!first && c.legs[0].depGmt === first.depTimeGmt && c.legs[0].eqp === (first.equipment ?? "")) ??
    cands.find((c) => c.legs[0]?.flight === m[3]) ??
    cands[0]
  );
}

function checkTrip(tag: string, pack: BidPack, lineNo: string, trip: Trip, raw: Map<string, RawPairing[]>) {
  const where = `${tag} line ${lineNo} trip ${trip.pairingNumber ?? "?"}@${trip.startDayIndex ?? "?"}`;
  if (trip.schedule.length === 0) {
    note("trips shown without their detail", `${where} (${trip.id})`);
    return;
  }
  bump("trips with detail checked");
  const legs = trip.schedule.flatMap((d) => d.legs);

  // --- Against the PDF ---
  const src = sourceFor(trip, raw);
  if (!src) note("trips whose PDF pairing couldn't be found (audit can't check them)", where);
  else {
    // A merged run of the same one-day pairing repeats its legs once per day.
    const runs = src.legs.length ? legs.length / src.legs.length : 0;
    if (!Number.isInteger(runs) || runs < 1) note("trips whose legs don't match the PDF's", `${where}: app ${legs.length} legs, PDF ${src.legs.length}`);
    else {
      for (let r = 0; r < runs; r++)
        src.legs.forEach((s, i) => {
          const a = legs[r * src.legs.length + i];
          const diffs: string[] = [];
          if (a.flightNumber !== s.flight) diffs.push(`flight ${a.flightNumber}≠${s.flight}`);
          if (a.depAirport !== s.dep || a.arrAirport !== s.arr) diffs.push(`route ${a.depAirport}-${a.arrAirport}≠${s.dep}-${s.arr}`);
          if (a.depTimeGmt !== s.depGmt || a.arrTimeGmt !== s.arrGmt) diffs.push(`GMT ${a.depTimeGmt}/${a.arrTimeGmt}≠${s.depGmt}/${s.arrGmt}`);
          if (a.depTimeLocal !== s.depLocal || a.arrTimeLocal !== s.arrLocal)
            diffs.push(`local ${a.depTimeLocal}/${a.arrTimeLocal}≠${s.depLocal}/${s.arrLocal}`);
          if ((a.equipment ?? "") !== s.eqp) diffs.push(`eqp ${a.equipment}≠${s.eqp}`);
          if (diffs.length) note("legs that differ from the PDF", `${where} leg ${i + 1}: ${diffs.join("; ")}`);
          // Deadheads: another airline's flight or a ground ride, never a FedEx flight number.
          const shouldDH = isAirline(s.flight) || s.eqp === "JET" || s.eqp === "CAB";
          if (!a.isStandby && !!a.isDeadhead !== shouldDH)
            note(
              "legs with the wrong deadhead label",
              `${where} ${s.flight} ${s.dep}-${s.arr} eqp ${s.eqp}: app says ${a.isDeadhead ? "deadhead" : "operating"}`
            );
          bump("legs checked against the PDF");
        });
      // Layovers: after the right leg, right city, right length, with their hotels and rides.
      const appLayovers = trip.schedule.filter((d) => d.layover).map((d) => ({ afterLeg: d.legs.at(-1)!, layover: d.layover! }));
      const srcLayovers = src.legs.flatMap((s, i) => (s.layover ? [{ i, s }] : []));
      if (appLayovers.length !== srcLayovers.length * runs)
        note("trips with a different number of layovers than the PDF", `${where}: app ${appLayovers.length}, PDF ${srcLayovers.length}×${runs}`);
      else
        for (let r = 0; r < runs; r++)
          srcLayovers.forEach(({ i, s: s0 }, k) => {
            const a = appLayovers[r * srcLayovers.length + k];
            // The version printed for this trip's own date (GMT, as the pack prints dates), when the pack splits by date.
            const report = tripReportUtc(pack, trip);
            const d = report === null ? null : new Date(report + r * 86_400_000);
            const md = d ? (d.getUTCMonth() + 1) * 100 + d.getUTCDate() : null;
            const version = md !== null ? s0.dated.find((v) => md >= v.from && md <= v.to) : undefined;
            if (s0.dated.length)
              bump(
                version
                  ? "layovers whose hotel changes by date, checked for the trip's date"
                  : "layovers whose hotel changes by date, trip outside every printed date"
              );
            const s = version ? { ...s0, hotels: version.hotels, transTo: version.transTo, transFrom: version.transFrom } : s0;
            const after = legs[r * src.legs.length + i];
            const lay = s.layover!;
            const diffs: string[] = [];
            if (a.afterLeg !== after) diffs.push(`after leg ${legs.indexOf(a.afterLeg) + 1}, PDF after leg ${i + 1}`);
            if (a.layover.city !== lay.city) diffs.push(`city ${a.layover.city}≠${lay.city}`);
            if (hoursStr(a.layover.hours) !== lay.hours.replace(/^0(\d)/, "$1")) diffs.push(`length ${hoursStr(a.layover.hours)}≠${lay.hours}`);
            const inCity = s.hotels.filter((h) => h.city === lay.city).map((h) => h.name);
            if (!(inCity.length === 0 ? a.layover.hotelName === null : inCity.includes(a.layover.hotelName ?? "")))
              diffs.push(`hotel "${a.layover.hotelName}" not among ${JSON.stringify(inCity)}`);
            if ((a.layover.transportToHotel ?? null) !== s.transTo) diffs.push(`ride to "${a.layover.transportToHotel}"≠"${s.transTo}"`);
            if ((a.layover.transportFromHotel ?? null) !== s.transFrom) diffs.push(`ride from "${a.layover.transportFromHotel}"≠"${s.transFrom}"`);
            if (diffs.length) note("layovers that differ from the PDF", `${where} ${lay.city}: ${diffs.join("; ")}`);
            bump("layovers checked against the PDF");
            if (new Set(inCity).size > 1)
              note(
                "layovers with two different hotels printed",
                `${where} ${lay.city}: ${[...new Set(inCity)].join(" / ")} — app shows ${a.layover.hotelName}`
              );
            if (s.hotels.length && !inCity.length)
              note("layovers whose printed hotel is in another city", `${where} ${lay.city}: ${s.hotels.map((h) => `${h.name} (${h.city})`).join(", ")}`);
          });
      // Hotels between legs of one duty: a day room, at that stop.
      for (let r = 0; r < runs; r++)
        src.legs.forEach((s, i) => {
          if (s.layover || !s.hotels.length) return;
          const a = legs[r * src.legs.length + i];
          if (i === src.legs.length - 1) {
            note("hotels printed after a trip's last leg", `${where} ${s.hotels.map((h) => `${h.name} (${h.city})`).join(", ")}`);
            return;
          }
          const want = s.hotels.find((h) => h.city === s.arr)?.name ?? null;
          if ((a.dayRoomHotel ?? null) !== want)
            note(
              "day rooms that differ from the PDF",
              `${where} after ${s.flight} at ${s.arr}: app "${a.dayRoomHotel}", PDF ${s.hotels.map((h) => `${h.name} (${h.city})`).join(", ")}`
            );
          else bump("day rooms checked against the PDF");
        });
    }
  }

  // --- What the trip view draws ---
  for (let d = 0; d < trip.schedule.length; d++) {
    const duty = trip.schedule[d];
    for (let i = 0; i + 1 < duty.legs.length; i++) {
      const gap = (duty.legs[i + 1].startMinutes - duty.legs[i].endMinutes) / 60;
      if (gap < 0) note("legs that overlap", `${where} ${duty.legs[i].flightNumber}→${duty.legs[i + 1].flightNumber}`);
      if (gap >= 8 && !duty.legs[i].dayRoomHotel)
        note("long ground stretches inside a duty with no hotel", `${where} ${duty.legs[i].arrAirport} ${gap.toFixed(1)}h after ${duty.legs[i].flightNumber}`);
    }
    if (duty.layover) {
      const last = duty.legs.at(-1)!;
      const next = trip.schedule[d + 1]?.legs[0];
      if (duty.layover.city !== last.arrAirport)
        note("layovers in a different city than the flight lands", `${where} ${last.flightNumber} lands ${last.arrAirport}, layover ${duty.layover.city}`);
      if (next && next.depAirport !== duty.layover.city)
        note("layovers in a different city than the next flight leaves", `${where} layover ${duty.layover.city}, next leaves ${next.depAirport}`);
      if (duty.layover.startMinutes !== last.endMinutes) note("layovers that don't start when the flight lands", `${where} ${duty.layover.city}`);
      if (next && duty.layover.endMinutes > next.startMinutes) note("layovers that run past the next departure", `${where} ${duty.layover.city}`);
      const groundAfter = next ? (next.startMinutes - duty.layover.endMinutes) / 60 : 0;
      if (groundAfter > 4) note("long 'ground' stretches after a layover", `${where} ${duty.layover.city} ${groundAfter.toFixed(1)}h from pickup to departure`);
    }
    if (d > 0 && !trip.schedule[d - 1].layover) {
      const prevLast = trip.schedule[d - 1].legs.at(-1)!;
      if (prevLast.arrAirport !== duty.legs[0]?.depAirport)
        note("duties that don't connect", `${where} ends ${prevLast.arrAirport}, next starts ${duty.legs[0]?.depAirport}`);
    }
  }

  // Each flight drawn at its printed local time.
  const local = buildTimelineDays(trip, "local");
  if (local.length === 0) note("trips the day view can't draw", where);
  // Each column is labeled with the real local date of what's on it.
  for (const day of local) {
    if (!day.date) continue;
    for (const seg of day.segments) {
      if (seg.continuesFromPreviousDay) continue;
      const r = buildRawSegments(trip, "local").find((x) => x.label === seg.label && x.detail === seg.detail && x.kind === seg.kind);
      const zone = r && timezoneForAirport(r.startAirport);
      if (!r || !zone) continue;
      const real = DateTime.fromISO(r.zuluStart, { zone: "utc" }).setZone(zone).toISODate();
      // A piece shifted onto the day the trip had reached (east across the date line) keeps an earlier real date; anything else must match.
      if (real !== day.date && !(real! < day.date))
        note("day-view columns with the wrong date", `${where} day ${day.dayNumber} labeled ${day.date}, "${seg.label}" is on ${real}`);
    }
  }
  // Every piece of the trip appears somewhere in the day view.
  const drawn = new Set(local.flatMap((d) => d.segments.map((s) => `${s.kind}|${s.label}|${s.detail}`)));
  for (const r of buildRawSegments(trip, "local"))
    if (!drawn.has(`${r.kind}|${r.label}|${r.detail}`)) note("pieces of a trip missing from the day view", `${where} ${r.kind} "${r.label}" ${r.detail}`);
  for (const day of local)
    for (const seg of day.segments) {
      if (!seg.leg) continue;
      const matches = legs.filter((l) => l.flightNumber === seg.leg!.flightNumber && l.depAirport === seg.leg!.dep && l.arrAirport === seg.leg!.arr);
      if (!seg.continuesFromPreviousDay && !matches.some((l) => hhmmMin(l.depTimeLocal) === seg.startMinuteOfDay))
        note(
          "flights drawn at the wrong local time",
          `${where} ${seg.leg.flightNumber} ${seg.leg.dep} printed ${matches.map((l) => l.depTimeLocal).join("/")}, drawn ${minToHHMM(seg.startMinuteOfDay)}`
        );
      if (!seg.continuesToNextDay && !matches.some((l) => hhmmMin(l.arrTimeLocal) === seg.endMinuteOfDay))
        note(
          "flights drawn landing at the wrong local time",
          `${where} ${seg.leg.flightNumber} ${seg.leg.arr} printed ${matches.map((l) => l.arrTimeLocal).join("/")}, drawn ${minToHHMM(seg.endMinuteOfDay)}`
        );
      bump("drawn flight pieces checked");
    }

  // Nothing drawn on top of anything else.
  const segs = buildRawSegments(trip, "local").sort((x, y) => x.startMinutes - y.startMinutes);
  for (let k = 1; k < segs.length; k++)
    if (segs[k].startMinutes < segs[k - 1].endMinutes)
      note("pieces of a trip drawn on top of each other", `${where} ${segs[k - 1].kind} "${segs[k - 1].label}" and ${segs[k].kind} "${segs[k].label}"`);
}

/**
 * The month calendar on each line: every day of every trip's own day-by-day
 * view lands on the calendar date it really is, and nothing in a trip is
 * left off the calendar.
 */
function checkCalendar(tag: string, pack: BidPack, line: BidPack["lines"][number]) {
  if (line.estimated || !pack.bidPeriodStart || line.trips.some((t) => t.startDayIndex === null)) return;
  const cal = buildLineMonthCalendar(line, pack.bidPeriodStart, pack.bidPeriodDays, "local");
  line.trips.forEach((trip, ti) => {
    const where = `${tag} line ${line.lineNumber} trip ${trip.pairingNumber}@${trip.startDayIndex}`;
    const home = buildHomeDays(trip, "local");
    const owned = cal.days.filter((d) => d.tripIndex === ti && !d.isPreReport);
    bump("trips checked on the month calendar");
    if (!owned.length) {
      note("trips missing from the month calendar", where);
      return;
    }
    if (owned[0].dayIndex !== trip.startDayIndex) note("trips that start on the wrong calendar day", `${where}: calendar day ${owned[0].dayIndex}`);
    // Every piece of the trip is on the calendar: on its own days, or carried onto the day it runs into.
    const shown =
      owned.reduce((n, d) => n + d.segments.length, 0) + cal.days.reduce((n, d) => n + (d.spill?.tripIndex === ti ? d.spill.segments.length : 0), 0);
    const all = home.reduce((n, d) => n + d.segments.length, 0);
    if (shown < all) note("trips with pieces missing from the month calendar", `${where}: ${all - shown} of ${all} pieces not shown`);
    const spilled = cal.days.filter((d) => d.spill?.tripIndex === ti);
    if (spilled.length) bump("trips running onto a day the grid counts off (shown on it)");
    if (owned.length > home.length)
      note("trips with days on the month calendar that have nothing on them", `${where}: grid gives ${owned.length} days, the trip uses ${home.length}`);
  });
}

for (const file of readdirSync(".cache/packs")
  .filter((f) => f.endsWith(".json") && f.includes(filter))
  .sort()) {
  const pack: BidPack = restoreBidPack(JSON.parse(readFileSync(`.cache/packs/${file}`, "utf8")));
  const tag = file.replace(".json", "");
  const rawFile = RAW_FOR[`${pack.base}-${pack.aircraft}`];
  const raw = rawFile ? readRaw(rawFile) : new Map<string, RawPairing[]>();
  let trips = 0;
  for (const line of pack.lines) {
    bump("lines");
    checkCalendar(tag, pack, line);
    if (line.estimated) note("lines whose trips couldn't be matched to pairings (shown without detail)", `${tag} line ${line.lineNumber}`);
    for (const trip of line.trips) {
      trips++;
      bump("trips");
      if (trip.startDayIndex === null && !line.estimated) note("trips without a calendar date", `${tag} line ${line.lineNumber} ${trip.pairingNumber}`);
      checkTrip(tag, pack, line.lineNumber, trip, raw);
    }
  }
  console.log(`${tag.padEnd(20)} ${pack.lines.length} lines, ${trips} trips`);
}

console.log("\nTotals:");
for (const [k, v] of Object.entries(totals).sort()) console.log(`  ${k}: ${v}`);
for (const [k, xs] of Object.entries(examples)) console.log(`\n${k} — e.g.\n  ${xs.join("\n  ")}`);
