/**
 * Live audit of the commute-flight lookup across every bid pack in
 * `.cache/packs`, every line, every trip still ahead — the same questions
 * production asks, answered from real AeroDataBox boards plus each pack's
 * FedEx flights, then checked:
 *
 * 1. Coverage: every question answered, or why not.
 * 2. Each answer holds together: ways inside the window, the last departure
 *    really the last, the quickest itinerary real (its flights on the boards,
 *    connections long enough, on time), FedEx flights really from the pack.
 * 3. An independent recount (brute force over the same boards, written apart
 *    from `answerNeed`) agrees exactly.
 * 4. Board data: plausible times and speeds.
 * 5. Ground truth: the airline deadheads printed in the packs (real flight
 *    numbers and times) are found on the boards — on real dates and on
 *    dates read from the coming week.
 * 6. The measures built on it are finite and sane on every line.
 * 7. Hubs: for questions short on backups, looking through every hub (not
 *    just three) — how much the default misses.
 * 8. Projection: a later week's real boards against the coming week's, for
 *    a few airports.
 *
 * Spends AeroDataBox units; stops before the month's remaining units fall
 * below FLOOR. Usage:
 *   npx tsx scripts/audit/flights-live.mts ANC=SEA MEM=COS IND=DEN [--only=B777] [--quick]
 * (--quick skips the paid hub and projection checks)
 */
process.loadEnvFile(".env.local");
const { readdirSync, readFileSync } = await import("node:fs");
const { DateTime } = await import("luxon");
const { timezoneForAirport } = await import("@/lib/airport-timezones");
const { expandBidPack } = await import("@/lib/bidpack-storage");
import type { ScheduledFlight, TravelAnswer } from "@/lib/flights/itineraries";
const { backupsOf, JUMPSEAT_CONNECTION_MS, MIN_CONNECTION_MS } = await import("@/lib/flights/itineraries");
const { jumpseatFlights } = await import("@/lib/flights/jumpseat");
import type { TravelNeed } from "@/lib/flights/needs";
const { travelNeedsForPack } = await import("@/lib/flights/needs");
const { measure, prepareMetrics } = await import("@/lib/metrics/compute");
const { distanceKm } = await import("@/lib/metrics/home-travel");
const { getJson } = await import("@/lib/server/kv");
const { answerTravelNeeds, shiftWeeks, standIn } = await import("@/lib/server/flight-schedules");

const FLOOR = Number(process.env.AUDIT_UNITS_FLOOR ?? 32_000);
const args = process.argv.slice(2).filter((a) => a.includes("="));
const quick = process.argv.includes("--quick");
const only = process.argv.slice(2).find((a) => a.startsWith("--only="))?.slice(7);
const homesByBase = Object.fromEntries(args.filter((a) => !a.startsWith("--")).map((a) => a.split("=")).map(([b, h]) => [b, h.split(",")]));
const now = Date.now();
const H = 3_600_000;
const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(5, 16) + "Z" : "—");

const totals: Record<string, number> = {};
const bump = (k: string, n = 1) => (totals[k] = (totals[k] ?? 0) + n);
const examples: Record<string, string[]> = {};
const note = (k: string, s: string) => {
  bump(k);
  if ((examples[k] ??= []).length < 8) examples[k].push(s);
};
const units = async () => (await getJson<number>("adb:units-remaining")) ?? NaN;
const startUnits = await units();

/**
 * The independent recount: every first flight from home in the window (from a stand-in airport, after the drive),
 * nonstop or onto any later flight into the destination (plus the drive); when that leaves no backup, any route with
 * two connections no more than 1.5× the straight line.
 */
