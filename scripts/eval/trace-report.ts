/**
 * Reads a trace (`trace.ts`) and writes an answer-by-answer, line-by-line
 * account of the interview: after each answer, what the brain changed (every
 * criterion added, dropped, re-weighted, re-anchored), how agreement with the
 * pilot's verdicts and the judge moved, which lines moved and which criteria
 * moved them; then, for the final model, every line in the pack with its
 * verdict, judge tier and the criteria that place it where it is.
 *
 * Attribution is exact: a line's score is 100·(1 − √S), S = Σ wᵢ(1 − uᵢ)² / Σ wᵢ
 * (scoring-v2), so the gap between two lines splits into each criterion's
 * share of S — its "penalty".
 *
 * Usage: npx tsx scripts/eval/trace-report.ts <persona-id> <sim-tag>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { formatValue } from "@/lib/brain/describe";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import type { Criterion, PilotModel } from "@/types/pilot-model";
import type { Judgment } from "./judge";
import { pilotAgreement, scorecard } from "./metrics";
import { PERSONAS } from "./personas";
import { choiceTurns, currentChoices, scoreAll, type TraceLine, type TraceStep } from "./trace";
import { expandBidPack } from "@/lib/bidpack-storage";
import type { InterviewExchange } from "@/lib/brain/build-model";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { prepareMetrics } from "@/lib/metrics/compute";
import type { LineChoice } from "@/types/pilot-model";

const [personaId, tag] = process.argv.slice(2); // tag may carry a trace suffix, e.g. deep4-v11
const persona = PERSONAS.find((p) => p.id === personaId)!;
const steps: TraceStep[] = JSON.parse(readFileSync(`.cache/eval/trace/${persona.id}-${tag}.json`, "utf8"));
// Re-scored with today's scoring and fit, so the report reflects the code as it is now, not as it was when traced.
{
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
  const pm = prepareMetrics(pack);
  const run = JSON.parse(readFileSync(`.cache/eval/sim/${persona.id}-${tag.split("-")[0]}.json`, "utf8")) as { exchanges: InterviewExchange[]; choices: LineChoice[] };
  run.choices = currentChoices(run.exchanges, run.choices);
const turns = choiceTurns(run.exchanges, run.choices);
  for (const s of steps) {
    const choices = run.choices.filter((_, i) => turns[i] < s.upTo);
    s.fitted = choices.length ? fitWeightsToChoices(pack, s.model, choices, pm).model : s.model;
    s.pre = scoreAll(pack, s.model, pm);
    s.post = scoreAll(pack, s.fitted, pm);
  }
}
const judgeFile = `.cache/eval/judge-${persona.id}.json`;
const judge: Judgment | null = existsSync(judgeFile) ? JSON.parse(readFileSync(judgeFile, "utf8")) : null;
const labels = persona.lineLabels ?? {};
const out: string[] = [];
const w = (s: string) => out.push(s);

const fmt = (metric: string, v: number | null) => {
  const def = METRICS_BY_ID.get(metric);
  return v === null ? "—" : def ? formatValue(v, def) : String(+v.toFixed(2));
};
const shapeText = (c: Criterion) => {
  const s = c.shape as Record<string, unknown>;
  return [s.kind, ...Object.entries(s).filter(([k]) => k !== "kind").map(([k, v]) => `${k}=${v}`)].join(" ");
};
const paramsText = (c: Criterion) => {
  if (!c.params) return "";
  const p = { ...c.params } as Record<string, unknown>;
  if (p.cityScores) p.cityScores = Object.entries(p.cityScores as Record<string, number>).map(([k, v]) => `${k}${v >= 0 ? "+" : ""}${v}`).join(" ");
  return Object.entries(p).map(([k, v]) => `${k}:${Array.isArray(v) ? v.join(",") : v}`).join(" ");
};
const critLine = (c: Criterion) => `${c.label} [${c.metric}${c.params ? " " + paramsText(c) : ""}] ${shapeText(c)}, weight ${c.weight.toFixed(2)}, conf ${c.confidence.toFixed(2)}${c.hardLimit ? `, LIMIT ${c.hardLimit.op} ${c.hardLimit.value}` : ""}`;
/** Same criterion across reads: by id, else by what it measures. */
const keyOf = (c: Criterion) => `${c.metric}|${JSON.stringify(c.params ?? {})}`;

const order = (lines: TraceLine[]) => lines.map((l) => l.line);
const agree = (lines: TraceLine[]) => (persona.lineLabels ? pilotAgreement(order(lines), labels).share : NaN);
const jsp = (lines: TraceLine[]) => (judge ? scorecard("", order(lines), judge).spearman : NaN);

/** Each criterion's share of a line's shortfall S, and S itself. */
function penalties(l: TraceLine): { byId: Map<string, number>; S: number } {
  const entries = Object.entries(l.r);
  const W = entries.reduce((s, [, v]) => s + v[2], 0) || 1;
  const byId = new Map(entries.map(([id, v]) => [id, (v[2] * (1 - v[1]) ** 2) / W]));
  return { byId, S: [...byId.values()].reduce((a, b) => a + b, 0) };
}

