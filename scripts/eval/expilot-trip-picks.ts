import { readFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { migrateProfile } from "@/lib/profile-migration";
import { scoreTripsV2, tripKey } from "@/lib/scoring-v2/trip-score";
import type { PilotModel } from "@/types/pilot-model";

/**
 * The ex-pilot's five trip picks ("which would you rather fly?", from his Oct 21 PDF) against the app's trip scores for
 * him: each pick the app scores higher for him agrees. Free (no AI calls). His picks and profile stay in the private
 * folder; this only reads them. Takes the same `--model` as `expilot-benchmark.ts`.
 *
 *   npx tsx scripts/eval/expilot-trip-picks.ts [--model <profile.json>]
 */
const DIR = "private/ex-pilot";
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const pack = restoreBidPack(JSON.parse(readFileSync(`${DIR}/interview-export-2026-10-15/mem-md11-cap-oct26-pack.json`, "utf8")));
const profile = migrateProfile(JSON.parse(readFileSync(arg("model") ?? `${DIR}/benchmark-oct26/profile-oct21.json`, "utf8")));
const base = profile.brainInterview?.reviewedModel ?? profile.pilotModel;
if (!base) throw new Error("No pilot model in that profile.");
const model: PilotModel = applyCityRatings(base, profile.cityRatings);
const scores = scoreTripsV2(pack, model);
const answers = JSON.parse(readFileSync(`${DIR}/benchmark-oct26/answers.json`, "utf8")) as { tripPicks: Record<string, [string, string]> };
const trip = (n: string) => pack.lines.flatMap((l) => l.trips).find((t) => t.pairingNumber === n);
let agree = 0;
const picks = Object.entries(answers.tripPicks);
for (const [pair, [chosen, other]] of picks) {
  const a = trip(chosen), b = trip(other);
  const sa = a && scores.get(tripKey(a)), sb = b && scores.get(tripKey(b));
  const ok = !!sa && !!sb && sa.score > sb.score;
  if (ok) agree++;
  console.log(`Pair ${pair}: he picked #${chosen} (${sa?.score ?? "—"}) over #${other} (${sb?.score ?? "—"}) — ${ok ? "agrees" : "DISAGREES"}`);
}
console.log(`Trip picks: ${agree} of ${picks.length}`);