function recount(n: TravelNeed, look: (a: string) => ScheduledFlight[] | undefined) {
  const drive = (a: string) => n.groundMs?.[a] ?? 0;
  const ways = new Map<string, { feeder: number; arr: number; js: boolean }>();
  const ok = (f: ScheduledFlight) => n.arriveBy === undefined || f.arr + drive(f.to) <= n.arriveBy;
  const gap = (a: ScheduledFlight, b: ScheduledFlight) => b.dep - a.arr >= (!!a.jumpseat === !!b.jumpseat ? MIN_CONNECTION_MS : JUMPSEAT_CONNECTION_MS);
  const add = (route: ScheduledFlight[]) => {
    const f = route[0];
    const g = route[route.length - 1];
    const key = `${g.from}|${g.dep}|${g.to}`;
    const prev = ways.get(key);
    const js = route.some((x) => x.jumpseat);
    // Getting there: the latest feeder; going home: the earliest.
    if (!prev || (n.arriveBy !== undefined ? f.dep > prev.feeder : f.dep < prev.feeder)) ways.set(key, { feeder: f.dep, arr: g.arr, js });
  };
  const firsts: ScheduledFlight[] = [];
  for (const origin of n.from) {
    const board = look(origin);
    if (!board) return null;
    firsts.push(...board.filter((f) => f.from === origin && f.dep >= n.departAfter + drive(origin) && f.dep <= n.departBefore));
  }
  for (const f of firsts) {
    if (n.to.includes(f.to)) {
      if (ok(f)) add([f]);
    } else
      for (const g of look(f.to) ?? []) {
        const viaKm = (distanceKm(f.from, f.to) ?? 0) + (distanceKm(f.to, g.to) ?? 0);
        const directKm = distanceKm(f.from, g.to);
        const onWay = f.jumpseat || g.jumpseat || directKm === null || viaKm <= directKm * 1.5;
        if (g.from === f.to && n.to.includes(g.to) && ok(g) && gap(f, g) && onWay) add([f, g]);
      }
  }
  if (ways.size < 2) {
    const straight = Math.min(...n.from.flatMap((a) => n.to.map((b) => distanceKm(a, b) ?? Infinity)));
    for (const f of firsts) {
      if (n.to.includes(f.to)) continue;
      for (const g of look(f.to) ?? []) {
        if (g.from !== f.to || g.to === f.from || n.to.includes(g.to) || n.from.includes(g.to) || !gap(f, g)) continue;
        const hs = (look(g.to) ?? []).filter((h) => h.from === g.to && n.to.includes(h.to) && ok(h));
        if (!hs.length) continue;
        const km = (distanceKm(f.from, f.to) ?? 0) + (distanceKm(g.from, g.to) ?? 0) + Math.min(...hs.map((h) => distanceKm(h.from, h.to) ?? 0));
        if (Number.isFinite(straight) && km > straight * 1.5) continue;
        for (const h of hs) if (gap(g, h)) add([f, g, h]);
      }
    }
  }
  const w = [...ways.values()];
  return {
    options: w.length,
    jumpseatWays: w.filter((x) => x.js).length,
    lastDeparture: n.arriveBy !== undefined && w.length ? Math.max(...w.map((x) => x.feeder)) : null,
    firstArrival: n.arriveBy === undefined && w.length ? Math.min(...w.map((x) => x.arr)) : null,
  };
}

const shortNeeds: { tag: string; needs: TravelNeed[]; js: ScheduledFlight[]; answers: Map<string, TravelAnswer> }[] = [];

