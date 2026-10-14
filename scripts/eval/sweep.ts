/**
 * Scoring experiments with no model calls: every persona with a cached judge
 * and brain model, scored under each variant, averaged. A change to scoring
 * only counts if it helps across pilots, not just one.
 *
 * Usage: npx tsx scripts/eval/sweep.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import type { BuildModelResult } from "@/lib/brain/build-model";
import { BRAIN_MODEL } from "@/lib/brain/llm";
import { BRAIN_PROMPT_VERSION } from "@/lib/brain/build-model";
import { prepareMetrics } from "@/lib/metrics/compute";
import { rankPackV2, type ScoreOptions } from "@/lib/scoring-v2/score";
import type { PilotModel } from "@/types/pilot-model";
import type { Judgment } from "./judge";
import { scorecard, type Scorecard } from "./metrics";
import { PERSONAS } from "./personas";

const VARIANTS: { name: string; model?: (m: PilotModel) => PilotModel; options?: ScoreOptions }[] = [
  { name: "beyond-bad 0.25", options: { beyondBad: 0.25 } },
  { name: "beyond-bad 0.5", options: { beyondBad: 0.5 } },
  { name: "beyond-bad 1", options: { beyondBad: 1 } },
  { name: "plain average", options: { power: 1 } },
  { name: "default (power 2)" },
  { name: "power 1.5", options: { power: 1.5 } },
  { name: "power 3", options: { power: 3 } },
  { name: "no worst-anchors", model: (m) => ({ ...m, criteria: m.criteria.map((c) => (c.shape.kind === "less" ? { ...c, shape: { ...c.shape, worstAt: undefined } } : c)) }) },
  { name: "no worst-anchors + power 2", model: (m) => ({ ...m, criteria: m.criteria.map((c) => (c.shape.kind === "less" ? { ...c, shape: { ...c.shape, worstAt: undefined } } : c)) }), options: { power: 2 } },
];

const brainFile = process.argv[2] ?? `${BRAIN_MODEL}-v${BRAIN_PROMPT_VERSION}`;
const results: Record<string, Scorecard[]> = {};
for (const p of PERSONAS) {
  const jf = `.cache/eval/judge-${p.id}.json`;
  const bf = `.cache/eval/brain-${p.id}-${brainFile}.json`;
  if (!existsSync(jf) || !existsSync(bf)) continue;
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${p.pack}.json`, "utf8")));
  const pm = prepareMetrics(pack);
  const j: Judgment = JSON.parse(readFileSync(jf, "utf8"));
  const brain: BuildModelResult = JSON.parse(readFileSync(bf, "utf8"));
  for (const v of VARIANTS) {
    const model = v.model ? v.model(brain.model) : brain.model;
    (results[v.name] ??= []).push(scorecard(p.id, rankPackV2(pack, model, { ...v.options, pack: pm }).map((r) => r.lineNumber), j));
  }
}
const avg = (xs: number[]) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3);
console.table(Object.entries(results).map(([name, cs]) => ({ variant: name, personas: cs.length, spearman: avg(cs.map((c) => c.spearman)), top10InAorB: avg(cs.map((c) => c.top10InAorB)), poorInTop15: avg(cs.map((c) => c.poorOrWorseInTop15)), ...Object.fromEntries(cs.map((c) => [c.name, c.spearman])) })));
