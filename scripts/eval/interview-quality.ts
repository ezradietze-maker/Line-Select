/**
 * How a simulated interview *felt* and how well it ranked — read from the
 * files `simulate.ts` writes. One row per run, so a baseline and a change can
 * be put side by side:
 *
 * - questions, and the share that were line-versus-line choices
 * - near-ties: line choices answered "just" (or "can't choose") — a coin-flip for the pilot, little for the model
 * - repeated trades: the same two measures pitted against each other more than twice
 * - the most any one line was shown, and the average question length
 * - how many questions opened by acknowledging the last answer
 * - accuracy: agreement with the pilot's own verdicts, and the judge's Spearman
 * - made-up words: phrases no pilot says ("joins from", "layover value" — see `lib/brain/pilot-words.ts`) in the
 *   questions, replies, the brain's priority names, its summary and its thread topics; listed under the table
 *
 * Usage: npx tsx scripts/eval/interview-quality.ts <tag> [<tag> …]   (e.g. base after)
 */
import { existsSync, readFileSync } from "node:fs";
import { avoidedPhrases } from "@/lib/brain/pilot-words";

const PERSONAS = ["expilot-readback", "ind-local-family", "mem-757-bodyclock"];
const tags = process.argv.slice(2);

interface Asked {
  kind: string;
  words: number;
  ack: string;
  pair?: { a: string; b: string; trade: string; strength?: string; variables?: number };
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");

console.log(["persona", "tag", "Qs", "open Qs", "line choices", "vars/choice", "bid checks", "near-ties", "repeat trades", "max line shown", "avg words", "acks", "made-up words", "pilot agree", "judge", "spend"].join("\t"));
const madeUpFound: string[] = [];
for (const persona of PERSONAS)
  for (const tag of tags) {
    const file = `.cache/eval/sim/${persona}-${tag}.json`;
    if (!existsSync(file)) continue;
    const r = JSON.parse(readFileSync(file, "utf8")) as {
      asked?: Asked[];
      spend?: number;
      pilotAgreement?: number;
      judgeSpearman?: number;
      exchanges?: { question: string; answer: string }[];
      model?: { synopsis?: string; criteria?: { label: string }[]; threads?: { topic: string }[] };
    };
    // What the app said — the questions and replies, and the brain's words the pilot reads — against what the pilot said.
    const theirs = (r.exchanges ?? []).map((e) => e.answer).join(" ");
    const said = [
      ...(r.exchanges ?? []).map((e) => e.question),
      ...(r.asked ?? []).map((a) => a.ack),
      ...(r.model?.criteria ?? []).map((c) => c.label),
      r.model?.synopsis ?? "",
      ...(r.model?.threads ?? []).map((t) => t.topic),
    ];
    const madeUp = said.flatMap((t) => avoidedPhrases(t, theirs).map((x) => `${persona}-${tag}: “${x}” in “${t.slice(0, 120)}”`));
    madeUpFound.push(...madeUp);
    const asked = r.asked ?? [];
    const pairs = asked.filter((a) => a.pair);
    const nearTies = pairs.filter((a) => a.pair!.strength !== "strongly").length;
    const tradeCounts = new Map<string, number>();
    for (const a of pairs) tradeCounts.set(a.pair!.trade, (tradeCounts.get(a.pair!.trade) ?? 0) + 1);
    const repeats = [...tradeCounts.values()].reduce((s, n) => s + Math.max(0, n - 2), 0);
    const lineCounts = new Map<string, number>();
    for (const a of pairs) for (const l of [a.pair!.a, a.pair!.b]) lineCounts.set(l, (lineCounts.get(l) ?? 0) + 1);
    const avgWords = asked.length ? asked.reduce((s, a) => s + a.words, 0) / asked.length : 0;
    console.log(
      [
        persona,
        tag,
        asked.length,
        asked.filter((a) => a.kind === "free-text" || a.kind === "choice" || a.kind === "dealbreaker").length,
        `${pairs.length} (${pct(pairs.length, asked.length)})`,
        pairs.length ? (pairs.reduce((s, a) => s + (a.pair!.variables ?? 2), 0) / pairs.length).toFixed(1) : "—",
        asked.filter((a) => a.kind === "bid-check").length,
        `${nearTies}/${pairs.length}`,
        repeats,
        Math.max(0, ...lineCounts.values()),
        avgWords.toFixed(0),
        `${asked.filter((a) => a.ack.trim()).length}/${asked.length}`,
        madeUp.length,
        r.pilotAgreement ?? "—",
        r.judgeSpearman ?? "—",
        r.spend !== undefined ? `$${r.spend.toFixed(2)}` : "—",
      ].join("\t")
    );
  }
if (madeUpFound.length) console.log(`\nMade-up words:\n${madeUpFound.join("\n")}`);