for (const file of readdirSync(".cache/packs").filter((f) => f.endsWith(".json")).sort()) {
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${file}`, "utf8")));
  const homes = homesByBase[pack.base];
  if (!homes || (only && !file.includes(only))) continue;
  const left = await units();
  if (left < FLOOR) {
    console.log(`stopping before ${file}: ${left} units left (floor ${FLOOR})`);
    break;
  }
  const tag = file.replace(".json", "");
  const needs = travelNeedsForPack(pack, { homeAirports: homes, commuteBufferHours: 10, frontBufferHours: 12, backRestHours: 10 }).filter((n) => n.departBefore > now);
  const js = jumpseatFlights(pack).filter((f) => f.dep >= now - 2 * 24 * H);
  const jsKeys = new Set(js.map((f) => `${f.n}|${f.from}|${f.dep}`));
  const t = Date.now();
  const { answers, stats, departuresFor } = await answerTravelNeeds(needs, js);
  const byId = new Map(answers.map((a) => [a.id, a]));
  console.log(`${tag.padEnd(20)} homes ${homes.join("/")}: ${needs.length} questions, ${answers.length} answered in ${((Date.now() - t) / 1000).toFixed(0)}s`, stats, `units left ${await units()}`);
  bump("questions", needs.length);
  bump("answered", answers.length);
  bump("boards fetched", stats.fetched);

  for (const n of needs) {
    const a = byId.get(n.id);
    const look = departuresFor(n);
    if (!a) {
      const missing = n.from.filter((o) => !look(o));
      note("unanswered questions", `${tag} ${n.id} ${n.from.join("/")}→${n.to.join("/")} — no board for ${missing.join(",") || "?"}`);
      continue;
    }
    bump(`answers: ${a.kind}`);
    if (a.options === 0) bump(`no way at all, by place: ${a.kind === "deviateOut" ? n.to[0] : a.kind === "deviateHome" ? n.from[0] : a.kind === "toBase" ? "to base" : "home from base"}`);
    if (a.options === 0) note(`no way at all (${a.kind})`, `${tag} ${a.id} ${n.from.join("/")}→${n.to.join("/")} ${n.arriveBy ? "by " + iso(n.arriveBy) : "after " + iso(n.departAfter)}`);
    else if (n.arriveBy !== undefined && backupsOf(a) === 0) note("getting there with no backup", `${tag} ${a.id} ${n.from.join("/")}→${n.to.join("/")} by ${iso(n.arriveBy)} — one way, ${a.best?.map((f) => f.n).join(" + ")}`);
    if (a.jumpseatWays > 0) bump("answers with a FedEx jumpseat way");

    // 2. The answer holds together.
    const problems: string[] = [];
    if (a.departures.length !== a.options) problems.push("departures≠options");
    if (a.departures.some((d, i) => i > 0 && d < a.departures[i - 1])) problems.push("departures unsorted");
    if (a.departures.some((d) => d < n.departAfter || d > n.departBefore)) problems.push("departure outside window");
    if (a.best && a.best.length > 2 && a.options > 0) bump("answers that needed two connections");
    if (a.best?.some((f) => f.filled)) bump("answers whose quickest route uses a flight filled from last week");
    if (a.jumpseatWays > a.options) problems.push("more FedEx ways than ways");
    if (n.arriveBy !== undefined && a.options && a.lastDeparture !== Math.max(...a.departures)) problems.push("last departure isn't the latest");
    if (a.best) {
      const b = a.best;
      if (!n.from.includes(b[0].from) || !n.to.includes(b.at(-1)!.to)) problems.push("best goes the wrong way");
      if (b[0].dep < n.departAfter || b[0].dep > n.departBefore) problems.push("best leaves outside the window");
      if (n.arriveBy !== undefined && b.at(-1)!.arr + (n.groundMs?.[b.at(-1)!.to] ?? 0) > n.arriveBy) problems.push("best arrives late");
      if (b[0].dep < n.departAfter + (n.groundMs?.[b[0].from] ?? 0)) problems.push("best leaves before the drive gets there");
      for (let i = 0; i < b.length; i++) {
        const f = b[i];
        if (f.arr <= f.dep) problems.push(`${f.n} lands before it leaves`);
        if (f.jumpseat ? !jsKeys.has(`${f.n}|${f.from}|${f.dep}`) : !(look(f.from) ?? []).some((g) => g.n === f.n && g.dep === f.dep)) problems.push(`${f.n} isn't on the board`);
        if (i > 0) {
          const need = !!f.jumpseat === !!b[i - 1].jumpseat ? MIN_CONNECTION_MS : JUMPSEAT_CONNECTION_MS;
          if (b[i - 1].to !== f.from) problems.push("best doesn't connect");
          if (f.dep - b[i - 1].arr < need) problems.push("best's connection too short");
        }
      }
    }
    if (problems.length) note("answers that don't hold together", `${tag} ${a.id}: ${problems.join("; ")}`);

    // 3. The independent recount.
    const r = recount(n, look);
    if (!r) note("recount couldn't run", `${tag} ${a.id}`);
    else if (r.options !== a.options || r.jumpseatWays !== a.jumpseatWays || r.lastDeparture !== a.lastDeparture || r.firstArrival !== a.firstArrival)
      note("answers the recount disagrees with", `${tag} ${a.id}: ways ${a.options}/${r.options}, FedEx ${a.jumpseatWays}/${r.jumpseatWays}, last ${iso(a.lastDeparture)}/${iso(r.lastDeparture)}, home ${iso(a.firstArrival)}/${iso(r.firstArrival)}`);
    else bump("answers the recount confirms");
  }

  // 4. Board data, over every airport any question looked at.
  const seen = new Set<string>();
  for (const n of needs.slice(0, 400)) {
    const look = departuresFor(n);
    for (const ap of new Set([...n.from, ...n.to])) {
      for (const f of look(ap) ?? []) {
        const k = `${f.n}|${f.from}|${f.dep}`;
        if (seen.has(k) || f.jumpseat) continue;
        seen.add(k);
        bump("board flights checked");
        const hours = (f.arr - f.dep) / H;
        const km = distanceKm(f.from, f.to);
        if (hours <= 0 || hours > 20) note("board flights with impossible times", `${f.n} ${f.from}-${f.to} ${iso(f.dep)}→${iso(f.arr)}`);
        else if (km !== null && ((km > 800 && km / hours < 300) || km / hours > 1100)) note("board flights at an implausible speed", `${f.n} ${f.from}-${f.to} ${km.toFixed(0)}km in ${hours.toFixed(2)}h`);
      }
    }
  }

  // 5. The pack's own airline deadheads, on the boards.
  for (const line of pack.lines)
    for (const trip of line.trips) {
      if (trip.startDayIndex === null || !trip.schedule.length || !pack.bidPeriodStart) continue;
      const zone = timezoneForAirport(pack.base)!;
      const start = DateTime.fromISO(pack.bidPeriodStart, { zone }).plus({ days: trip.startDayIndex }).set({ hour: Number(trip.schedule[0].reportTimeLocal.slice(0, 2)), minute: Number(trip.schedule[0].reportTimeLocal.slice(2)) }).toMillis();
      for (const d of trip.schedule)
        for (const l of d.legs) {
          const m = /^([A-Z0-9]{2})(\d{1,4})$/.exec(l.flightNumber);
          if (!m || !l.isDeadhead || l.equipment === "CAB") continue;
          const dep = start + l.startMinutes * 60_000;
          if (dep < now) continue;
          const look = departuresFor({ id: "x", tripId: "x", kind: "toBase", from: [], to: [], arriveBy: dep + 2 * H, departAfter: dep - 2 * H, departBefore: dep + 2 * H });
          const board = look(l.depAirport);
          if (!board) continue;
          const projected = standIn({ airport: l.depAirport, date: DateTime.fromMillis(dep, { zone: timezoneForAirport(l.depAirport)! }).toISODate()!, half: 0 }, now).weeks > 0;
          const label = projected ? "from the coming week" : "real date";
          const n = `${m[1]} ${Number(m[2])}`;
          if (board.every((f) => f.jumpseat)) continue;
          const hit = board.find((f) => f.n === n && f.to === l.arrAirport);
          bump(`pack deadheads checked (${label})`);
          if (!hit) {
            note(`pack deadheads not on the board (${label})`, `${tag} ${l.flightNumber} ${l.depAirport}-${l.arrAirport} ${iso(dep)}`);
            // Is it on the provider's own board for that date — so the choice of board lost it — or not in its data at all?
            const local = DateTime.fromMillis(dep, { zone: timezoneForAirport(l.depAirport)! });
            const own = await getJson<ScheduledFlight[]>(`adb:board:v1:${l.depAirport}:${local.toISODate()}:${local.hour < 12 ? 0 : 1}`);
            if (own === null) bump(`  …of which the date's own board was never fetched (${label})`);
            else if (own.some((f) => f.n === n)) note(`  …of which the date's own board has it — the board choice lost it (${label})`, `${tag} ${n} ${l.depAirport} ${iso(dep)}; own board ${own.length} flights, used ${board.length}`);
            else bump(`  …of which the provider doesn't list it on that date (${label})`);
          }
          else if (Math.abs(hit.dep - dep) > 10 * 60_000) note(`pack deadheads at a different time on the board (${label})`, `${tag} ${n} ${l.depAirport}-${l.arrAirport} pack ${iso(dep)} board ${iso(hit.dep)}`);
          else bump(`pack deadheads matched (${label})`);
        }
    }

  // 6. The measures, on every line.
  const pm = prepareMetrics(pack);
  pm.ctx.flights = Object.fromEntries(answers.map((a) => [a.id, a]));
  const p = { homeAirports: homes, commuteBufferHours: 10, frontBufferHours: 12, backRestHours: 10 };
  for (const line of pack.lines)
    for (const id of ["fewestBackupFlights", "tripsShortOnBackups", "longestTripHome", "homeAwayHours", "creditPerDayAwayFromHome"]) {
      const v = measure(id, line, pm, p);
      if (v === null) bump(`measure unknown: ${id}`);
      else if (!Number.isFinite(v) || v < 0) note("measures that aren't finite and non-negative", `${tag} line ${line.lineNumber} ${id} = ${v}`);
      else bump(`measure ok: ${id}`);
    }

  shortNeeds.push({ tag, needs: needs.filter((n) => n.arriveBy !== undefined && byId.has(n.id) && backupsOf(byId.get(n.id)!) < 2), js, answers: byId });
}

