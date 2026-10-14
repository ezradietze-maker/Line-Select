/**
 * Replays a simulated interview one answer at a time and records, after every
 * answer, what the brain made of everything said so far and how every line in
 * the pack scores against it — before and after fitting to the line choices
 * made so far. `trace-report.ts` turns the record into an answer-by-answer,
 * line-by-line account of what moved and why.
 *
 * A full brain read after every answer (not every few, as the app does), so
 * each answer's effect can be seen on its own. Resumable: steps already in the
 * output file are kept.
 *
 * Usage: npx tsx scripts/eval/trace.ts <persona-id> <sim-tag> [out-suffix]   (a suffix replays the same answers into a
 * separate trace — e.g. after a brain change)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { buildPilotModel, type InterviewExchange } from "@/lib/brain/build-model";
import { bidCheckChoice } from "@/lib/brain/bid-check";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { prepareMetrics } from "@/lib/metrics/compute";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { CityRating, CityRatingScore } from "@/types/preferences";
import type { LineChoice, PilotModel } from "@/types/pilot-model";
import { PERSONAS } from "./personas";

export interface TraceLine {
  line: string;
  score: number;
  rank: number;
  /** Per criterion id: [value, utility, weight used]. */
  r: Record<string, [number | null, number, number]>;
  capped?: boolean;
}
export interface TraceStep {
  /** How many exchanges the brain had read (3 = the opening steps only). */
  upTo: number;
  question: string;
  answer: string;
  choicesSoFar: number;
  model: PilotModel;
  fitted: PilotModel;
  pre: TraceLine[];
  post: TraceLine[];
  costUsd: number;
}

const OPENING = 3;
const LABEL: Record<string, CityRatingScore> = { Love: 2, Like: 1, Dislike: -1, Avoid: -2 };

/** The city step's grades, read back from the simulation's log ("CITY RATINGS: SIN: Love (…) | CAN: Avoid (…)"). */
export function cityRatingsFromLog(file: string): Record<string, CityRating> {
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("CITY RATINGS:")) ?? "";
  const out: Record<string, CityRating> = {};
  for (const part of line.replace("CITY RATINGS:", "").split("|")) {
    const m = part.trim().match(/^([A-Z]{3}): (Love|Like|Dislike|Avoid)/);
    if (m) out[m[1]] = { score: LABEL[m[2]] };
  }
  return out;
}

/** Which exchange each line choice came from — a line pair or a bid check naming its lines. */
export function choiceTurns(exchanges: InterviewExchange[], choices: LineChoice[]): number[] {
  return choices.map((c) => {
    const i = exchanges.findIndex((e) => {
      const q = e.question;
      const pair = q.match(/\[Line (\w+) vs Line (\w+):/);
      if (pair) return [pair[1], pair[2]].includes(c.preferred) && [pair[1], pair[2]].includes(c.other);
      const check = q.match(/^Bid check: Line (\w+) is #/);
      return !!check && (check[1] === c.preferred || check[1] === c.other);
    });
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  });
}

/**
 * A run's line choices with its bid-check verdicts mapped the way the app maps them today (`bidCheckChoice`) — older
 * runs recorded some verdicts ("Lower") as choices the app no longer makes.
 */
export function currentChoices(exchanges: InterviewExchange[], choices: LineChoice[]): LineChoice[] {
  const checks = exchanges.filter((e) => e.question.startsWith("Bid check:"));
  return choices.filter((c) => {
    const e = checks.find((x) => x.question.includes(`Line ${c.preferred} is #`) || x.question.includes(`Line ${c.other} is #`));
    if (!e) return true;
    const options = e.question.match(/\(options: (.*)\)$/)?.[1].split(" / ") ?? [];
    const i = options.findIndex((o) => e.answer.startsWith(o));
    return bidCheckChoice({ line: "x", alt: "y", kind: / is #\d+ of \d+ on your list/.test(e.question) ? "middle" : "top" }, i) !== null;
  });
}

export function scoreAll(bidPack: Parameters<typeof scorePackV2>[0], model: PilotModel, pm: ReturnType<typeof prepareMetrics>): TraceLine[] {
  const s = scorePackV2(bidPack, model, { pack: pm }).sort((a, b) => b.score - a.score || a.lineNumber.localeCompare(b.lineNumber));
  return s.map((x, i) => ({
    line: x.lineNumber,
    score: x.score,
    rank: i + 1,
    r: Object.fromEntries(x.results.map((r) => [r.criterionId, [r.value, +r.utility.toFixed(4), +r.weight.toFixed(4)]])),
    ...(x.violations.length ? { capped: true } : {}),
  }));
}

if (process.argv[1]?.endsWith("trace.ts")) {
  (async () => {
    process.loadEnvFile(".env.local");
    const [personaId, tag, suffix] = process.argv.slice(2);
    const persona = PERSONAS.find((p) => p.id === personaId)!;
    const run = JSON.parse(readFileSync(`.cache/eval/sim/${persona.id}-${tag}.json`, "utf8")) as { exchanges: InterviewExchange[]; choices: LineChoice[] };
    const ratings = cityRatingsFromLog(`.cache/eval/sim/${persona.id}-${tag}.txt`);
    const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
    const pm = prepareMetrics(pack);
    const brief = buildPackBrief(pack, pm);
    const home = persona.commuteFrom;
    const context = `${pack.aircraft} ${pack.seat === "CAP" ? "captain" : "first officer"} based in ${pack.base} (${pack.month} bid pack, ${pack.lines.length} lines). ${persona.isCommuter ? `Commutes to base${home ? ` from ${home}` : ""}.` : "Lives in base."} FedEx lets pilots deviate from a scheduled deadhead and ride a different airline flight on their own to the same city.`;
    const turns = choiceTurns(run.exchanges, run.choices);
    mkdirSync(".cache/eval/trace", { recursive: true });
    const out = `.cache/eval/trace/${persona.id}-${tag}${suffix ? `-${suffix}` : ""}.json`;
    const steps: TraceStep[] = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : [];
    let prior: PilotModel | null = steps.at(-1)?.model ?? null;
    let spend = 0;
    for (let upTo = OPENING + steps.length; upTo <= run.exchanges.length; upTo++) {
      const exchanges = run.exchanges.slice(0, upTo);
      const r = await buildPilotModel({ packBrief: brief, pilotContext: context, exchanges, prior, model: "claude-sonnet-5-5", effort: "high" });
      spend += r.usage.costUsd;
      const model = applyCityRatings(r.model, ratings);
      const choices = run.choices.filter((_, i) => turns[i] < upTo);
      const fitted = choices.length ? fitWeightsToChoices(pack, model, choices, pm).model : model;
      const last = exchanges.at(-1)!;
      steps.push({ upTo, question: last.question, answer: last.answer, choicesSoFar: choices.length, model, fitted, pre: scoreAll(pack, model, pm), post: scoreAll(pack, fitted, pm), costUsd: r.usage.costUsd });
      writeFileSync(out, JSON.stringify(steps));
      prior = model;
      console.log(`step ${steps.length - 1} (read ${upTo} exchanges): ${model.criteria.length} criteria, $${r.usage.costUsd.toFixed(3)}, ${(r.usage.ms / 1000).toFixed(0)}s — ${last.question.slice(0, 80)}`);
    }
    console.log(`done: ${steps.length} steps, $${spend.toFixed(2)} this run`);
  })();
}
