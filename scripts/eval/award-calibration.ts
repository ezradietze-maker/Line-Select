import { readFileSync } from "node:fs";
import { buildLineFeatures } from "@/lib/forecast/features";
import { estimateDropoutRate, forecastPackKey, forecastWithCore } from "@/lib/forecast/forecast";
import { priorPopulation } from "@/lib/forecast/population";
import { makeNormal, mulberry32 } from "@/lib/forecast/random";
import { calibrationReport } from "@/lib/learning/calibration-report";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { calibrationCasesFrom } from "@/lib/server/learning-store";
import type { BidPack } from "@/types/bidpack";

/**
 * Runs the award-odds check end to end on one real pack, the way it runs on shared awards, without touching a database.
 *
 *   npx tsx scripts/eval/award-calibration.ts <pack.json> --awards <awards.json>
 *     The real thing. awards.json: [{ "line": "1033", "seniority": 1234 }, ...], read from a published award list with
 *     names and employee numbers already removed. Keep it in private/.
 *
 *   npx tsx scripts/eval/award-calibration.ts <pack.json>
 *     No awards to hand: plays one bid with the forecast's own assumptions and scores against that stand-in. It proves
 *     the pipeline runs on a real pack, and that odds fed their own assumptions come out honest. IT IS NOT A MEASURE OF
 *     REAL ACCURACY, and the output says so.
 */
const args = process.argv.slice(2);
const packPath = args[0];
const awardsAt = args.indexOf("--awards");
const awardsPath = awardsAt >= 0 ? args[awardsAt + 1] : null;
if (!packPath) throw new Error("Usage: award-calibration.ts <pack.json> [--awards <awards.json>]");

const pack: BidPack = restoreBidPack(JSON.parse(readFileSync(packPath, "utf8")));
const list = pack.seniorityList ?? [];
if (list.length === 0) throw new Error("This pack has no seniority list.");
const features = buildLineFeatures(pack);
const packKey = forecastPackKey(pack);
const dropoutRate = estimateDropoutRate(pack, list.length);
// As the forecast does: with PAY flags on the list, few who are left still pass.
const playDropout = list.some((e) => e.pay) ? Math.min(dropoutRate, 0.03) : dropoutRate;
const blobKey = "this-pack";
const lineNumbers = features.lineNumbers;

/** One play of the bid, start to finish, with the forecast's own assumptions and a seed its forecasts don't use: who took what. */
function standInAwards(seed: number): { lineNumber: string; bidPosition: number }[] {
  const rand = mulberry32(seed);
  const normal = makeNormal(rand);
  const population = priorPopulation(features.lineCount);
  const shared = Array.from({ length: features.lineCount }, () => population.popularitySd * normal());
  const open = new Set(lineNumbers.map((_, i) => i));
  const awards: { lineNumber: string; bidPosition: number }[] = [];
  for (const entry of list) {
    if (open.size === 0) break;
    if (entry.pay || rand() < playDropout) continue;
    const weights = population.mean.map((m, k) => m + population.sd[k] * normal());
    let best = -1;
    let bestUtility = -Infinity;
    for (const i of open) {
      let u = shared[i] + population.noiseSd * normal();
      for (let k = 0; k < weights.length; k++) u += weights[k] * features.values[i * weights.length + k];
      if (u > bestUtility) {
        bestUtility = u;
        best = i;
      }
    }
    open.delete(best);
    awards.push({ lineNumber: lineNumbers[best], bidPosition: entry.bidNumber });
  }
  return awards;
}

function realAwards(path: string): { lineNumber: string; bidPosition: number }[] {
  const rows = JSON.parse(readFileSync(path, "utf8")) as { line: string; seniority: number }[];
  return rows.flatMap((r) => {
    const entry = list.find((e) => e.seniority === r.seniority);
    return entry && lineNumbers.includes(String(r.line)) ? [{ lineNumber: String(r.line), bidPosition: entry.bidNumber }] : [];
  });
}

const holders = awardsPath ? realAwards(awardsPath) : standInAwards(20261108);
const ranking = lineNumbers.map((_, i) => i);
/** Forecasts through the part of the list where lines are still going, and a stretch past it. */
const reach = Math.min(list.length, Math.ceil(Math.max(...holders.map((h) => h.bidPosition)) * 1.1));
const step = Math.max(1, Math.floor(reach / 40));
const forecasts = list
  .filter((e) => e.bidNumber <= reach && (e.bidNumber - 1) % step === 0)
  .map((e) => {
    const { core } = forecastWithCore({ packKey, features, seniorityList: list, regularLines: lineNumbers.length, dropoutRate, seniorityNumber: e.seniority, myRanking: ranking, known: [] });
    return { pilotHash: `forecast-${e.bidNumber}`, blobKey, packKey, bidNumber: e.bidNumber, ranking, pAvailable: [...core.pAvailable] };
  });

const at = new Date(0);
const rows = holders.map((h, i) => ({ id: `a${i}`, pilotHash: `holder-${i}`, packKey, seat: pack.seat, outcome: "line", lineNumber: h.lineNumber, seniorityRank: h.bidPosition, holderShown: true, submittedAt: at }));
const cases = calibrationCasesFrom(rows, forecasts, new Map([[blobKey, lineNumbers]]));
const report = calibrationReport(cases, null, new Date());

console.log(awardsPath ? "REAL awards." : "STAND-IN awards: one play of the forecast's own assumptions. NOT a measure of real accuracy.");
console.log(`${pack.month} ${pack.base} ${pack.aircraft} ${pack.seat}: ${lineNumbers.length} lines, ${list.length} pilots on the list, ${holders.length} awards, ${report.forecasts} forecasts checked`);
console.log(`Pairs: ${report.pairs.otherPilots}. Brier: ${report.brier.asForecast?.toFixed(4)} (always saying the average: ${report.brier.alwaysTheAverage?.toFixed(4)})`);
console.log("Said    Happened    n");
for (const b of report.reliability) console.log(`${(b.said * 100).toFixed(0).padStart(3)}%    ${(b.happened * 100).toFixed(0).padStart(3)}%    ${String(b.n).padStart(6)}`);