// 7. Hubs: every hub instead of three, for questions short on backups (a sample).
const sample = shortNeeds.flatMap((s) => s.needs.slice(0, 6).map((n) => ({ ...s, n })));
if (!quick && sample.length && (await units()) > FLOOR) {
  for (const s of sample) {
    const wide = await answerTravelNeeds([s.n], s.js, { maxHubs: 12 });
    const a = s.answers.get(s.n.id)!;
    const b = wide.answers[0];
    bump("short questions re-run through every hub");
    if (b && b.options > a.options) note("short questions every hub helped", `${s.tag} ${s.n.id} ${s.n.from.join("/")}→${s.n.to.join("/")}: ways ${a.options}→${b.options}, backups ${backupsOf(a)}→${backupsOf(b)}`);
  }
}

// 8. Projection: a later week's real boards against the coming week's.
const key = process.env.AERODATABOX_API_KEY!;
const projAirports = [...new Set(Object.entries(homesByBase).flatMap(([b, h]) => [b, h[0]]))];
for (const ap of quick ? [] : projAirports) {
  if ((await units()) < FLOOR) break;
  const zone = timezoneForAirport(ap)!;
  const day = DateTime.fromMillis(now, { zone }).startOf("day").plus({ days: 7 + 3 });
  for (const half of [0, 1] as const) {
    const date = day.toISODate()!;
    const real = await fetchBoard(ap, date, half);
    const s = standIn({ airport: ap, date, half }, now);
    const base = await getJson<ScheduledFlight[]>(`adb:board:v1:${ap}:${s.block.date}:${half}`);
    if (!real || !base) {
      bump("projection checks skipped (stand-in not cached)");
      continue;
    }
    const projected = base.map((f) => shiftWeeks(f, s.weeks));
    const match = real.filter((r) => projected.some((p) => p.n === r.n && Math.abs(p.dep - r.dep) <= 5 * 60_000)).length;
    const moved = real.filter((r) => !projected.some((p) => p.n === r.n && Math.abs(p.dep - r.dep) <= 5 * 60_000) && projected.some((p) => p.n === r.n)).length;
    bump("projection: real flights", real.length);
    bump("projection: matched by number and time", match);
    bump("projection: same number, different time", moved);
    console.log(`projection ${ap} ${date} ${half ? "pm" : "am"}: ${real.length} real, ${match} matched, ${moved} moved, ${real.length - match - moved} not in the stand-in; stand-in had ${projected.length}`);
  }
}

