/**
 * A whole story-driven interview, end to end, with a model playing the
 * pilot. The interview runs exactly as in the app (brain reads, interviewer
 * questions, line pairs, the sweep, the final read, choice fitting); the
 * simulated pilot answers from a truth sheet — their own real words — so we
 * can see the questions it asks, whether it repeats itself, and how the model
 * it ends with ranks against the pilot's own verdicts and the judge.
 *
 * Usage: npx tsx scripts/eval/simulate.ts <persona-id> [tag]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { buildPilotModel, type InterviewExchange } from "@/lib/brain/build-model";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { nextInterviewStep, type ThreadState } from "@/lib/brain/interviewer";
import { pickLinePairs } from "@/lib/brain/line-pairs";
import { lineSummary } from "@/lib/brain/line-text";
import { structuredCall } from "@/lib/brain/llm";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { describeCityRatings, packCityFacts } from "@/lib/city-ratings";
import { prepareMetrics } from "@/lib/metrics/compute";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import { SWEEP_TOPICS, uncoveredTopics } from "@/components/interview/TopicSweepStep";
import type { CityRating, CityRatingScore } from "@/types/preferences";
import type { LineChoice, PilotModel } from "@/types/pilot-model";
import type { Judgment } from "./judge";
import { pilotAgreement, scorecard } from "./metrics";
import { pilotWordsOf, PERSONAS } from "./personas";

const MAX_TURNS = 22;
const SIM_MODEL = "claude-sonnet-5-5";

const persona = PERSONAS.find((p) => p.id === process.argv[2])!;
const tag = process.argv[3] ?? "run1";
let spend = 0;
const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  console.log(s);
};

const SIM_SYSTEM = `You are role-playing a real FedEx pilot taking an interview about how they bid their lines. Everything you know about yourself is in the TRUTH SHEET: your own words from earlier conversations. Answer every question exactly as this pilot would — consistent with the truth sheet, in their voice (plain, conversational, a few sentences), never more polished than they are. If asked about something the truth sheet doesn't cover, answer the way someone with these priorities plausibly would, or say it doesn't matter much to you. Never mention the truth sheet.`;

async function sim<T>(fresh: string, schema: Record<string, unknown>): Promise<T> {
  const r = await structuredCall<T>({ model: SIM_MODEL, system: SIM_SYSTEM, user: { cached: `TRUTH SHEET:\n${pilotWordsOf(persona)}`, fresh }, schema, effort: "low", maxTokens: 3000 });
  spend += r.usage.costUsd;
  return r.data;
}

(async () => {
  process.loadEnvFile(".env.local");
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
  const pm = prepareMetrics(pack);
  const brief = buildPackBrief(pack, pm);
  const home = persona.commuteFrom;
  const context = `${pack.aircraft} ${pack.seat === "CAP" ? "captain" : "first officer"} based in ${pack.base} (${pack.month} bid pack, ${pack.lines.length} lines). ${persona.isCommuter ? `Commutes to base${home ? ` from ${home}` : ""}.` : "Lives in base."} FedEx lets pilots deviate from a scheduled deadhead and ride a different airline flight on their own to the same city.`;

  // The city step: the pilot rates the pack's cities.
  const cities = packCityFacts(pack);
  const rated = await sim<{ ratings: { city: string; rating: number; reasons: string[] }[] }>(
    `On this screen you rate the layover cities in your bid pack: −2 avoid, −1 dislike, 0 neutral, 1 like, 2 love. Rate the ones you'd have a feeling about; leave the rest at 0 (omit them).\n\n${cities.map((c) => `${c.code}: ${c.trips} trips, usually ${Math.round(c.medianHours)}h, ${c.hotel ?? ""}`).join("\n")}`,
    { type: "object", additionalProperties: false, required: ["ratings"], properties: { ratings: { type: "array", items: { type: "object", additionalProperties: false, required: ["city", "rating", "reasons"], properties: { city: { type: "string" }, rating: { type: "integer" }, reasons: { type: "array", items: { type: "string", enum: ["food", "hotel", "bed", "things-to-do", "friends", "shopping", "hassle", "weather"] } } } } } } }
  );
  const ratings: Record<string, CityRating> = {};
  for (const r of rated.ratings) if (r.rating !== 0 && cities.some((c) => c.code === r.city)) ratings[r.city] = { score: Math.max(-2, Math.min(2, r.rating)) as CityRatingScore, reasons: r.reasons as CityRating["reasons"] };
  say(`CITY RATINGS: ${describeCityRatings(ratings).replace(/\n/g, " | ")}`);

  let exchanges: InterviewExchange[] = [
    { turn: 0, question: "Walk us through your whole bidding process, start to finish, in your own words.", answer: persona.story },
    { turn: 1, question: "Do you commute to base, or live locally?", answer: persona.isCommuter ? `I commute in${home ? ` from ${home}` : ""}.` : "I live locally." },
    { turn: 2, question: "How do you feel about each layover city in your pack?", answer: describeCityRatings(ratings) || "No strong feelings about any city." },
  ];
  const build = async (prior: PilotModel | null) => {
    const r = await buildPilotModel({ packBrief: brief, pilotContext: context, exchanges, prior, model: "claude-sonnet-5-5", effort: "high" });
    spend += r.usage.costUsd;
    say(`  [brain read ${exchanges.length} exchanges: ${r.model.criteria.length} criteria, ${r.model.threads.filter((t) => t.status === "open").length} open threads, ${(r.usage.ms / 1000).toFixed(0)}s, $${r.usage.costUsd.toFixed(3)}]`);
    return applyCityRatings(r.model, ratings);
  };

  let model = await build(null);
  let builtAt = exchanges.length;
  const threads: Record<string, ThreadState> = Object.fromEntries(model.threads.map((t) => [t.id, { status: t.status, timesAsked: 0 }]));
  const choices: LineChoice[] = [];
  const pastTrades: string[] = [];
  let turn = 0;
  let swept = false;
  const qTimes: number[] = [];

  for (;;) {
    const compared = new Set(choices.map((c) => `${c.preferred}|${c.other}`));
    const pairs = pickLinePairs(pack, model, pm, compared, 3, pastTrades);
    const step = await nextInterviewStep({ packBrief: brief, pilotContext: context, exchanges, model, threads, linePairs: pairs, turn, maxTurns: MAX_TURNS });
    spend += step.usage?.costUsd ?? 0;
    qTimes.push(step.usage?.ms ?? 0);
    for (const id of step.settled) threads[id] = { ...(threads[id] ?? { timesAsked: 0 }), status: "settled" };
    if (step.done) {
      say(`\n— interviewer: done (${step.reason})`);
      const topics = uncoveredTopics(model);
      if (swept || topics.length === 0) break;
      swept = true;
      const s = await sim<{ picked: string[]; note: string }>(
        `Near the end, the app shows topics you haven't brought up and asks "Anything else that matters when you bid?" Pick any that genuinely matter to you (often none), and optionally add a short note.\n\nTopics: ${topics.map((t) => t.label).join("; ")}`,
        { type: "object", additionalProperties: false, required: ["picked", "note"], properties: { picked: { type: "array", items: { type: "string", enum: SWEEP_TOPICS.map((t) => t.label) } }, note: { type: "string" } } }
      );
      say(`SWEEP: picked [${s.picked.join(", ")}] ${s.note}`);
      if (!s.picked.length && !s.note.trim()) break;
      exchanges = [...exchanges, { turn: exchanges.length, question: "Anything else that matters when you bid? (Topics you hadn't raised.)", answer: [s.picked.length ? `These matter to me too: ${s.picked.join(", ")}.` : "", s.note].filter(Boolean).join(" ") }];
      turn = Math.max(turn, MAX_TURNS - 3);
      continue;
    }
    if (step.threadId) threads[step.threadId] = { status: threads[step.threadId]?.status ?? "open", timesAsked: (threads[step.threadId]?.timesAsked ?? 0) + 1 };
    say(`\nQ${turn + 1} [${step.kind}${step.threadId ? ` · ${step.threadId}` : ""}] ${step.prompt}${step.options ? `\n   options: ${step.options.join(" / ")}` : ""}`);
    let asked = step.prompt;
    let answerText: string;
    if (step.kind === "line-pair" && step.pair) {
      const p = step.pair;
      pastTrades.push(p.trade);
      say(`   pair: ${p.tension}`);
      const pick = await sim<{ pick: "a" | "b" | "tie"; strength: "slightly" | "strongly"; why: string }>(
        `Question: ${step.prompt}\n\nOption A — Line ${p.a}: ${lineSummary(pack, pack.lines.find((l) => l.lineNumber === p.a)!)}\n\nOption B — Line ${p.b}: ${lineSummary(pack, pack.lines.find((l) => l.lineNumber === p.b)!)}\n\nWhich would you bid higher? Say how strongly, and why in a sentence.`,
        { type: "object", additionalProperties: false, required: ["pick", "strength", "why"], properties: { pick: { type: "string", enum: ["a", "b", "tie"] }, strength: { type: "string", enum: ["slightly", "strongly"] }, why: { type: "string" } } }
      );
      asked = `${step.prompt} [Line ${p.a} vs Line ${p.b}: ${p.tension}]`;
      if (pick.pick === "tie") answerText = `Couldn't choose between line ${p.a} and line ${p.b} — about the same to me. Why: ${pick.why}`;
      else {
        const preferred = pick.pick === "a" ? p.a : p.b;
        const other = pick.pick === "a" ? p.b : p.a;
        choices.push({ preferred, other, strength: pick.strength, why: pick.why });
        answerText = `I'd bid line ${preferred} over line ${other} (${pick.strength === "strongly" ? "easily" : "just"}). Why: ${pick.why}`;
      }
    } else {
      const a = await sim<{ answer: string }>(`Question${step.options ? ` (options: ${step.options.join(" / ")} — pick one, then add a sentence if you like)` : ""}: ${step.prompt}${step.helpText ? `\n(${step.helpText})` : ""}`, { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } });
      answerText = a.answer;
    }
    say(`A: ${answerText}`);
    exchanges = [...exchanges, { turn: exchanges.length, question: asked, answer: answerText }];
    turn++;
    if (exchanges.length - builtAt >= 3) {
      model = await build(model);
      builtAt = exchanges.length;
      for (const t of model.threads) threads[t.id] ??= { status: t.status, timesAsked: t.timesAsked };
    }
  }

  const finalBuilt = await build(model);
  const fit = fitWeightsToChoices(pack, finalBuilt, choices, pm);
  const order = rankPackV2(pack, fit.model, { pack: pm }).map((r) => r.lineNumber);
  const orderNoFit = rankPackV2(pack, finalBuilt, { pack: pm }).map((r) => r.lineNumber);
  const judgeFile = `.cache/eval/judge-${persona.id}.json`;
  say(`\n=== ${persona.id} ${tag}: ${turn} questions, ${choices.length} line choices (fit ${fit.agreedBefore}→${fit.agreedAfter}), spend $${spend.toFixed(2)}, question latency median ${(qTimes.sort((a, b) => a - b)[Math.floor(qTimes.length / 2)] / 1000).toFixed(1)}s`);
  if (existsSync(judgeFile)) {
    const judge: Judgment = JSON.parse(readFileSync(judgeFile, "utf8"));
    say(`judge spearman: ${scorecard("", order, judge).spearman} (before choice fitting ${scorecard("", orderNoFit, judge).spearman})`);
  } else say("(no judge for this persona — see judge-sample.ts)");
  if (persona.lineLabels) say(`agreement with the pilot's own verdicts: ${pilotAgreement(order, persona.lineLabels).share} (before fitting ${pilotAgreement(orderNoFit, persona.lineLabels).share})`);
  say(`top 10: ${order.slice(0, 10).join(" ")}`);
  for (const c of [...fit.model.criteria].sort((a, b) => b.weight - a.weight)) say(`  ${c.weight.toFixed(2)} ${c.label} — ${c.metric}`);
  mkdirSync(".cache/eval/sim", { recursive: true });
  writeFileSync(`.cache/eval/sim/${persona.id}-${tag}.txt`, log.join("\n"));
  writeFileSync(`.cache/eval/sim/${persona.id}-${tag}.json`, JSON.stringify({ exchanges, choices, model: fit.model }, null, 2));
})();
