/**
 * The trace (`trace.ts`) as one page: the interview answer by answer — what the
 * brain changed, how the pilot's verdicts and the judge moved, which lines
 * moved and which criteria moved them — then every line in the pack against
 * every criterion of the final model: its value, how well it does (utility),
 * and that criterion's share of the line's shortfall. Re-scored with today's
 * code. Written to the gitignored eval cache: it holds a pilot's own words.
 *
 * Usage: npx tsx scripts/eval/trace-html.ts <persona-id> <trace-tag>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import type { InterviewExchange } from "@/lib/brain/build-model";
import { formatValue } from "@/lib/brain/describe";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import { prepareMetrics } from "@/lib/metrics/compute";
import type { Criterion, LineChoice, PilotModel } from "@/types/pilot-model";
import type { Judgment } from "./judge";
import { pilotAgreement, scorecard } from "./metrics";
import { PERSONAS } from "./personas";
import { choiceTurns, currentChoices, scoreAll, type TraceLine, type TraceStep } from "./trace";

const [personaId, tag] = process.argv.slice(2);
const persona = PERSONAS.find((p) => p.id === personaId)!;
const steps: TraceStep[] = JSON.parse(readFileSync(`.cache/eval/trace/${persona.id}-${tag}.json`, "utf8"));
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
const judgeFile = `.cache/eval/judge-${persona.id}.json`;
const judge: Judgment | null = existsSync(judgeFile) ? JSON.parse(readFileSync(judgeFile, "utf8")) : null;
const labels = persona.lineLabels ?? {};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (metric: string, v: number | null) => {
  const def = METRICS_BY_ID.get(metric);
  return v === null ? "—" : def ? formatValue(v, def) : String(+v.toFixed(2));
};
const shape = (c: Criterion) => {
  const s = c.shape as Record<string, unknown>;
  return [s.kind, ...Object.entries(s).filter(([k]) => k !== "kind").map(([k, v]) => `${k} ${v}`)].join(", ");
};
const order = (ls: TraceLine[]) => ls.map((l) => l.line);
const agree = (ls: TraceLine[]) => (persona.lineLabels ? pilotAgreement(order(ls), labels).share : NaN);
const jsp = (ls: TraceLine[]) => (judge ? scorecard("", order(ls), judge).spearman : NaN);
function penalties(l: TraceLine) {
  const e = Object.entries(l.r);
  const W = e.reduce((s, [, v]) => s + v[2], 0) || 1;
  return new Map(e.map(([id, v]) => [id, (v[2] * (1 - v[1]) ** 2) / W]));
}
const keyOf = (c: Criterion) => `${c.metric}|${JSON.stringify(c.params?.cities ?? c.params?.n ?? c.params?.dates ?? "")}`;

function modelDiff(a: PilotModel, b: PilotModel): string[] {
  const out: string[] = [];
  const A = new Map(a.criteria.map((c) => [c.id, c]));
  const AK = new Map(a.criteria.map((c) => [keyOf(c), c]));
  const seen = new Set<Criterion>();
  for (const c of b.criteria) {
    const p = A.get(c.id) ?? AK.get(keyOf(c));
    if (!p) {
      out.push(`<b>added</b> ${esc(c.label)} <span class="m">(${c.metric}; ${esc(shape(c))}; weight ${c.weight.toFixed(2)}${c.hardLimit ? `; limit ${c.hardLimit.op} ${c.hardLimit.value}` : ""})</span>`);
      continue;
    }
    seen.add(p);
    const ch: string[] = [];
    if (Math.abs(p.weight - c.weight) >= 0.03) ch.push(`weight ${p.weight.toFixed(2)} → <b>${c.weight.toFixed(2)}</b>`);
    if (shape(p) !== shape(c)) ch.push(`shape ${esc(shape(p))} → <b>${esc(shape(c))}</b>`);
    if (JSON.stringify(p.hardLimit ?? null) !== JSON.stringify(c.hardLimit ?? null)) ch.push(`limit → ${c.hardLimit ? `${c.hardLimit.op} ${c.hardLimit.value}` : "none"}`);
    const pc = JSON.stringify(Object.entries(p.params?.cityScores ?? {}).sort());
    const cc = JSON.stringify(Object.entries(c.params?.cityScores ?? {}).sort());
    if (pc !== cc) ch.push("city grades changed");
    if (ch.length) out.push(`${esc(c.label)}: ${ch.join("; ")}`);
  }
  for (const c of a.criteria) if (!seen.has(c) && !b.criteria.some((x) => x.id === c.id || keyOf(x) === keyOf(c))) out.push(`<b>dropped</b> ${esc(c.label)}`);
  return out;
}

function movers(prev: TraceStep, s: TraceStep): string[] {
  const before = new Map(prev.post.map((l) => [l.line, l]));
  const labelOf = new Map([...prev.fitted.criteria, ...s.fitted.criteria].map((c) => [c.id, c.label]));
  return s.post
    .map((l) => ({ l, b: before.get(l.line)! }))
    .filter((x) => x.b && (Math.abs(x.b.rank - x.l.rank) >= 5 || (x.b.rank <= 10) !== (x.l.rank <= 10) || (labels[x.l.line] && Math.abs(x.b.rank - x.l.rank) >= 3)))
    .sort((a, b) => Math.abs(b.b.rank - b.l.rank) - Math.abs(a.b.rank - a.l.rank))
    .slice(0, 12)
    .map(({ l, b }) => {
      const pb = penalties(b);
      const pa = penalties(l);
      const why = [...new Set([...pb.keys(), ...pa.keys()])]
        .map((id) => ({ id, d: (pa.get(id) ?? 0) - (pb.get(id) ?? 0) }))
        .filter((x) => Math.abs(x.d) >= 0.002)
        .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
        .slice(0, 3)
        .map((x) => `<span class="${x.d > 0 ? "dn" : "up"}">${esc(labelOf.get(x.id) ?? x.id)} ${x.d > 0 ? "▼" : "▲"}${Math.abs(x.d * 100).toFixed(1)}</span>`)
        .join(" ");
      const tagv = labels[l.line] ? `<i>${labels[l.line]}</i> ` : "";
      return `<li>${l.line} ${tagv}${judge ? `<span class="t t${judge.tiers[l.line]}">${judge.tiers[l.line]}</span>` : ""} #${b.rank} → <b>#${l.rank}</b> — ${why}</li>`;
    });
}

const kindOf = (q: string) => (/\[Line \w+ vs Line \w+:/.test(q) ? "line choice" : q.startsWith("Bid check:") ? "bid check" : q.startsWith("Dealbreakers") ? "dealbreakers" : q.startsWith("When these pull") ? "priority order" : q.startsWith("Anything else") ? "anything else" : "open");

const html: string[] = [];
const last = steps.at(-1)!;
html.push(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview trace · ${esc(persona.id)} ${esc(tag)}</title>
<style>
:root{--bg:#faf8f4;--ink:#1d1a16;--mut:#6b645a;--line:#e3ddd2;--up:#1f7a4d;--dn:#b23b2a;--hi:#fff2cc}
@media (prefers-color-scheme:dark){:root{--bg:#16130f;--ink:#ece6dc;--mut:#a39a8c;--line:#3a332a;--up:#5fc58f;--dn:#ff8a78;--hi:#3d3416}}
body{background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;max-width:1400px;margin:auto}
h1{font-size:22px}h2{font-size:17px;margin-top:32px}.m{color:var(--mut)}.up{color:var(--up)}.dn{color:var(--dn)}
.step{border-top:1px solid var(--line);padding:12px 0}.q{font-weight:600}.a{color:var(--mut);margin:4px 0 8px}
.kpi{font-variant-numeric:tabular-nums}.t{display:inline-block;min-width:16px;text-align:center;border-radius:4px;font-size:11px;padding:0 3px;border:1px solid var(--line)}
.tA,.tB{color:var(--up)}.tD,.tE{color:var(--dn)}ul{margin:4px 0;padding-left:20px}
.grid{overflow:auto;max-height:80vh;border:1px solid var(--line)}table{border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:right;white-space:nowrap}th{position:sticky;top:0;background:var(--bg);text-align:left;vertical-align:bottom}
td:first-child,th:first-child{position:sticky;left:0;background:var(--bg);text-align:left}
td small{color:var(--mut);display:block}
</style>`);
html.push(`<h1>${esc(persona.id)} · ${esc(tag)} — the interview, answer by answer</h1>`);
html.push(`<p class="m">After every answer the brain re-read everything said so far; every line in the pack was scored against what it then believed. "Agreement" is the share of the pilot's own verdict pairs (top / fine / never) the ranking orders right; "judge" is Spearman against an AI's careful A–E grading of every line from the pilot's words. Penalty numbers are a criterion's share of a line's shortfall ×100 — ▼ cost the line more after that answer, ▲ less.</p>`);
html.push(`<p class="kpi">Final: agreement <b>${agree(last.post)}</b> (before line-choice fitting ${agree(last.pre)}) · judge <b>${jsp(last.post)}</b> (before fitting ${jsp(last.pre)}) · ${steps.length - 1} answers · ${run.choices.length} line choices</p>`);
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  html.push(`<div class="step"><div class="q">${i === 0 ? "Opening — story, commute, layover cities" : `${i}. <span class="m">[${kindOf(s.question)}]</span> ${esc(s.question.replace(/\s+/g, " ").slice(0, 500))}`}</div>`);
  if (i > 0) html.push(`<div class="a">${esc(s.answer.replace(/\s+/g, " ").slice(0, 700))}</div>`);
  const pa = i ? agree(steps[i - 1].post) : agree(s.post);
  const pj = i ? jsp(steps[i - 1].post) : jsp(s.post);
  const d = (x: number, y: number) => (Math.abs(x - y) < 0.0005 ? "" : ` <span class="${x > y ? "up" : "dn"}">${x > y ? "+" : ""}${(x - y).toFixed(3)}</span>`);
  html.push(`<div class="kpi">agreement ${agree(s.post)}${d(agree(s.post), pa)} · judge ${jsp(s.post)}${d(jsp(s.post), pj)}</div>`);
  if (i === 0) {
    html.push(`<ul>${[...s.model.criteria].sort((a, b) => b.weight - a.weight).map((c) => `<li>${esc(c.label)} <span class="m">(${c.metric}; ${esc(shape(c))}; weight ${c.weight.toFixed(2)})</span></li>`).join("")}</ul>`);
  } else {
    const diff = modelDiff(steps[i - 1].model, s.model);
    html.push(diff.length ? `<div>What the brain changed:</div><ul>${diff.map((x) => `<li>${x}</li>`).join("")}</ul>` : `<div class="m">The brain changed nothing.</div>`);
    const mv = movers(steps[i - 1], s);
    if (mv.length) html.push(`<div>Lines that moved:</div><ul>${mv.join("")}</ul>`);
  }
  html.push(`</div>`);
}

// Every line × every criterion.
const crit = [...last.fitted.criteria].sort((a, b) => b.weight - a.weight);
html.push(`<h2>Every line against every criterion (final model, after line-choice fitting)</h2>`);
html.push(`<p class="m">Each cell: the line's value · how well it does on it (0–1, past 1 or below 0 is beyond the pilot's anchors) · that criterion's share of the line's shortfall ×100 (the bigger, the more it holds the line down). Highlighted: the line's two biggest penalties.</p>`);
html.push(`<div class="grid"><table><tr><th>#&nbsp;line · score · verdict · judge</th>${crit.map((c) => `<th title="${esc(c.metric + "; " + shape(c))}">${esc(c.label)}<small>weight ${c.weight.toFixed(2)}</small></th>`).join("")}</tr>`);
for (const l of last.post) {
  const p = penalties(l);
  const top2 = [...p.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id);
  html.push(
    `<tr><td>#${l.rank} <b>${l.line}</b> · ${l.score}${l.capped ? " (capped)" : ""} · ${labels[l.line] ?? "–"} · ${judge ? `<span class="t t${judge.tiers[l.line]}">${judge.tiers[l.line]}</span>` : ""}</td>${crit
      .map((c) => {
        const v = l.r[c.id];
        if (!v) return "<td>—</td>";
        return `<td style="${top2.includes(c.id) ? "background:var(--hi)" : ""}">${esc(fmt(c.metric, v[0]))}<small>${v[1].toFixed(2)} · ${((p.get(c.id) ?? 0) * 100).toFixed(1)}</small></td>`;
      })
      .join("")}</tr>`
  );
}
html.push(`</table></div>`);
const file = `.cache/eval/trace/${persona.id}-${tag}.html`;
writeFileSync(file, html.join("\n"));
console.log(`wrote ${file}`);
