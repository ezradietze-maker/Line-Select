import { readFileSync, readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { warmTripBodyClock } from "@/lib/body-clock-score";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { lookupPack } from "@/lib/flights/client";
import { implicitLineValuesFor } from "@/lib/implicit-dimensions";
import { filterOptionsFor } from "@/lib/line-filter-options";
import { tripFactsOf } from "@/lib/metrics/compute";
import { migrateProfile } from "@/lib/profile-migration";
import { columnCountOf, layoverCitiesOf, runAll, touchedCitiesOf } from "@/lib/ranking-warm-up";
import { rankLines } from "@/lib/scoring";
import { rankingPack } from "@/lib/scoring-v2/adapter";
import { measureTasks } from "@/lib/scoring-v2/score";
import { leansOnTrips, scoreTripsV2 } from "@/lib/scoring-v2/trip-score";

/**
 * Where a pack's first ranking spends its time, piece by piece, as the Rankings page does it (`ranking-warm-up.ts`, then
 * `rankLines`): each trip's body-clock points and facts, the pack's filters, each of the pilot's measures on every line,
 * the trip scores and the ranking itself. Node, not a phone: a mid-range phone takes roughly 3–5 times as long. Free to
 * run. `--profile` is a saved profile (default: the ex-pilot's, in the private folder).
 *
 *   npx tsx scripts/eval/rank-speed.ts [--packs .cache/packs] [--profile <profile.json>]
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dir = arg("packs") ?? ".cache/packs";
const profile = migrateProfile(JSON.parse(readFileSync(arg("profile") ?? "private/ex-pilot/benchmark-oct26/profile-oct21.json", "utf8")));
const model = profile.brainInterview?.reviewedModel ?? profile.pilotModel;
if (!model) throw new Error("That profile holds no pilot model.");
const ranked = { ...profile, pilotModel: applyCityRatings(model, profile.cityRatings) };

const time = (work: () => unknown) => {
  const t = performance.now();
  work();
  return performance.now() - t;
};

const rows: Record<string, string | number>[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const pack = restoreBidPack(JSON.parse(readFileSync(`${dir}/${file}`, "utf8")));
  const trips = pack.lines.flatMap((l) => l.trips);
  const m = ranked.pilotModel;
  const offset = computeHomeBaseOffsetMinutes(pack);
  const bodyClock = time(() => trips.forEach((t) => [null, null].forEach((limit) => warmTripBodyClock(t, offset, limit))));
  const facts = time(() => trips.forEach((t) => tripFactsOf(t)));
  const filters = time(() => {
    implicitLineValuesFor(pack);
    filterOptionsFor(pack.lines, pack.bidPeriodStart);
    layoverCitiesOf(pack);
    touchedCitiesOf(pack);
    columnCountOf(pack);
  });
  const measures = time(() => runAll(measureTasks(pack, m, rankingPack(pack, undefined))));
  const lookup = time(() => runAll(measureTasks(pack, m, lookupPack(pack))));
  const tripScores = time(() => leansOnTrips(m) && scoreTripsV2(pack, m, { pack: rankingPack(pack, undefined), onLineScale: false }));
  const rank = time(() => rankLines(pack, ranked, {}, implicitLineValuesFor(pack)));
  const again = time(() => rankLines(pack, ranked, {}, implicitLineValuesFor(pack)));
  const r = (v: number) => Math.round(v);
  rows.push({ pack: file.replace(".json", ""), lines: pack.lines.length, trips: trips.length, bodyClock: r(bodyClock), facts: r(facts), filters: r(filters), measures: r(measures), lookup: r(lookup), tripScores: r(tripScores), rank: r(rank), rankAgain: r(again), total: r(bodyClock + facts + filters + measures + lookup + tripScores + rank) });
}
console.table(rows);