/** Why line a moved between two reads: each criterion's change in its share of the shortfall (positive = pulled it down). */
function drivers(before: TraceLine, after: TraceLine, mBefore: PilotModel, mAfter: PilotModel): string {
  const pb = penalties(before).byId;
  const pa = penalties(after).byId;
  const labelOf = new Map([...mBefore.criteria, ...mAfter.criteria].map((c) => [c.id, c.label]));
  const ids = new Set([...pb.keys(), ...pa.keys()]);
  return [...ids]
    .map((id) => ({ id, d: (pa.get(id) ?? 0) - (pb.get(id) ?? 0) }))
    .filter((x) => Math.abs(x.d) >= 0.002)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 4)
    .map((x) => `${labelOf.get(x.id) ?? x.id} ${x.d > 0 ? "▼" : "▲"}${Math.abs(x.d * 100).toFixed(1)}`)
    .join(", ");
}

/** What the brain changed between two reads. */
function modelDiff(a: PilotModel, b: PilotModel): string[] {
  const lines: string[] = [];
  const byKeyA = new Map(a.criteria.map((c) => [keyOf(c), c]));
  const byKeyB = new Map(b.criteria.map((c) => [keyOf(c), c]));
  const byIdA = new Map(a.criteria.map((c) => [c.id, c]));
  const matched = new Set<Criterion>();
  for (const c of b.criteria) {
    const prev = byIdA.get(c.id) ?? byKeyA.get(keyOf(c));
    if (!prev) {
      lines.push(`+ ADDED ${critLine(c)}`);
      continue;
    }
    matched.add(prev);
    const ch: string[] = [];
    if (Math.abs(prev.weight - c.weight) >= 0.03) ch.push(`weight ${prev.weight.toFixed(2)}→${c.weight.toFixed(2)}`);
    if (prev.metric !== c.metric) ch.push(`metric ${prev.metric}→${c.metric}`);
    if (shapeText(prev) !== shapeText(c)) ch.push(`shape ${shapeText(prev)} → ${shapeText(c)}`);
    if (paramsText(prev) !== paramsText(c)) ch.push(`params ${paramsText(prev) || "∅"} → ${paramsText(c) || "∅"}`);
    if (JSON.stringify(prev.hardLimit ?? null) !== JSON.stringify(c.hardLimit ?? null)) ch.push(`limit ${JSON.stringify(prev.hardLimit ?? null)} → ${JSON.stringify(c.hardLimit ?? null)}`);
    if (Math.abs(prev.confidence - c.confidence) >= 0.15) ch.push(`conf ${prev.confidence.toFixed(2)}→${c.confidence.toFixed(2)}`);
    if (ch.length) lines.push(`~ ${c.label}: ${ch.join("; ")}`);
  }
  for (const c of a.criteria) if (!matched.has(c) && !byKeyB.has(keyOf(c)) && !b.criteria.some((x) => x.id === c.id)) lines.push(`- DROPPED ${critLine(c)}`);
  if (JSON.stringify(a.home) !== JSON.stringify(b.home)) lines.push(`~ home: ${JSON.stringify(a.home)} → ${JSON.stringify(b.home)}`);
  return lines;
}

/** Where the fit moved weights away from the brain's. */
function fitDiff(m: PilotModel, f: PilotModel): string {
  return f.criteria
    .map((c) => ({ c, from: m.criteria.find((x) => x.id === c.id)!.weight }))
    .filter((x) => Math.abs(x.c.weight - x.from) >= 0.03)
    .map((x) => `${x.c.label} ${x.from.toFixed(2)}→${x.c.weight.toFixed(2)}`)
    .join("; ");
}

const verdictRow = (lines: TraceLine[]) => {
  const rank = new Map(lines.map((l) => [l.line, l.rank]));
  const g = (lab: string) =>
    Object.entries(labels)
      .filter(([, v]) => v === lab)
      .map(([l]) => `${l}:${rank.get(l)}`)
      .join(" ");
  return `top[${g("top")}] fine[${g("fine")}] never[${g("never")}]`;
};

/** Verdict pairs the ranking gets backwards, with the criteria that put them that way round. */
function verdictMisses(lines: TraceLine[], m: PilotModel): string[] {
  const RANK = { top: 3, fine: 2, never: 1 } as const;
  const by = new Map(lines.map((l) => [l.line, l]));
  const res: string[] = [];
  const ls = Object.keys(labels);
  for (const a of ls)
    for (const b of ls) {
      if (RANK[labels[a]] <= RANK[labels[b]]) continue;
      const A = by.get(a)!;
      const B = by.get(b)!;
      if (A.rank < B.rank) continue;
      // a should beat b but doesn't: which criteria cost a more than b.
      const pa = penalties(A).byId;
      const pb = penalties(B).byId;
      const parts = m.criteria
        .map((c) => ({ c, d: (pa.get(c.id) ?? 0) - (pb.get(c.id) ?? 0) }))
        .filter((x) => Math.abs(x.d) >= 0.003)
        .sort((x, y) => y.d - x.d)
        .map((x) => `${x.c.label} ${x.d > 0 ? "against" : "for"} ${a} ${(Math.abs(x.d) * 100).toFixed(1)} (${fmt(x.c.metric, A.r[x.c.id]?.[0] ?? null)} vs ${fmt(x.c.metric, B.r[x.c.id]?.[0] ?? null)})`);
      res.push(`  ${a} (${labels[a]}, #${A.rank}, ${A.score}) below ${b} (${labels[b]}, #${B.rank}, ${B.score}): ${parts.join("; ")}`);
    }
  return res;
}

