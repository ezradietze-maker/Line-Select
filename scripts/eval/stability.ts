/**
 * Does the brain give the same answer twice? Builds one persona's model N
 * times from identical input and compares the rankings and weights — the
 * wobble a pilot would see re-running the same interview.
 *
 * Usage: npx tsx scripts/eval/stability.ts <persona-id> [runs] [model]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { BRAIN_PROMPT_VERSION, buildPilotModel, type BuildModelResult } from "@/lib/brain/build-model";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { prepareMetrics } from "@/lib/metrics/compute";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import type { Judgment } from "./judge";
import { pilotAgreement, scorecard, spearman } from "./metrics";
import { exchangesOf, PERSONAS } from "./personas";

(async () => {
  process.loadEnvFile(".env.local");
  const p = PERSONAS.find((x) => x.id === process.argv[2])!;
  const runs = Number(process.argv[3] ?? 3);
  const model = process.argv[4] ?? "claude-sonnet-5-5";
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${p.pack}.json`, "utf8")));
  const pm = prepareMetrics(pack);
  const brief = buildPackBrief(pack, pm);
  const j: Judgment = JSON.parse(readFileSync(`.cache/eval/judge-${p.id}.json`, "utf8"));
  const brains = await Promise.all(
    Array.from({ length: runs }, async (_, i) => {
      const file = `.cache/eval/brain-${p.id}-${model}-v${BRAIN_PROMPT_VERSION}${i ? `-r${i}` : ""}.json`;
      if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as BuildModelResult;
      const r = await buildPilotModel({ packBrief: brief, pilotContext: p.context, exchanges: exchangesOf(p), model, effort: "high" });
      writeFileSync(file, JSON.stringify(r, null, 2));
      return r;
    })
  );
  const orders = brains.map((b) => rankPackV2(pack, b.model, { pack: pm }).map((r) => r.lineNumber));
  console.table(orders.map((o, i) => ({ run: i, judge: scorecard("", o, j).spearman, ...(p.lineLabels ? { pilot: pilotAgreement(o, p.lineLabels).share } : {}), top5: o.slice(0, 5).join(" "), cost: +brains[i].usage.costUsd.toFixed(2) })));
  // Rank agreement between runs: each run's order read as tiers would lose detail, so compare the orders directly.
  const asTiers = (o: string[]) => Object.fromEntries(o.map((l, i) => [l, (["A", "B", "C", "D", "E"] as const)[Math.min(4, Math.floor((i / o.length) * 5))]]));
  const pairs: number[] = [];
  for (let a = 0; a < orders.length; a++) for (let b = a + 1; b < orders.length; b++) pairs.push(spearman(orders[a], asTiers(orders[b])));
  console.log("run-to-run rank agreement (quintiles):", pairs.map((x) => x.toFixed(3)).join(", "));
  // Weight wobble per measure.
  const byMetric = new Map<string, number[]>();
  brains.forEach((b) => {
    const total = b.model.criteria.reduce((a, c) => a + c.weight, 0);
    const seen = new Map<string, number>();
    b.model.criteria.forEach((c) => seen.set(c.metric, (seen.get(c.metric) ?? 0) + c.weight / total));
    seen.forEach((w, m) => byMetric.set(m, [...(byMetric.get(m) ?? []), w]));
  });
  console.table([...byMetric].map(([m, ws]) => ({ metric: m, runs: `${ws.length}/${runs}`, shares: ws.map((w) => `${Math.round(w * 100)}%`).join(" ") })).sort((a, b) => b.runs.localeCompare(a.runs)));
})();
