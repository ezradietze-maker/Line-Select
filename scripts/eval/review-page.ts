/**
 * Builds the readback page a real pilot checks: the model the brain built
 * from their interview, in plain words, plus the top and bottom of the
 * ranking it produces. They mark what's right and wrong and copy their
 * answers back — the first real-pilot ground truth for the system.
 *
 * Usage: npx tsx scripts/eval/review-page.ts <persona-id> <brain-file-suffix> <out.html>
 *   e.g. npx tsx scripts/eval/review-page.ts expilot-full claude-fable-5-1-v3 /tmp/readback.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import type { BuildModelResult } from "@/lib/brain/build-model";
import { describeModel, formatValue } from "@/lib/brain/describe";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import { prepareMetrics } from "@/lib/metrics/compute";
import { rankPackV2, type V2LineScore } from "@/lib/scoring-v2/score";
import { tripDuties, tripHeadline } from "@/lib/brain/line-text";
import { exchangesOf, PERSONAS } from "./personas";

const [personaId, brainSuffix, outFile, changesFile] = process.argv.slice(2);
/** Optional: a round-two readback says what changed since the pilot's last corrections, and how it was built. */
const round: { intro?: string; changes?: string[] } = changesFile ? JSON.parse(readFileSync(changesFile, "utf8")) : {};
const persona = PERSONAS.find((p) => p.id === personaId)!;
const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
const brain: BuildModelResult = JSON.parse(readFileSync(`.cache/eval/brain-${persona.id}-${brainSuffix}.json`, "utf8"));
const pm = prepareMetrics(pack);
const ranked = rankPackV2(pack, brain.model, { pack: pm });

function reasons(r: V2LineScore): string[] {
  return [...r.results]
    .filter((m) => Math.abs(m.contribution) >= 0.5)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3)
    .map((m) => `${m.contribution >= 0 ? "+" : "−"} ${m.label}${m.value === null ? "" : ` (${formatValue(m.value, METRICS_BY_ID.get(m.metric)!)})`}`);
}

const lineCard = (r: V2LineScore, rank: number) => {
  const line = pack.lines.find((l) => l.id === r.lineId)!;
  return { rank, line: r.lineNumber, daysOff: line.daysOff, credit: +line.totalCreditHours.toFixed(1), trips: line.trips.map((t) => ({ head: tripHeadline(pack, t), duties: tripDuties(t) })), reasons: reasons(r) };
};

const h = brain.model.home;
const data = {
  pack: `${pack.aircraft} ${pack.seat === "CAP" ? "Captain" : "First Officer"} · ${pack.base} · ${pack.month}`,
  lines: pack.lines.length,
  answers: exchangesOf(persona).length - 1,
  intro: round.intro ?? null,
  changes: round.changes ?? [],
  synopsis: brain.model.synopsis,
  home: h
    ? [
        h.airports.length ? `Flies from ${h.airports.join(", ")}` : "",
        h.commuter ? "commutes to base" : "lives in base",
        h.commuteBufferHours !== undefined ? `in base ${h.commuteBufferHours} h before a report` : "",
        h.frontBufferHours !== undefined ? `${h.frontBufferHours} h before flying when deviating` : "",
        h.backRestHours !== undefined ? `${h.backRestHours} h rest before heading home` : "",
        h.backupFlights !== undefined ? `${h.backupFlights} backup flights` : "",
      ].filter(Boolean).join(" · ")
    : "",
  priorities: describeModel(brain.model).map((c) => ({ id: c.id, label: c.label, share: c.influence, measured: c.measuredAs, scores: c.shape, dealbreaker: c.dealbreaker, quote: c.quotes[0] ?? "" })),
  notMeasurable: brain.model.notMeasurable.map((n) => n.statement),
  questions: brain.model.threads.filter((t) => t.status === "open").sort((a, b) => b.priority - a.priority).slice(0, 5).map((t) => ({ id: t.id, text: t.topic })),
  top: ranked.slice(0, 10).map((r, i) => lineCard(r, i + 1)),
  bottom: ranked.slice(-5).map((r, i) => lineCard(r, ranked.length - 4 + i)),
};

const template = readFileSync("scripts/eval/readback-template.html", "utf8");
writeFileSync(outFile, template.replace("/*__DATA__*/null", JSON.stringify(data).replace(/</g, "\\u003c")));
console.log(`wrote ${outFile}: ${data.priorities.length} priorities, ${data.questions.length} questions, ${data.top.length + data.bottom.length} lines`);
