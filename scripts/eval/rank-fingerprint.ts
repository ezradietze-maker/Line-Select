import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { lineBodyClockScore, tripBodyClockScore } from "@/lib/body-clock-score";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { modelToDepartures } from "@/lib/brain/model-upgrade";
import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { implicitLineValuesFor } from "@/lib/implicit-dimensions";
import { migrateProfile } from "@/lib/profile-migration";
import { rankLines } from "@/lib/scoring";
import { rankLinesWithTrips, scoreTripsV2, tripKey } from "@/lib/scoring-v2/trip-score";
import { planTripSleep } from "@/lib/sleep-plan";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Everything a speed-up of the ranking must leave exactly as it was, written out to the last digit: on every pack, each
 * trip's sleep plan and body-clock score (with and without a nights limit), each line's body-clock score, and the whole
 * ranking — every line's score and every measure behind it — for the ex-pilot's profile, his model leaning on trips, and
 * the test pilots' models. Run it before a change and after; the two files must be identical (`cmp`). Free to run.
 *
 *   npx tsx scripts/eval/rank-fingerprint.ts <out.json> [--packs .cache/packs]
 */
const out = process.argv[2];
if (!out) throw new Error("usage: rank-fingerprint <out.json> [--packs dir]");
const i = process.argv.indexOf("--packs");
const dir = i >= 0 ? process.argv[i + 1] : ".cache/packs";

const robProfile = migrateProfile(JSON.parse(readFileSync("private/ex-pilot/benchmark-oct26/profile-oct21.json", "utf8")));
const robModel = applyCityRatings(robProfile.brainInterview?.reviewedModel ?? robProfile.pilotModel!, robProfile.cityRatings);
const rob = { ...robProfile, pilotModel: robModel };
// His model with trip grades, so the ranking scores every trip too (`rankLinesWithTrips`).
const robOnTrips: PilotModel = { ...robModel, tripWeights: Object.fromEntries(robModel.criteria.slice(0, 4).map((c, k) => [c.id, [1.4, 0.7, 1.2, 0.9][k]])) };
const personas = readdirSync(".cache/eval")
  .filter((f) => /^brain-(mem-757-bodyclock|anc-777fo-sea-commuter|mem-md11-paymax|ind-local-family|mem-a300-captain-dates)-claude-sonnet-5-5\.json$/.test(f) || /^brain-(mem-757-bodyclock|anc-777fo-sea-commuter|mem-md11-paymax|ind-local-family|mem-a300-captain-dates)-claude-sonnet-5-5-v5\.json$/.test(f))
  .map((f) => ({ name: f, model: modelToDepartures(JSON.parse(readFileSync(`.cache/eval/${f}`, "utf8")).model as PilotModel) }));

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const all: Record<string, unknown> = {};
const summary: Record<string, string> = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const pack = restoreBidPack(JSON.parse(readFileSync(`${dir}/${file}`, "utf8")));
  const offset = computeHomeBaseOffsetMinutes(pack);
  const trips = [...new Map(pack.lines.flatMap((l) => l.trips).map((t) => [tripKey(t), t])).values()];
  const entry = {
    sleep: trips.map((t) => planTripSleep(t, offset)),
    tripBodyClock: trips.map((t) => [tripBodyClockScore(t, offset), tripBodyClockScore(t, offset, 2)]),
    lineBodyClock: pack.lines.map((l) => lineBodyClockScore(l.trips, offset)),
    rob: rankLines(pack, rob, {}, implicitLineValuesFor(pack)).map((s) => ({ ...s, line: s.line.id })),
    robOnTrips: rankLinesWithTrips(pack, robOnTrips),
    robTripScores: [...scoreTripsV2(pack, robOnTrips, { onLineScale: true })],
    personas: personas.map((p) => [p.name, rankLinesWithTrips(pack, p.model)]),
  };
  all[file] = entry;
  summary[file] = sha(entry);
}
writeFileSync(out, JSON.stringify(all));
console.log(`${personas.length} test pilots, ${Object.keys(summary).length} packs`);
console.table(summary);
console.log("all:", sha(all));