async function fetchBoard(airport: string, date: string, half: 0 | 1): Promise<ScheduledFlight[] | null> {
  const from = `${date}T${half ? "12:00" : "00:00"}`;
  const to = `${date}T${half ? "23:59" : "11:59"}`;
  const url = `https://api.aerodatabox.com/flights/airports/iata/${airport}/${from}/${to}?direction=Departure&withLeg=true&withCancelled=false&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { "X-Api-Key": key } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      continue;
    }
    if (res.status === 204) return [];
    if (!res.ok) return null;
    const j = (await res.json()) as { departures?: { number?: string; departure?: { scheduledTime?: { utc?: string } }; arrival?: { airport?: { iata?: string }; scheduledTime?: { utc?: string } } }[] };
    const t = (s?: string) => (s ? Date.parse(s.replace(" ", "T")) : NaN);
    return (j.departures ?? []).flatMap((d) => {
      const dep = t(d.departure?.scheduledTime?.utc);
      const arr = t(d.arrival?.scheduledTime?.utc);
      return d.number && d.arrival?.airport?.iata && Number.isFinite(dep) && Number.isFinite(arr) ? [{ n: d.number, from: airport, to: d.arrival.airport.iata, dep, arr }] : [];
    });
  }
  return null;
}

console.log(`\nUnits: ${startUnits} → ${await units()}`);
console.log("\nTotals:");
for (const [k, v] of Object.entries(totals).sort()) console.log(`  ${k}: ${v}`);
for (const [k, xs] of Object.entries(examples)) console.log(`\n${k} — e.g.\n  ${xs.join("\n  ")}`);
