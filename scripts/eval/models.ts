/**
 * Which model should be the pilot brain? Builds every persona's model with
 * each candidate, scores the ranking it produces against the same judge, and
 * prints accuracy next to cost and time. Everything is cached, so re-running
 * only pays for what's missing.
 *
 * Usage: npx tsx scripts/eval/models.ts [model,model,…] [persona,persona,…]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { BRAIN_PROMPT_VERSION, buildPilotModel, type BuildModelResult } from "@/lib/brain/build-model";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { prepareMetrics } from "@/lib/metrics/compute";
import { rankLines } from "@/lib/scoring";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import { judgePack, type Judgment } from "./judge";
import { pilotAgreement, scorecard } from "./metrics";
import { exchangesOf, pilotWordsOf, PERSONAS, type EvalPersona } from "./personas";

const MODELS = (process.argv[2] ?? "claude-sonnet-5-5,claude-opus-5-5,claude-fable-5-1").split(",");
const ONLY = process.argv[3]?.split(",");

async function brainFor(p: EvalPersona, pack: BidPack, brief: string, model: string): Promise<BuildModelResult> {
  const file = `.cache/eval/brain-${p.id}-${model}-v${BRAIN_PROMPT_VERSION}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const r = await buildPilotModel({ packBrief: brief, pilotContext: p.context, exchanges: exchangesOf(p), model, effort: "high" });
  writeFileSync(file, JSON.stringify(r, null, 2));
  console.log(`  built ${p.id} on ${model}: $${r.usage.costUsd.toFixed(2)}, ${(r.usage.ms / 1000).toFixed(0)}s, ${r.model.criteria.length} criteria${r.dropped.length ? `, dropped ${r.dropped.length}` : ""}`);
  return r;
}

async function runPersona(p: EvalPersona) {
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${p.pack}.json`, "utf8")));
  const pm = prepareMetrics(pack);
  const brief = buildPackBrief(pack, pm);
  const judgment: Judgment = await judgePack({ pack, pilotWords: pilotWordsOf(p), pilotContext: p.context, cacheFile: `.cache/eval/judge-${p.id}.json` });
  const brains = await Promise.all(MODELS.map((m) => brainFor(p, pack, brief, m).catch((e) => (console.log(`  ${p.id} on ${m} failed: ${e.message}`), null))));
  const rows: Record<string, unknown>[] = [];
  // The live site's own ranking from this real interview, as a baseline.
  const real = (order: string[]) => (p.lineLabels ? { pilot: pilotAgreement(order, p.lineLabels).share } : {});
  if (p.id.startsWith("expilot-") && existsSync(".cache/eval/expilot-real-profile.json")) {
    const profile = JSON.parse(readFileSync(".cache/eval/expilot-real-profile.json", "utf8")) as PreferenceProfile;
    const order = rankLines(pack, profile, {}, computeImplicitLineValues(pack)).map((s) => s.line.lineNumber);
    rows.push({ persona: p.id, brain: "live site today (v1)", ...scorecard("", order, judgment), ...real(order), costUsd: 0, seconds: 0, criteria: Object.keys(profile.weights).length });
  }
  MODELS.forEach((m, i) => {
    const b = brains[i];
    if (!b) return;
    const order = rankPackV2(pack, b.model, { pack: pm }).map((r) => r.lineNumber);
    rows.push({ persona: p.id, brain: m, ...scorecard("", order, judgment), ...real(order), costUsd: +b.usage.costUsd.toFixed(2), seconds: Math.round(b.usage.ms / 1000), criteria: b.model.criteria.length });
  });
  return rows;
}

(async () => {
  process.loadEnvFile(".env.local");
  const personas = PERSONAS.filter((p) => !ONLY || ONLY.includes(p.id));
  // A few personas at a time keeps well inside rate limits.
  const all: Record<string, unknown>[] = [];
  for (let i = 0; i < personas.length; i += 3) all.push(...(await Promise.all(personas.slice(i, i + 3).map(runPersona))).flat());
  console.table(all.map((r) => { const { name, ...rest } = r; void name; return rest; }));
  const avg = (xs: number[]) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3);
  console.table(MODELS.map((m) => {
    const rs = all.filter((r) => r.brain === m);
    return { brain: m, personas: rs.length, spearman: avg(rs.map((r) => r.spearman as number)), top10InAorB: avg(rs.map((r) => r.top10InAorB as number)), poorInTop15: avg(rs.map((r) => r.poorOrWorseInTop15 as number)), totalCost: +rs.reduce((a, r) => a + (r.costUsd as number), 0).toFixed(2), avgSeconds: avg(rs.map((r) => r.seconds as number)) };
  }));
})();
