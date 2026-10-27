import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BID_CHECK_LEAD } from "@/lib/brain/bid-check";
import { DEALBREAKER_LEAD } from "@/lib/brain/dealbreakers";
import { HUB_TURNS_LEAD, REST_HOTEL_LEAD } from "@/lib/brain/hub-turn-question";
import { nextInterviewStep, SWEEP_QUESTION, type InterviewStepInput, type ThreadState } from "@/lib/brain/interviewer";
import { pickLinePairs } from "@/lib/brain/line-pairs";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { avoidedPhrases, inventedLimit } from "@/lib/brain/pilot-words";
import { PRIORITY_ORDER_LEAD } from "@/lib/brain/priority-order";
import { pickQuestionExamples } from "@/lib/brain/question-examples";
import { TRIP_GRADES_LEAD } from "@/lib/brain/trip-sort";
import type { InterviewExchange } from "@/lib/brain/build-model";
import type { PilotModel } from "@/types/pilot-model";
import { batched } from "./batch";
import { PERSONAS as ALL_PERSONAS, simPilotContext } from "./personas";
import { loadRun } from "./trip-scorecard";

/**
 * The interviewer alone, asked again at the turns of interviews already simulated — for a change to the interviewer
 * (its wording, its checks), which is all a full simulated interview would test about it, at a fraction of the cost: no
 * simulated pilot answering, no brain re-reading, and every turn's call sent together through the Batches API at half
 * price. What a full interview adds — how one turn leads to the next, and how well the ranking comes out — still needs one.
 *
 * Each turn is asked as the simulator recorded it (`<run>.steps.json`, written by simulate.ts since Oct 2026). Older
 * runs didn't record it: their turns are rebuilt from the transcript, with the run's final reading standing in for the
 * brain's model at each turn — close, not exact, and fine for checking how questions and replies are worded.
 *
 * Reports, per run, against the questions the run actually asked: made-up words, replies that invent a limit, questions
 * with examples, and length; and writes old and new side by side to .cache/eval/interviewer-replay-<label>.txt.
 *
 *   npx tsx scripts/eval/interviewer-replay.ts <persona>-<tag> [<persona>-<tag> …] [--every N] [--label x] [--live]
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const runs = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const every = Math.max(1, Number(flag("every") ?? 1));
const label = flag("label") ?? "latest";
const PERSONAS = ["expilot-readback", "ind-local-family", "mem-757-bodyclock"];

/** The fixed questions, which the interviewer didn't write. */
const FIXED = [DEALBREAKER_LEAD, HUB_TURNS_LEAD, REST_HOTEL_LEAD, BID_CHECK_LEAD, PRIORITY_ORDER_LEAD, TRIP_GRADES_LEAD, SWEEP_QUESTION];
/** Opening exchanges before the first question: story, commute, cities. */
const OPENING = 3;

interface Turn {
  run: string;
  input: Omit<InterviewStepInput, "packBrief">;
  asked: { ack: string; prompt: string } | null;
}

