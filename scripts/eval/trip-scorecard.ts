import { existsSync, readFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { modelToDepartures } from "@/lib/brain/model-upgrade";
import { prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import { rankLinesWithTrips, scoreTripsV2, tripKey } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";
import { PERSONAS } from "./personas";

/**
 * Lines and trips side by side, for every simulated interview with a judged pack: how well the pilot's model ranks
 * lines (against the line judges), how well it scores trips (against the trip judges), and whether its line and trip
 * scores agree with each other — with and without what the trip questions taught. Free: judges and interviews are cached.
 *
 *   npx tsx scripts/eval/trip-scorecard.ts [persona…]
 */

type Judge = { tiers?: Record<string, string>; mean?: Record<string, number> };
const TIER: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };

/** Spearman with tied ranks averaged. */
export function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j < idx.length && idx[j][0] === idx[i][0]) j++;
      for (let k = i; k < j; k++) r[idx[k][1]] = (i + j + 1) / 2;
      i = j;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

/** The line judge for a persona: the consensus of several runs when there is one. */
export function lineJudge(id: string): Judge | null {
  const f = [`.cache/eval/judge-${id}-consensus.json`, `.cache/eval/judge-${id}.json`].find(existsSync);
  return f ? JSON.parse(readFileSync(f, "utf8")) : null;
}
export function tripJudges(id: string): { tiers: Record<string, string>; labels: Record<string, string> }[] {
  return [1, 2, 3].map((s) => `.cache/eval/trip-judge-${id}-s${s}.json`).filter(existsSync).map((f) => JSON.parse(readFileSync(f, "utf8")));
}

export function lineAgreement(pack: BidPack, model: PilotModel, pm: PackMetrics, j: Judge): number {
  const scores = rankLinesWithTrips(pack, model, { pack: pm });
  const val = (l: string) => (j.mean ? j.mean[l] : j.tiers?.[l] ? TIER[j.tiers[l]] : undefined);
  const rows = scores.filter((s) => val(s.lineNumber) !== undefined);
  return spearman(rows.map((s) => s.score), rows.map((s) => val(s.lineNumber)!));
}

export function tripAgreement(pack: BidPack, model: PilotModel, pm: PackMetrics, judges: ReturnType<typeof tripJudges>): number | null {
  if (!judges.length) return null;
  const scores = scoreTripsV2(pack, model, { pack: pm });
  const rhos = judges.map((j) => {
    const rows = Object.entries(j.labels).flatMap(([label, key]) => (scores.has(key) && j.tiers[label] ? [{ s: scores.get(key)!.score, t: TIER[j.tiers[label]] }] : []));
    return spearman(rows.map((r) => r.s), rows.map((r) => r.t));
  });
  return rhos.reduce((s, x) => s + x, 0) / rhos.length;
}

/**
 * Whether lines and trips tell the same story: across the pack, a line's score against the day-weighted average score
 * of its own trips (Spearman), and how many of the model's top 10 lines are made of trips mostly in the bottom half.
 */
export function coherence(pack: BidPack, model: PilotModel, pm: PackMetrics): { rho: number; topWithPoorTrips: number } {
  const trips = scoreTripsV2(pack, model, { pack: pm });
  const all = [...trips.values()].map((t) => t.score).sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)] ?? 0;
  const lines = rankPackV2(pack, model, { pack: pm });
  const rows: { line: number; trips: number; poorShare: number }[] = [];
  for (const s of lines) {
    const line = pack.lines.find((l) => l.id === s.lineId)!;
    const ts = line.trips.flatMap((t) => (trips.has(tripKey(t)) ? [{ score: trips.get(tripKey(t))!.score, days: Math.max(1, t.days) }] : []));
    if (!ts.length) continue;
    const days = ts.reduce((a, t) => a + t.days, 0);
    rows.push({ line: s.score, trips: ts.reduce((a, t) => a + t.score * t.days, 0) / days, poorShare: ts.filter((t) => t.score < median).reduce((a, t) => a + t.days, 0) / days });
  }
  return { rho: spearman(rows.map((r) => r.line), rows.map((r) => r.trips)), topWithPoorTrips: rows.slice(0, 10).filter((r) => r.poorShare > 0.5).length };
}

