/**
 * What a pilot would check: the model the brain built from their interview,
 * in plain words, and the top and bottom of the ranking it produces — each
 * line with what moved it. Prints Markdown.
 *
 * Usage: npx tsx scripts/eval/review.ts <persona-id> <model> > out.md
 */
import { readFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { BRAIN_PROMPT_VERSION, type BuildModelResult } from "@/lib/brain/build-model";
import { describeModel, formatValue } from "@/lib/brain/describe";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import { rankPackV2, type V2LineScore } from "@/lib/scoring-v2/score";
import { PERSONAS } from "./personas";

const persona = PERSONAS.find((p) => p.id === process.argv[2])!;
const model = process.argv[3] ?? "claude-fable-5-1";
const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
const brain: BuildModelResult = JSON.parse(readFileSync(`.cache/eval/brain-${persona.id}-${model}-v${BRAIN_PROMPT_VERSION}.json`, "utf8"));
const ranked = rankPackV2(pack, brain.model);

const out: string[] = [];
out.push(`# What we heard — ${pack.month} ${pack.base} ${pack.aircraft} ${pack.seat}`, "", `> ${brain.model.synopsis}`, "");
const h = brain.model.home;
if (h) out.push(`**Home:** ${h.airports.join(", ") || "—"} · ${h.commuter ? "commutes" : "local"}${h.commuteBufferHours !== undefined ? ` · at base ${h.commuteBufferHours} h before a report` : ""}${h.frontBufferHours !== undefined ? ` · ${h.frontBufferHours} h before flying when deviating` : ""}${h.backRestHours !== undefined ? ` · ${h.backRestHours} h rest before heading home` : ""}${h.backupFlights !== undefined ? ` · ${h.backupFlights} backup flights` : ""}`, "");
out.push("## Your priorities, in order", "", "| # | Priority | Share of ranking | How it's measured | How it scores |", "|---|---|---|---|---|");
describeModel(brain.model).forEach((c, i) => out.push(`| ${i + 1} | **${c.label}**${c.dealbreaker ? ` — ${c.dealbreaker}` : ""} | ${c.influence}% | ${c.measuredAs} | ${c.shape} |`));
out.push("", "### Where each came from", "");
for (const c of describeModel(brain.model)) out.push(`- **${c.label}:** ${c.quotes.map((q) => `“${q}”`).join(" · ")}`);
if (brain.model.notMeasurable.length) {
  out.push("", "## Things you said a bid pack can't show", "");
  for (const n of brain.model.notMeasurable) out.push(`- ${n.statement}`);
}
const open = brain.model.threads.filter((t) => t.status === "open").sort((a, b) => b.priority - a.priority);
if (open.length) {
  out.push("", "## What we'd still ask you", "");
  for (const t of open) out.push(`- ${t.topic}`);
}
const lineRow = (r: V2LineScore, rank: number) => {
  const moves = [...r.results].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3);
  const why = moves.map((m) => `${m.contribution >= 0 ? "+" : "−"}${Math.abs(m.contribution).toFixed(0)} ${m.label} (${m.value === null ? "n/a" : formatValue(m.value, METRICS_BY_ID.get(m.metric)!)})`).join("; ");
  const line = pack.lines.find((l) => l.id === r.lineId)!;
  return `| ${rank} | ${r.lineNumber} | ${r.score.toFixed(0)}${r.violations.length ? " ⛔" : ""} | ${line.daysOff} off · ${line.totalCreditHours.toFixed(1)} cr · ${line.trips.length} trips | ${why} |`;
};
out.push("", "## Top 10", "", "| Rank | Line | Score | Line | Biggest reasons |", "|---|---|---|---|---|");
ranked.slice(0, 10).forEach((r, i) => out.push(lineRow(r, i + 1)));
out.push("", "## Bottom 5", "", "| Rank | Line | Score | Line | Biggest reasons |", "|---|---|---|---|---|");
ranked.slice(-5).forEach((r, i) => out.push(lineRow(r, ranked.length - 4 + i)));
console.log(out.join("\n"));