function turnsOf(run: string): Turn[] {
  const persona = PERSONAS.find((p) => run.startsWith(`${p}-`));
  if (!persona) throw new Error(`Unknown run ${run}`);
  const tag = run.slice(persona.length + 1);
  const recorded = `.cache/eval/sim/${run}.steps.json`;
  if (existsSync(recorded)) {
    const steps = JSON.parse(readFileSync(recorded, "utf8")) as { input: Omit<InterviewStepInput, "packBrief">; asked: { ack: string; prompt: string } | null }[];
    return steps.map((s) => ({ run, input: s.input, asked: s.asked }));
  }
  // Rebuilt from the transcript: each question the interviewer wrote, and everything before it.
  const r = loadRun(persona, tag)!;
  const saved = JSON.parse(readFileSync(`.cache/eval/sim/${run}.json`, "utf8")) as { exchanges: InterviewExchange[]; preFit: PilotModel };
  const log = readFileSync(`.cache/eval/sim/${run}.txt`, "utf8").split("\n");
  const acks = log.flatMap((l) => (l.match(/^\s*\(ack\)\s*(.*)$/) ? [l.replace(/^\s*\(ack\)\s*/, "")] : []));
  const model = saved.preFit;
  const threads: Record<string, ThreadState> = Object.fromEntries(model.threads.map((t) => [t.id, { status: "open", timesAsked: 0 }]));
  const packNumbers = { lines: r.pack.lines.map((l) => l.lineNumber), trips: [...new Set(r.pack.lines.flatMap((l) => l.trips.map((t) => t.pairingNumber ?? t.id)))] };
  const context = simPilotContext(ALL_PERSONAS.find((p) => p.id === persona)!, r.pack);
  const examples = pickQuestionExamples(r.pack, model, r.pm);
  const linePairs = pickLinePairs(r.pack, model, r.pm, new Set(), 3, []);
  let ack = 0;
  return saved.exchanges.flatMap((e, i) => {
    if (i < OPENING || FIXED.some((f) => e.question.startsWith(f))) return [];
    const turn = { run, input: { pilotContext: context, exchanges: saved.exchanges.slice(0, i), model, threads, linePairs, examples, packNumbers, turn: i - OPENING, maxTurns: 40, rankingShifts: [] }, asked: { ack: acks[ack] ?? "", prompt: e.question.replace(/ \(Examples shown:.*$/, "").replace(/ \[Line \d+ vs Line \d+:.*$/, "") } };
    ack++;
    return [turn];
  });
}

interface Measured {
  words: number;
  madeUp: string[];
  invented: string | null;
  examples: boolean;
}
const measure = (ack: string, prompt: string, examples: boolean, input: Turn["input"]): Measured => ({
  words: prompt.split(/\s+/).filter(Boolean).length,
  madeUp: avoidedPhrases(`${ack} ${prompt}`, input.exchanges.map((e) => e.answer).join(" ")),
  invented: inventedLimit(ack, input.exchanges.at(-1)?.answer ?? ""),
  examples,
});

(async () => {
  process.loadEnvFile(".env.local");
  const turns = runs.flatMap((run) => turnsOf(run).filter((_, i) => i % every === 0));
  const briefs = new Map<string, string>();
  for (const run of runs) {
    const persona = PERSONAS.find((p) => run.startsWith(`${p}-`))!;
    const r = loadRun(persona, run.slice(persona.length + 1))!;
    briefs.set(run, buildPackBrief(r.pack, r.pm));
  }
  console.log(`${turns.length} turns from ${runs.length} run${runs.length === 1 ? "" : "s"}`);
  const ask = (t: Turn) => () => nextInterviewStep({ packBrief: briefs.get(t.run)!, ...t.input });
  let spend: number;
  let steps: PromiseSettledResult<Awaited<ReturnType<typeof nextInterviewStep>>>[];
  if (args.includes("--live")) {
    steps = await Promise.allSettled(turns.map((t) => ask(t)()));
    spend = steps.reduce((a, s) => a + (s.status === "fulfilled" ? (s.value.usage?.costUsd ?? 0) : 0), 0);
  } else {
    const b = await batched(turns.map(ask));
    steps = b.results;
    spend = b.spend;
  }

  const rows: string[] = [];
  const tally = new Map<string, { n: number; before: Measured[]; after: Measured[]; done: number; failed: number }>();
  turns.forEach((t, i) => {
    const s = steps[i];
    const row = tally.get(t.run) ?? { n: 0, before: [], after: [], done: 0, failed: 0 };
    row.n++;
    if (t.asked) row.before.push(measure(t.asked.ack, t.asked.prompt, false, t.input));
    if (s.status === "rejected") row.failed++;
    else if (s.value.done) row.done++;
    else {
      const m = measure(s.value.ack ?? "", s.value.prompt, !!s.value.examples?.length, t.input);
      row.after.push(m);
      rows.push(`${t.run} turn ${t.input.turn}\n  was: ${t.asked ? `(${t.asked.ack}) ${t.asked.prompt}` : "—"}\n  now: (${s.value.ack ?? ""}) ${s.value.prompt}${m.invented ? `   ← invents “${m.invented}”` : ""}${m.madeUp.length ? `   ← made-up “${m.madeUp.join("”, “")}”` : ""}`);
    }
    tally.set(t.run, row);
  });
  const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(0) : "—");
  console.log(["run", "turns", "made-up words was→now", "invented limits was→now", "with examples", "avg words was→now", "done/failed"].join("\t"));
  for (const [run, r] of tally)
    console.log(
      [
        run,
        r.n,
        `${r.before.filter((m) => m.madeUp.length).length}→${r.after.filter((m) => m.madeUp.length).length}`,
        `${r.before.filter((m) => m.invented).length}→${r.after.filter((m) => m.invented).length}`,
        `${r.after.filter((m) => m.examples).length}/${r.after.length}`,
        `${avg(r.before.map((m) => m.words))}→${avg(r.after.map((m) => m.words))}`,
        `${r.done}/${r.failed}`,
      ].join("\t")
    );
  writeFileSync(`.cache/eval/interviewer-replay-${label}.txt`, rows.join("\n\n"));
  console.log(`spend $${spend.toFixed(2)} · side by side in .cache/eval/interviewer-replay-${label}.txt`);
})();
