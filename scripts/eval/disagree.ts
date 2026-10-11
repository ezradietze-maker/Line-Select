/**
 * Where scoring v2 and the judge disagree most for one persona, with every
 * criterion's real value on those lines — to see what the scorer misses.
 *
 * Usage: npx tsx scripts/eval/disagree.ts <persona-id> [n]
 */
import { readFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import type { BuildModelResult } from "@/lib/brain/build-model";
import { BRAIN_MODEL } from "@/lib/brain/llm";
import { BRAIN_PROMPT_VERSION } from "@/lib/brain/build-model";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import type { Judgment } from "./judge";
import { renderLine } from "./judge";
import { PERSONAS } from "./personas";

const V = { A: 5, B: 4, C: 3, D: 2, E: 1 } as const;
const persona = PERSONAS.find((p) => p.id === process.argv[2])!;
const n = Number(process.argv[3] ?? 5);
const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
const judgment: Judgment = JSON.parse(readFileSync(`.cache/eval/judge-${persona.id}.json`, "utf8"));
const brain: BuildModelResult = JSON.parse(readFileSync(`.cache/eval/brain-${persona.id}-${process.env.BRAIN_FILE ?? `${BRAIN_MODEL}-v${BRAIN_PROMPT_VERSION}`}.json`, "utf8"));
const ranked = rankPackV2(pack, brain.model);
const N = ranked.length;
// Expected tier from v2's rank, by the judge's own tier mix.
const tierCounts = Object.values(judgment.tiers).reduce((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {} as Record<string, number>);
const order = (["A", "B", "C", "D", "E"] as const).flatMap((t) => Array(tierCounts[t] ?? 0).fill(t));
const rows = ranked.map((r, i) => ({ r, rank: i + 1, v2Tier: order[Math.min(order.length - 1, i)] as keyof typeof V, judgeTier: judgment.tiers[r.lineNumber] }));
const off = rows.filter((x) => x.judgeTier).sort((a, b) => Math.abs(V[b.v2Tier] - V[b.judgeTier]) - Math.abs(V[a.v2Tier] - V[a.judgeTier]));
const why = new Map(judgment.top.map((t) => [t.line, t.why]));
for (const x of off.slice(0, n)) {
  console.log(`\n=== line ${x.r.lineNumber}: v2 #${x.rank}/${N} (≈${x.v2Tier}) vs judge ${x.judgeTier}${why.has(x.r.lineNumber) ? ` — judge: ${why.get(x.r.lineNumber)}` : ""}`);
  for (const c of x.r.results) console.log(`   ${c.contribution >= 0 ? "+" : ""}${c.contribution.toFixed(1).padStart(5)}  ${c.label}: ${c.value === null ? "—" : +c.value.toFixed(2)} ${c.unit}`);
  if (process.argv.includes("--lines")) console.log(renderLine(pack, pack.lines.find((l) => l.lineNumber === x.r.lineNumber)!));
}