export interface SimRun {
  persona: string;
  tag: string;
  pack: BidPack;
  pm: PackMetrics;
  /** The brain's last reading, before any choice fitting. */
  preFit: PilotModel;
  /** As the run ended: fitted to its line choices, and its trip weights when it asked trip questions. */
  model: PilotModel;
  choices: { preferred: string; other: string; strength: "slightly" | "strongly"; why?: string }[];
  tripChoices: { preferred: string; other: string; strength: "slightly" | "strongly"; why?: string }[];
}

const packs = new Map<string, { pack: BidPack; pm: PackMetrics }>();
export function loadRun(persona: string, tag: string): SimRun | null {
  const f = `.cache/eval/sim/${persona}-${tag}.json`;
  const p = PERSONAS.find((x) => x.id === persona);
  if (!existsSync(f) || !p) return null;
  if (!packs.has(p.pack)) {
    const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${p.pack}.json`, "utf8")));
    packs.set(p.pack, { pack, pm: prepareMetrics(pack) });
  }
  const { pack, pm } = packs.get(p.pack)!;
  const d = JSON.parse(readFileSync(f, "utf8"));
  // As the app loads a saved model: a commuter's trip count and commutes move onto departures.
  return { persona, tag, pack, pm, preFit: modelToDepartures(d.preFit), model: modelToDepartures(d.model), choices: d.choices ?? [], tripChoices: d.tripChoices ?? [] };
}

/** The saved simulated interviews the trip bench works from (no trip grades yet: v15; two pair questions: v16). */
export const PANEL: Record<string, string[]> = {
  "expilot-readback": ["v15a", "v15b", "v15c", "v15d", "v16a", "v16b"],
  "ind-local-family": ["v15a", "v15b", "v15c", "v16a", "v16b"],
  "mem-757-bodyclock": ["v15a", "v15b", "v16a"],
};
/** Interviews run with trip grades (brain v18), for the scorecard. */
export const GRADED: Record<string, string[]> = {
  "expilot-readback": ["v18a", "v18b"],
  "ind-local-family": ["v18a", "v18b"],
  "mem-757-bodyclock": ["v18a", "v18b"],
};

if (process.argv[1]?.endsWith("trip-scorecard.ts")) {
  const wanted = process.argv.slice(2);
  const f3 = (x: number | null) => (x === null ? "  —  " : x.toFixed(3));
  for (const [persona, base] of Object.entries(PANEL)) {
    if (wanted.length && !wanted.includes(persona)) continue;
    const tags = [...base, ...(GRADED[persona] ?? [])];
    const lj = lineJudge(persona);
    const tj = tripJudges(persona);
    console.log(`\n${persona} (line judge ${lj ? "yes" : "no"}, trip judges ${tj.length})`);
    console.log("  run    trip Qs | lines: as run | trips: no trip fit → as run | lines vs trips: ρ, top-10 on poor trips");
    for (const tag of tags) {
      const r = loadRun(persona, tag);
      if (!r) continue;
      const noTrip: PilotModel = { ...r.model, tripWeights: undefined };
      const coh = coherence(r.pack, r.model, r.pm);
      console.log(
        `  ${tag.padEnd(6)} ${String(r.tripChoices.length).padStart(4)}    | ${lj ? f3(lineAgreement(r.pack, r.model, r.pm, lj)) : "  —  "}        | ${f3(tripAgreement(r.pack, noTrip, r.pm, tj))} → ${f3(tripAgreement(r.pack, r.model, r.pm, tj))}             | ${coh.rho.toFixed(3)}, ${coh.topWithPoorTrips}`
      );
    }
  }
}