w(`# ${persona.id} ${tag}: the interview, answer by answer\n`);
w(`Penalty numbers are each criterion's share of a line's shortfall, ×100 (▼ = cost the line more after this answer, ▲ = less). Ranks are after fitting to the line choices made so far unless marked "pre".\n`);
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  const prev = steps[i - 1];
  w(`\n## Step ${i}${i === 0 ? " — the opening (story, commute, cities)" : ""}`);
  if (i > 0) {
    w(`**Q:** ${s.question.replace(/\s+/g, " ").slice(0, 600)}`);
    w(`**A:** ${s.answer.replace(/\s+/g, " ").slice(0, 700)}`);
  }
  w(`agreement pre ${agree(s.pre)} / post ${agree(s.post)} · judge pre ${jsp(s.pre)} / post ${jsp(s.post)} · ${s.choicesSoFar} choices so far · read $${s.costUsd.toFixed(3)}`);
  w(`verdict lines (post): ${verdictRow(s.post)}`);
  if (i === 0) {
    w(`\nCriteria:`);
    for (const c of [...s.model.criteria].sort((a, b) => b.weight - a.weight)) w(`- ${critLine(c)}`);
  } else {
    const diff = modelDiff(prev.model, s.model);
    w(`\nWhat the brain changed (${diff.length}):`);
    for (const d of diff) w(`- ${d}`);
    const fd = fitDiff(s.model, s.fitted);
    if (fd) w(`Fit moved: ${fd}`);
    const before = new Map(prev.post.map((l) => [l.line, l]));
    const movers = s.post
      .map((l) => ({ l, b: before.get(l.line)! }))
      .filter((x) => x.b && (Math.abs(x.b.rank - x.l.rank) >= 5 || (x.b.rank <= 10) !== (x.l.rank <= 10) || labels[x.l.line] && x.b.rank !== x.l.rank && Math.abs(x.b.rank - x.l.rank) >= 3))
      .sort((a, b) => Math.abs(b.b.rank - b.l.rank) - Math.abs(a.b.rank - a.l.rank));
    if (movers.length) {
      w(`\nLines that moved (${movers.length}):`);
      for (const { l, b } of movers)
        w(`- ${l.line}${labels[l.line] ? ` (${labels[l.line]})` : ""}${judge ? ` [${judge.tiers[l.line]}]` : ""}: #${b.rank}→#${l.rank}, ${b.score}→${l.score} — ${drivers(b, l, prev.fitted, s.fitted)}`);
    }
  }
}

const last = steps.at(-1)!;
w(`\n\n# Final model\n`);
for (const c of [...last.fitted.criteria].sort((a, b) => b.weight - a.weight)) w(`- ${critLine(c)}`);
w(`\nagreement ${agree(last.post)} (pre-fit ${agree(last.pre)}), judge ${jsp(last.post)} (pre-fit ${jsp(last.pre)})`);
w(`\n## Verdict pairs the final ranking gets backwards\n`);
const misses = verdictMisses(last.post, last.fitted);
w(misses.length ? misses.join("\n") : "(none)");

w(`\n## Every line, best first\n`);
w(`rank · line · score · verdict · judge tier · biggest penalties (share of shortfall ×100, with the line's value) · best points`);
const crit = new Map(last.fitted.criteria.map((c) => [c.id, c]));
for (const l of last.post) {
  const p = penalties(l);
  const pen = [...p.byId.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .filter(([, v]) => v >= 0.002)
    .map(([id, v]) => `${crit.get(id)?.label ?? id} ${(v * 100).toFixed(1)} (${fmt(crit.get(id)?.metric ?? "", l.r[id][0])})`);
  const good = Object.entries(l.r)
    .filter(([id, v]) => v[1] >= 0.85 && (crit.get(id)?.weight ?? 0) >= 0.3)
    .map(([id, v]) => `${crit.get(id)?.label ?? id} (${fmt(crit.get(id)?.metric ?? "", v[0])})`)
    .slice(0, 3);
  const tier = judge?.tiers[l.line] ?? "";
  const flag = (tier === "A" || tier === "B") && l.rank > 35 ? " ⚠ judge rates it high" : (tier === "D" || tier === "E") && l.rank <= 15 ? " ⚠ judge rates it low" : "";
  w(`${String(l.rank).padStart(2)} · ${l.line} · ${l.score}${l.capped ? " (capped)" : ""} · ${labels[l.line] ?? "-"} · ${tier}${flag} · ${pen.join(", ") || "—"} · ${good.join(", ") || "—"}`);
}
const file = `.cache/eval/trace/${persona.id}-${tag}.md`;
writeFileSync(file, out.join("\n"));
console.log(`wrote ${file} (${out.length} lines)`);
