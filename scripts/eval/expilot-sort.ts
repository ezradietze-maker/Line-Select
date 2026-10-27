/**
 * The ex-pilot's sort and trip picks on saved readings of his interview, under the current code — free: what a scoring
 * change does to him, or how a set of re-reads (expilot-replay.ts) came out. Per reading: lines only, with his five trip
 * picks fitted (lines lean on trips), and whether the trip scores agree with each pick.
 *
 *   npx tsx scripts/eval/expilot-sort.ts <reading tag> [<reading tag> …]   (tags as in replay-<tag>.json, e.g. v22-v22-a)
 */
import { readFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { fitTripWeights } from "@/lib/brain/fit-choices";
import { prepareMetrics } from "@/lib/metrics/compute";
import { migrateProfile } from "@/lib/profile-migration";
import { rankLinesWithTrips, scoreTripsV2, tripKey } from "@/lib/scoring-v2/trip-score";
import type { PilotModel, TripChoice } from "@/types/pilot-model";
const D = "private/ex-pilot";
const pack = restoreBidPack(JSON.parse(readFileSync(`${D}/interview-export-2026-10-15/mem-md11-cap-oct26-pack.json`, "utf8")));
const pm = prepareMetrics(pack);
const ans = JSON.parse(readFileSync(`${D}/benchmark-oct26/answers.json`, "utf8"));
const piles = [ans.piles.top, ans.piles.fine, ans.piles.onlyIfHadTo, ans.piles.bottom];
const pp: [string, string][] = [];
piles.forEach((u: string[], i: number) => piles.slice(i + 1).forEach((l: string[]) => u.forEach((x) => l.forEach((y) => pp.push([x, y])))));
ans.piles.top.forEach((u: string, i: number) => ans.piles.top.slice(i + 1).forEach((l: string) => pp.push([u, l])));
const trip = (n: string) => pack.lines.flatMap((l) => l.trips).find((t) => t.pairingNumber === n)!;
const pickList = Object.entries(ans.tripPicks as Record<string, [string, string]>);
const picks: TripChoice[] = pickList.map(([p, [a, b]]) => ({ preferred: tripKey(trip(a)), other: tripKey(trip(b)), strength: p === "C" ? "slightly" : "strongly" }));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const L: number[] = [], W: number[] = []; let agree = 0, n = 0;
for (const f of process.argv.slice(2)) {
  const p = migrateProfile(JSON.parse(readFileSync(`${D}/benchmark-oct26/replay-${f}.json`, "utf8")));
  const base: PilotModel = applyCityRatings(p.brainInterview!.reviewedModel!, p.cityRatings);
  const pct = (m: PilotModel) => { const sc = new Map(rankLinesWithTrips(pack, m, { pack: pm }).map((x) => [x.lineNumber, x.score])); return (100 * pp.filter(([x, y]) => sc.get(x)! > sc.get(y)!).length) / pp.length; };
  L.push(pct(base)); W.push(pct({ ...base, tripWeights: fitTripWeights(pack, base, picks, pm).tripWeights }));
  const s = scoreTripsV2(pack, base, { pack: pm });
  for (const [, [a, b]] of pickList) { n++; if (s.get(tripKey(trip(a)))!.score > s.get(tripKey(trip(b)))!.score) agree++; }
}
console.log(`lines-only ${mean(L).toFixed(2)}% [${L.map((x) => x.toFixed(1)).join(" ")}] · with picks ${mean(W).toFixed(2)}% [${W.map((x) => x.toFixed(1)).join(" ")}] · trip picks ${agree}/${n}`);
