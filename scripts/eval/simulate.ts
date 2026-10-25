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
import { bidCheckChoice, bidCheckQuestion, checkedKinds, checkedLines, checkedWeakSpots, MAX_BID_CHECKS } from "@/lib/brain/bid-check";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { dealbreakerQuestion } from "@/lib/brain/dealbreakers";
import { nextHubTurnQuestion } from "@/lib/brain/hub-turn-question";
import { fitTripWeights, fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { askedTripScreens, choicesFromGrades, pickTripScreen, shareForeseen, tripGradesAnswer, tripGradesTranscript, tripText, TRIP_GRADES, wantsAnotherScreen, type TripGrade } from "@/lib/brain/trip-sort";
import { rankLinesWithTrips, tripKey } from "@/lib/scoring-v2/trip-score";
import { nextInterviewStep, SWEEP_QUESTION, type ThreadState } from "@/lib/brain/interviewer";
import { pickLinePairs } from "@/lib/brain/line-pairs";
import { pickQuestionExamples } from "@/lib/brain/question-examples";
import { topLines, topShift } from "@/lib/brain/ranking-shift";
import { applyPriorityPick, priorityOrderQuestion, priorityOrderTranscript } from "@/lib/brain/priority-order";
import { lineSummary } from "@/lib/brain/line-text";
import { structuredCall } from "@/lib/brain/llm";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { describeCityRatings, packCityFacts } from "@/lib/city-ratings";
import { prepareMetrics } from "@/lib/metrics/compute";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import { SWEEP_TOPICS, uncoveredTopics } from "@/components/interview/TopicSweepStep";
import type { CityRating, CityRatingScore } from "@/types/preferences";
import type { LineChoice, PilotModel, TripChoice } from "@/types/pilot-model";
import type { Judgment } from "./judge";
import { pilotAgreement, scorecard } from "./metrics";
import { pilotWordsOf, PERSONAS } from "./personas";

const MAX_TURNS = 40;
/** As in the app: after the "anything else?" screen, at most this many follow-ups. */
const AFTER_SWEEP = 5;
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
  // Trips the trip graders graded (scripts/eval/trip-judge.ts): never shown on a trip-grade screen.
  const judgedTrips = new Set<string>(
    [1, 2, 3].map((n) => `.cache/eval/trip-judge-${persona.id}-s${n}.json`).filter(existsSync).flatMap((f) => Object.values(JSON.parse(readFileSync(f, "utf8")).labels as Record<string, string>))
  );
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
  // How much each re-read moved the top 10 — the interviewer's cue that answers have stopped changing anything.
  let top = topLines(pack, model, pm);
  const shifts: number[] = [];
  const threads: Record<string, ThreadState> = Object.fromEntries(model.threads.map((t) => [t.id, { status: t.status, timesAsked: 0 }]));
  const choices: LineChoice[] = [];
  const tripChoices: TripChoice[] = [];
  const pastTrades: string[] = [];
  /** Per question, for the quality report (scripts/eval/interview-quality.ts). */
  const asked: { kind: string; words: number; ack: string; examples?: number; pair?: { a: string; b: string; trade: string; strength?: string; variables?: number } }[] = [];
  let turn = 0;
  let swept = false;
  const qTimes: number[] = [];

  // First, as in the app: which of their top priorities they'd give up last, in words, before any line choice.
  const priority = priorityOrderQuestion(model);
  if (priority) {
    const pick = await sim<{ pick: string; note: string }>(
      `Question: ${priority.prompt}\n(${priority.helpText})\nPick one, and optionally add a short note.`,
      { type: "object", additionalProperties: false, required: ["pick", "note"], properties: { pick: { type: "string", enum: priority.options }, note: { type: "string" } } }
    );
    const i = priority.options.indexOf(pick.pick);
    model = applyPriorityPick(model, priority.criterionIds[i] ?? null);
    const answerText = `${pick.pick}${pick.note.trim() ? `. ${pick.note.trim()}` : ""}`;
    say(`\nQ${turn + 1} [priority order] ${priority.prompt}\n   options: ${priority.options.join(" / ")}\nA: ${answerText}`);
    asked.push({ kind: "choice", words: priority.prompt.split(/\s+/).length, ack: "" });
    exchanges = [...exchanges, { turn: exchanges.length, question: priorityOrderTranscript(priority), answer: answerText }];
    turn++;
  }

  // Then, as in the app: anything that rules a line out.
  {
    const q = dealbreakerQuestion(pack, model, pm);
    const a = await sim<{ answer: string }>(`Question: ${q.prompt}\n(${q.helpText})`, { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } });
    say(`\nQ${turn + 1} [dealbreakers] ${q.prompt}\n   (${q.helpText})\nA: ${a.answer}`);
    asked.push({ kind: "dealbreaker", words: q.prompt.split(/\s+/).length, ack: "" });
    exchanges = [...exchanges, { turn: exchanges.length, question: q.transcript, answer: a.answer }];
    turn++;
  }

  // Then, as in the app: hub turning by name with a real trip from the pack, and the crew-rest hotel when there are some.
  for (let hub = nextHubTurnQuestion(pack, model, pm, exchanges); hub; hub = nextHubTurnQuestion(pack, model, pm, exchanges)) {
    const pick = await sim<{ pick: string; note: string }>(
      `Question: ${hub.prompt}\n(${hub.helpText})\nPick one, and optionally add a short note.`,
      { type: "object", additionalProperties: false, required: ["pick", "note"], properties: { pick: { type: "string", enum: hub.options }, note: { type: "string" } } }
    );
    const answerText = `${pick.pick}${pick.note.trim() ? `. ${pick.note.trim()}` : ""}`;
    say(`\nQ${turn + 1} [hub turns] ${hub.prompt}\n   (${hub.helpText})\nA: ${answerText}`);
    asked.push({ kind: "choice", words: hub.prompt.split(/\s+/).length, ack: "" });
    exchanges = [...exchanges, { turn: exchanges.length, question: hub.transcript, answer: answerText }];
    turn++;
  }

  let limit = MAX_TURNS;
  const packNumbers = { lines: pack.lines.map((l) => l.lineNumber), trips: [...new Set(pack.lines.flatMap((l) => l.trips.map((t) => t.pairingNumber ?? t.id)))] };
  for (;;) {
    const compared = new Set(choices.map((c) => `${c.preferred}|${c.other}`));
    const pairs = pickLinePairs(pack, model, pm, compared, 3, pastTrades);
    // As in the app: real lines and trips at both ends of their main priorities, for the question to show.
    const examples = pickQuestionExamples(pack, model, pm);
    const step = await nextInterviewStep({ packBrief: brief, pilotContext: context, exchanges, model, threads, linePairs: pairs, examples, packNumbers, turn, maxTurns: limit, rankingShifts: shifts });
    spend += step.usage?.costUsd ?? 0;
    qTimes.push(step.usage?.ms ?? 0);
    for (const id of step.settled) threads[id] = { ...(threads[id] ?? { timesAsked: 0 }), status: "settled" };
    if (step.done) {
      say(`\n— interviewer: done (${step.reason})`);
      // As in the app: before wrapping up, how would they feel about flying a screen of real trips? Two screens, a third
      // only if the second surprised the model. The trip graders' own trips are never shown, so a fit can't learn their
      // answers by heart.
      const shownScreens = askedTripScreens(exchanges);
      const withGrades = (cs: TripChoice[]): PilotModel => ({ ...model, tripWeights: fitTripWeights(pack, model, cs, pm).tripWeights });
      const lastScreen = shownScreens.at(-1);
      const onLast = new Set(lastScreen ?? []);
      const lastGraded = tripChoices.filter((c) => onLast.has(c.preferred) && onLast.has(c.other));
      const foreseen = lastScreen ? shareForeseen(pack, withGrades(tripChoices.filter((c) => !lastGraded.includes(c))), pm, lastGraded) : null;
      const screen = wantsAnotherScreen(shownScreens.length, foreseen) ? pickTripScreen(pack, withGrades(tripChoices), pm, shownScreens, { exclude: judgedTrips }) : null;
      if (screen) {
        const byKey = new Map(pack.lines.flatMap((l) => l.trips).map((t) => [tripKey(t), t]));
        const letters = screen.keys.map((_, i) => String.fromCharCode(65 + i));
        const g = await sim<{ grades: { trip: string; grade: TripGrade }[]; why: string }>(
          `Question: here are ${screen.keys.length} real trips from your pack. Grade each one the way you'd feel about flying it in your month — the way you'd size them up on a trade board: love, good, fine, poor, or trade away. Just these trips, not the lines they're on.\n\n${screen.keys.map((k, i) => `Trip ${letters[i]} — ${screen.labels[k]}:\n${tripText(pack, byKey.get(k)!)}`).join("\n\n")}\n\nGrade every trip (by its letter), and say in a sentence or two what decided it.`,
          {
            type: "object",
            additionalProperties: false,
            required: ["grades", "why"],
            properties: {
              grades: { type: "array", items: { type: "object", additionalProperties: false, required: ["trip", "grade"], properties: { trip: { type: "string", enum: letters }, grade: { type: "string", enum: [...TRIP_GRADES] } } } },
              why: { type: "string" },
            },
          }
        );
        const grades: Record<string, TripGrade> = {};
        for (const x of g.grades) if (letters.includes(x.trip)) grades[screen.keys[letters.indexOf(x.trip)]] = x.grade;
        tripChoices.push(...choicesFromGrades(grades, g.why));
        const answerText = tripGradesAnswer(screen, grades, g.why);
        say(`\nQ${turn + 1} [trip grades, screen ${shownScreens.length + 1}${foreseen !== null ? `, last screen foreseen ${Math.round(foreseen * 100)}%` : ""}]\nA: ${answerText}`);
        asked.push({ kind: "trip-grades", words: 12, ack: "" });
        exchanges = [...exchanges, { turn: exchanges.length, question: tripGradesTranscript(screen), answer: answerText }];
        turn++;
        continue;
      }
      // As in the app: before wrapping up, is a line near the top one they'd really bid there?
      const checked = checkedLines(exchanges);
      const check = checked.length < MAX_BID_CHECKS ? bidCheckQuestion(pack, model, choices, pm, checked, checkedKinds(exchanges), checkedWeakSpots(exchanges)) : null;
      if (check) {
        const lineText = (n: string) => lineSummary(pack, pack.lines.find((l) => l.lineNumber === n)!);
        const pick = await sim<{ pick: string; note: string }>(
          `Question: ${check.prompt}\n(${check.helpText})\n\nLine ${check.line}: ${lineText(check.line)}\n\nPick one, and optionally add a short note on why.`,
          { type: "object", additionalProperties: false, required: ["pick", "note"], properties: { pick: { type: "string", enum: check.options }, note: { type: "string" } } }
        );
        const i = check.options.indexOf(pick.pick);
        const verdict = bidCheckChoice(check, i, pick.note);
        if (verdict) choices.push(verdict);
        const answerText = `${pick.pick}${pick.note.trim() ? `. ${pick.note.trim()}` : ""}`;
        say(`\nQ${turn + 1} [${check.kind} check · #${check.rank} ${check.line} vs ${check.alt}] ${check.prompt}\nA: ${answerText}`);
        asked.push({ kind: "bid-check", words: check.prompt.split(/\s+/).length, ack: "" });
        exchanges = [...exchanges, { turn: exchanges.length, question: check.transcript, answer: answerText }];
        turn++;
        continue;
      }
      const topics = uncoveredTopics(model);
      if (swept || topics.length === 0) break;
      swept = true;
      const s = await sim<{ picked: string[]; note: string }>(
        `Near the end, the app shows topics you haven't brought up and asks "Anything else that matters when you bid?" Pick any that genuinely matter to you (often none), and optionally add a short note.\n\nTopics: ${topics.map((t) => t.label).join("; ")}`,
        { type: "object", additionalProperties: false, required: ["picked", "note"], properties: { picked: { type: "array", items: { type: "string", enum: SWEEP_TOPICS.map((t) => t.label) } }, note: { type: "string" } } }
      );
      say(`SWEEP: picked [${s.picked.join(", ")}] ${s.note}`);
      if (!s.picked.length && !s.note.trim()) break;
      exchanges = [...exchanges, { turn: exchanges.length, question: SWEEP_QUESTION, answer: [s.picked.length ? `These matter to me too: ${s.picked.join(", ")}.` : "", s.note].filter(Boolean).join(" ") }];
      limit = Math.min(MAX_TURNS, turn + AFTER_SWEEP);
      continue;
    }
    if (step.threadId) threads[step.threadId] = { status: threads[step.threadId]?.status ?? "open", timesAsked: (threads[step.threadId]?.timesAsked ?? 0) + 1 };
    say(`\nQ${turn + 1} [${step.kind}${step.threadId ? ` · ${step.threadId}` : ""}] ${step.prompt}${step.options ? `\n   options: ${step.options.join(" / ")}` : ""}${step.examples?.length ? `\n   shown: ${step.examples.map((e) => `${e.title} — ${e.fact}`).join("; ")}` : ""}`);
    const entry: (typeof asked)[number] = { kind: step.kind, words: step.prompt.split(/\s+/).filter(Boolean).length, ack: (step as { ack?: string }).ack ?? "", examples: step.examples?.length ?? 0 };
    if (entry.ack) say(`   (ack) ${entry.ack}`);
    asked.push(entry);
    // As the app records it: the question, and the examples it showed.
    let askedText = step.transcript ?? step.prompt;
    let answerText: string;
    if (step.kind === "line-pair" && step.pair) {
      const p = step.pair;
      pastTrades.push(p.trade);
      say(`   pair: ${p.tension}`);
      // What the app shows above the two lines: where they differ on what this pilot has said matters.
      const table = p.differences?.length ? `\n\nWhere they differ:\n${p.differences.map((d) => `- ${d.label}: Line ${p.a} ${d.a}, Line ${p.b} ${d.b}`).join("\n")}` : "";
      const pick = await sim<{ pick: "a" | "b" | "tie"; strength: "slightly" | "strongly"; why: string }>(
        `Question: ${step.prompt}${table}\n\nOption A — Line ${p.a}: ${lineSummary(pack, pack.lines.find((l) => l.lineNumber === p.a)!)}\n\nOption B — Line ${p.b}: ${lineSummary(pack, pack.lines.find((l) => l.lineNumber === p.b)!)}\n\nWhich would you bid higher? Say how strongly, and why in a sentence.`,
        { type: "object", additionalProperties: false, required: ["pick", "strength", "why"], properties: { pick: { type: "string", enum: ["a", "b", "tie"] }, strength: { type: "string", enum: ["slightly", "strongly"] }, why: { type: "string" } } }
      );
      askedText = `${step.prompt} [Line ${p.a} vs Line ${p.b}: ${p.tension}]`;
      entry.pair = { a: p.a, b: p.b, trade: p.trade, strength: pick.pick === "tie" ? "tie" : pick.strength, variables: p.differences?.length ?? 2 };
      if (pick.pick === "tie") answerText = `Couldn't choose between line ${p.a} and line ${p.b} — about the same to me. Why: ${pick.why}`;
      else {
        const preferred = pick.pick === "a" ? p.a : p.b;
        const other = pick.pick === "a" ? p.b : p.a;
        choices.push({ preferred, other, strength: pick.strength, why: pick.why });
        answerText = `I'd bid line ${preferred} over line ${other} (${pick.strength === "strongly" ? "easily" : "just"}). Why: ${pick.why}`;
      }
    } else {
      // What the app shows under the question: each example line in full, or the trip with its duties.
      const shown = (step.examples ?? [])
        .map((e) => {
          if (e.kind === "line") {
            const line = pack.lines.find((l) => l.lineNumber === e.ref);
            return line ? `${e.title}${e.rank ? ` (#${e.rank} on your list)` : ""} — ${e.fact}\n${lineSummary(pack, line)}` : "";
          }
          const trip = pack.lines.flatMap((l) => l.trips).find((t) => tripKey(t) === e.ref);
          return trip ? `${e.title} — ${e.fact}\n${tripText(pack, trip)}` : "";
        })
        .filter(Boolean);
      const a = await sim<{ answer: string }>(
        `Question${step.options ? ` (options: ${step.options.join(" / ")} — pick one, then add a sentence if you like)` : ""}: ${step.prompt}${step.helpText ? `\n(${step.helpText})` : ""}${shown.length ? `\n\nShown on screen with the question:\n\n${shown.join("\n\n")}` : ""}`,
        { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } }
      );
      answerText = a.answer;
    }
    say(`A: ${answerText}`);
    exchanges = [...exchanges, { turn: exchanges.length, question: askedText, answer: answerText }];
    turn++;
    if (exchanges.length - builtAt >= 3) {
      model = await build(model);
      builtAt = exchanges.length;
      const nextTop = topLines(pack, model, pm);
      shifts.push(topShift(top, nextTop));
      top = nextTop;
      say(`  [top-10 change: ${shifts.at(-1)}]`);
      for (const t of model.threads) threads[t.id] ??= { status: t.status, timesAsked: t.timesAsked };
    }
  }

  const finalBuilt = await build(model);
  const lineFit = fitWeightsToChoices(pack, finalBuilt, choices, pm);
  const tripFit = fitTripWeights(pack, lineFit.model, tripChoices, pm);
  const fit = { ...lineFit, model: { ...lineFit.model, tripWeights: tripFit.tripWeights } };
  say(`trip grades: ${tripChoices.length} comparisons (trip fit ${tripFit.agreedBefore}→${tripFit.agreedAfter})`);
  // As the results rank them: once trips are graded, each line leans on its own trips' scores.
  const order = rankLinesWithTrips(pack, fit.model, { pack: pm }).map((r) => r.lineNumber);
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
  const result: Record<string, unknown> = { exchanges, choices, tripChoices, model: fit.model, preFit: finalBuilt, asked, spend, order, shifts };
  if (existsSync(judgeFile)) result.judgeSpearman = scorecard("", order, JSON.parse(readFileSync(judgeFile, "utf8"))).spearman;
  if (persona.lineLabels) result.pilotAgreement = pilotAgreement(order, persona.lineLabels).share;
  writeFileSync(`.cache/eval/sim/${persona.id}-${tag}.json`, JSON.stringify(result, null, 2));
})();
