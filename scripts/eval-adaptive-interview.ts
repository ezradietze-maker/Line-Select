/**
 * End-to-end evaluation of the adaptive interview against simulated pilots
 * whose real preferences are known in advance — the question this answers
 * is not "does the interview run" but "how close does the profile it builds
 * land to what this pilot actually wants, and how good was it to talk to."
 *
 * Each persona carries a hidden ground-truth sheet (a lean on every
 * explicit-weight id, real targets, cities, dealbreakers, personal-life
 * facts) and a distinct way of talking. A separate model plays the pilot:
 * it writes the bidding story in that voice, then answers every question the
 * interview asks, in character, from the truth sheet — so the interview is
 * exercised against varied, realistic language instead of canned keyword
 * matches (`run-adaptive-interview-transcript.ts`, which also never ran the
 * bidding story). The flow mirrors `AdaptiveInterview.tsx` exactly: story
 * extraction, then city picks, then the turn loop, through the same
 * `runBiddingStoryExtraction`/`runInterviewTurn`/`finalizeAdaptiveProfile`
 * code the app runs.
 *
 * Scoring is half mechanical (direction/magnitude per explicit id, targets,
 * cities, turns, tokens) and half judged by a third call that sees the truth
 * sheet, the whole conversation and the final profile.
 *
 * Usage: ANTHROPIC_API_KEY=... npx tsx scripts/eval-adaptive-interview.ts <pack.json> <outDir> [persona...] [--no-story]
 * where <pack.json> is one seat's parsed BidPack. Costs real API money
 * (roughly $1-3 per persona); never run in CI.
 */

import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeBidPackGroundingStats } from "../src/lib/interview-grounding";
import {
  applicableExplicitWeightIds,
  applyProfileUpdates,
  buildTurnRequest,
  finalizeAdaptiveProfile,
  HARD_CEILING_TURNS,
  packHasHotelStandby,
} from "../src/lib/interview-engine";
import { runBiddingStoryExtraction, runInterviewTurn } from "../src/lib/interview-turn-service";
import { mergeStoryAndCityFacts, storyCitySentiments } from "../src/lib/interview-story";
import { getBidPackRanges, rankLayoverCitiesByFrequency } from "../src/lib/scoring";
import type { BidPack } from "../src/types/bidpack";
import type { InterviewAnswer, InterviewQuestion, InterviewTurnRecord, PreferenceFact } from "../src/types/interview-session";
import type { CitySentiment, PreferenceProfile, RangeTarget } from "../src/types/preferences";

const SIM_MODEL = process.env.SIM_MODEL || "claude-sonnet-5";
const JUDGE_MODEL = process.env.JUDGE_MODEL || "claude-opus-5-5";
const INTERVIEW_MODEL = process.env.INTERVIEW_MODEL || "claude-sonnet-5";

// ---------------------------------------------------------------------------
// Spend tracking — every call is metered, and the run stops before it can
// pass BUDGET_USD. Prices are per million tokens and are an estimate (list
// prices for the model family); cache writes bill at 1.25x input, reads 0.1x.
// ---------------------------------------------------------------------------

const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-5-5": { input: 3, output: 15 },
  "claude-opus-5-5": { input: 5, output: 25 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};
const BUDGET_USD = Number(process.env.BUDGET_USD || "3");
const spend = { usd: 0, byModel: {} as Record<string, { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; usd: number }> };

function meter(model: string, u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) {
  const price = PRICES[model] ?? { input: 5, output: 25 };
  const usd =
    (u.inputTokens * price.input + u.cacheWriteTokens * price.input * 1.25 + u.cacheReadTokens * price.input * 0.1 + u.outputTokens * price.output) / 1e6;
  const m = (spend.byModel[model] ??= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 });
  m.calls++;
  m.input += u.inputTokens;
  m.output += u.outputTokens;
  m.cacheRead += u.cacheReadTokens;
  m.cacheWrite += u.cacheWriteTokens;
  m.usd += usd;
  spend.usd += usd;
}

function checkBudget() {
  if (spend.usd > BUDGET_USD) throw new Error(`budget reached: $${spend.usd.toFixed(2)} of $${BUDGET_USD}`);
}

function meterResponse(model: string, res: Anthropic.Message) {
  meter(model, {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
  });
}

interface Truth {
  /** -100..100 for bipolar ids, 0..100 for magnitude-only ones; 0 = genuinely indifferent. */
  weights: Record<string, number>;
  targets: Partial<Record<"daysOff" | "dutyPeriods", RangeTarget>> & { creditHours?: number; circadianTolerance?: number };
  cities: Record<string, CitySentiment>;
  dealbreakers: string[];
  personal: string[];
  /** Calendar-shaped truths the profile can now hold in checkable form. */
  implicit?: Record<string, 1 | -1>;
  weekly?: string;
  dates?: string[];
}

interface Persona {
  name: string;
  isCommuter: boolean;
  hasCrashPad: boolean | null;
  voice: string;
  background: string;
  /** What this pilot would naturally bring up unprompted when asked to walk through their bidding — deliberately not everything. */
  storyCovers: string;
  /** Which of `truth.cities` they'd actually tap on the city picker (people don't always mark everything they feel). */
  pickerCities: Record<string, CitySentiment>;
  /** "long" makes the simulated pilot write a several-paragraph story, covering most of what they care about. */
  storyLength?: "long";
  truth: Truth;
}

const PERSONAS: Persona[] = [
  {
    name: "terse-local",
    isCommuter: false,
    hasCrashPad: null,
    voice:
      "Clipped and terse. Heavy jargon and shorthand (DH, TAFB, PM shows, the sort, DPs), drops subjects, no pleasantries, mildly impatient with long or vague questions. One sentence is typical; two is a lot. Never explains himself unless asked directly.",
    background: "Senior-ish FO on the 767 in Memphis, lives 20 minutes from the airport, 14 years at the company, married, one teenage daughter.",
    storyCovers:
      "Bids for max days off and short trips, hates deadheads, will not take a line with hotel standby on it, daughter's travel softball on Saturdays.",
    pickerCities: { BOG: "avoid" },
    truth: {
      weights: {
        daysOff: 80, tripLength: -55, international: -20, reportTime: 55, creditHours: -40, deadheadTolerance: -70,
        hotelFood: 0, hotelGym: 0, hotelGrocery: 0, hotelQuiet: 70, hotelQuality: 30, circadianHealth: 20,
        landings: 0, hotelStandby: -80, riskTolerance: -30, adminEffortAppetite: 50,
      },
      targets: { daysOff: { min: 15, ideal: 16 }, dutyPeriods: { max: 14 } },
      cities: { BOG: "avoid", OAK: "love" },
      weekly: "Sat",
      dealbreakers: ["Will not bid a line that has any hotel standby on it."],
      personal: [
        "Coaches/attends his daughter's travel softball every Saturday during the season.",
        "Wife works days, so being home in the evenings matters.",
        "Prefers afternoon/evening shows because he's a night person and slept through the sort for years.",
      ],
    },
  },
  {
    name: "chatty-commuter",
    isCommuter: true,
    hasCrashPad: false,
    voice:
      "Friendly and rambling. Long run-on sentences, plain everyday language with little jargon, says 'honestly' and 'like' a lot, the odd exclamation point, explains her reasoning at length even when not asked.",
    background: "Junior FO, 2 years at the company, commutes from Denver to Memphis, no crash pad (uses hotels), partner is an ER nurse with rotating shifts, has big student loans.",
    storyCovers:
      "Commutes from Denver so wants long trips and fewer commutes, needs max credit for the loans, loves when a trip deadheads her home or lays over in Denver, gym at the hotel matters, late shows so she can commute in the same day.",
    pickerCities: { DEN: "love", SJU: "love" },
    truth: {
      weights: {
        daysOff: -30, tripLength: 70, international: 40, reportTime: 50, creditHours: 70, deadheadTolerance: 65,
        hotelFood: 60, hotelGym: 75, hotelGrocery: 0, hotelQuiet: 30, hotelQuality: 40, circadianHealth: 0,
        landings: 40, hotelStandby: 35, riskTolerance: 60, adminEffortAppetite: 70,
      },
      targets: { creditHours: 84, dutyPeriods: { ideal: 10 } },
      cities: { DEN: "love", SJU: "love" },
      dealbreakers: [],
      personal: [
        "Paying down large student loans — needs maximum credit for the next couple of years.",
        "Partner is an ER nurse on rotating shifts.",
        "Has no crash pad; pays for a hotel when the commute doesn't line up.",
      ],
    },
  },
  {
    name: "dry-veteran",
    isCommuter: false,
    hasCrashPad: null,
    voice:
      "Dry, sardonic, understated humor. Uses aviation slang naturally but not showily. Medium-length answers, occasionally self-deprecating, never gushes. Will answer the question but often with a wry aside.",
    background: "Mid-seniority FO, 20 years flying, 9 at the company, lives in Germantown outside Memphis, divorced, kids grown. A foodie who loves good layover restaurants and international flying.",
    storyCovers:
      "Bids international and long layovers in good food cities, morning person who prefers early shows, will not do back-to-back red-eyes, doesn't care about landings, doesn't bother with trades or grievances, and needs his daughter's wedding weekend (October 16-18) off.",
    pickerCities: { GDL: "love", PTY: "love", LRD: "avoid" },
    truth: {
      weights: {
        daysOff: 40, tripLength: 20, international: 75, reportTime: -45, creditHours: 20, deadheadTolerance: -10,
        hotelFood: 75, hotelGym: 0, hotelGrocery: 30, hotelQuiet: 50, hotelQuality: 60, circadianHealth: 60,
        landings: -40, hotelStandby: 0, riskTolerance: -60, adminEffortAppetite: -65,
      },
      targets: { circadianTolerance: 2, daysOff: { ideal: 15 } },
      cities: { GDL: "love", PTY: "love", LRD: "avoid", TLC: "avoid" },
      dealbreakers: ["Will not bid a line with back-to-back red-eye duties."],
      personal: [
        "Takes a Spanish class every Thursday evening.",
        "Kids are grown; schedule is his own.",
        "His daughter's wedding is Saturday October 17, 2026 — he needs October 16-18 off.",
      ],
      weekly: "Thu",
      dates: ["2026-10-16", "2026-10-17", "2026-10-18"],
    },
  },
  {
    name: "plain-esl",
    isCommuter: true,
    hasCrashPad: true,
    voice:
      "English is his second language (Brazilian Portuguese native). Short simple sentences, occasional grammar mistakes (drops articles, odd tense), literal, no slang or idioms, polite. Sometimes answers a slightly different question than the one asked if it was phrased with idioms.",
    background: "FO, 5 years at the company, preparing for a captain upgrade in a year, commutes from Miami, shares a crash pad in Memphis. Family in Brazil.",
    storyCovers:
      "Commutes from Miami, wants many landings to be ready for upgrade, wants days off together in one block so he can fly to Brazil, cooks his own food on layovers so a grocery store near the hotel matters.",
    pickerCities: { MIA: "love" },
    truth: {
      weights: {
        daysOff: 60, tripLength: 40, international: 50, reportTime: 0, creditHours: 0, deadheadTolerance: 40,
        hotelFood: 0, hotelGym: 50, hotelGrocery: 65, hotelQuiet: 40, hotelQuality: 0, circadianHealth: 40,
        landings: 65, hotelStandby: -20, riskTolerance: 0, adminEffortAppetite: -20,
      },
      targets: { daysOff: { ideal: 15 } },
      cities: { MIA: "love", SJU: "love" },
      dealbreakers: [],
      implicit: { longestDaysOffBlockPerLine: 1 },
      personal: [
        "Wants days off grouped together in one long block to fly home to family in Brazil.",
        "Preparing for a captain upgrade within a year.",
        "Cooks his own food on layovers.",
      ],
    },
  },
  {
    name: "thorough-planner",
    isCommuter: true,
    hasCrashPad: true,
    storyLength: "long",
    voice:
      "Organized and articulate — writes in full paragraphs, explains the reasoning behind each preference, moderate jargon used naturally (DH, show time, backside, PBS), measured and pragmatic, occasionally wry about commuting. Answers questions directly, then adds a sentence of why.",
    background:
      "FO on the 767 in Memphis, 7 years at the company, commutes from Charlotte and keeps a crash pad in Memphis. Married; his wife teaches elementary school. Two kids, 6 and 9. His son swims and has meets on Wednesday evenings.",
    storyCovers:
      "His bidding order: days off first (aims for 15, will take 14, will not bid a 13-day-off line), then whether a trip lets him commute in the same day (late first-day shows) and get home the last day (early finish, likes a deadhead home at the end), then trip length (3-4 day trips mean fewer commutes), then layovers. Quiet hotel matters a lot (light sleeper, a hotel bar under the room ruins his rest), walkable food matters some, a gym is nice not essential. A trip or two of international is fine but not a month of Latin America backsides. He can do one early (0200-0500) show but two in a row wrecks him. Pay matters but he won't trade a day off for a few more hours. Hotel standby doesn't bother him, easy pay, as long as the hotel is decent. He'd work the trade board after awards to get a weekend back. Keeps duty periods at 14 or fewer — 16 is too many for a commuter. Wants days off in a couple of big blocks rather than scattered single days he can't get home on, and weekends with the kids count for more than weekdays. Tries to be home Wednesday evenings for his son's swim meets but it isn't a dealbreaker. Really wants Saturday October 10 off for his daughter's birthday party. Loves San Diego layovers; avoids Newark (the hotel is a dump) and Toluca.",
    pickerCities: { SAN: "love", EWR: "avoid" },
    truth: {
      weights: {
        daysOff: 70, tripLength: 40, international: -20, reportTime: 60, creditHours: -20, deadheadTolerance: 50,
        hotelFood: 50, hotelGym: 30, hotelGrocery: 0, hotelQuiet: 80, hotelQuality: 50, circadianHealth: 60,
        landings: 0, hotelStandby: 30, riskTolerance: 30, adminEffortAppetite: 40,
      },
      targets: { daysOff: { min: 14, ideal: 15 }, dutyPeriods: { max: 14 }, circadianTolerance: 1 },
      cities: { SAN: "love", EWR: "avoid", TLC: "avoid" },
      dealbreakers: ["Will not bid a line with fewer than 14 days off."],
      implicit: { longestDaysOffBlockPerLine: 1, weekendDaysOffPerLine: 1 },
      weekly: "Wed",
      dates: ["2026-10-10"],
      personal: [
        "Commutes from Charlotte and keeps a crash pad in Memphis.",
        "Wife is an elementary school teacher; two kids, 6 and 9.",
        "Son's swim meets are Wednesday evenings — tries to be home, not a dealbreaker.",
        "Daughter's birthday party is Saturday October 10 — really wants it off.",
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// The simulated pilot
// ---------------------------------------------------------------------------

function personaSheet(p: Persona): string {
  return `You are role-playing a real FedEx pilot being interviewed by a bid-line ranking tool. Stay fully in character.

WHO YOU ARE: ${p.background}
Commuter: ${p.isCommuter ? "yes" : "no"}${p.hasCrashPad === null ? "" : `, crash pad: ${p.hasCrashPad ? "yes" : "no"}`}.

HOW YOU TALK (this matters as much as what you say): ${p.voice}

WHAT YOU ACTUALLY WANT (your private truth — answer consistently with it, but only reveal what a question actually asks about; never recite this list):
Leanings on a -100..100 scale (0 = genuinely don't care; for food/gym/grocery/quiet/hotel quality/circadian health, 0..100 is how much it matters):
${Object.entries(p.truth.weights).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
(daysOff +: more days off; tripLength +: longer trips; international +: more international; reportTime +: later/evening shows, -: early shows; creditHours +: maximize pay, -: lighter lifestyle schedule; deadheadTolerance +: fine with/likes deadheads; landings +: wants more landings; hotelStandby +: likes hotel standby, -: avoids it; riskTolerance +: would rank a long-shot line high; adminEffortAppetite +: would do trades/grievances/re-bids for a better outcome.)
Targets: ${JSON.stringify(p.truth.targets)}
Cities: ${JSON.stringify(p.truth.cities)}
Hard lines (only these are real refusals; everything else is a preference): ${p.truth.dealbreakers.length ? p.truth.dealbreakers.join(" ") : "none"}
Personal life: ${p.truth.personal.join(" ")}

Answer like a real person: honest, sometimes brief, never padded. If a question is vague or uses an idiom you'd plausibly misread, answer what you think it means.`;
}

const SIM_ANSWER_TOOL: Anthropic.Tool = {
  name: "answer",
  description: "Your answer to the interview question.",
  input_schema: {
    type: "object",
    properties: {
      sliderValue: { type: "integer", description: "For a slider: -100 (fully toward the low label) .. 100 (fully toward the high label), 0 = center." },
      targetValue: { type: "number", description: "For a target slider: a number inside the given range, or omit to leave it unset." },
      choiceIndex: { type: "integer", description: "For a choice: the 0-based index of the one option you pick." },
      text: { type: "string", description: "For a free-text question: your answer, in your own voice." },
      elaboration: {
        type: "string",
        description: "Optional, for slider/target/choice only: a short 'here's why' note in your voice. Add one only when the bare answer would genuinely mislead or you'd naturally want to qualify it — most answers don't need one.",
      },
    },
  },
};


/** The 5.5 models only accept tool_choice "auto", so the tool is requested in words and the call retried once if it comes back as plain text. */
async function callTool(
  client: Anthropic,
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, "tool_choice">,
  toolName: string
): Promise<Record<string, unknown> | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    checkBudget();
    const res = await client.messages.create({
      ...params,
      system: `${params.system ?? ""}\n\nAlways respond by calling the "${toolName}" tool — never with plain text.`,
      tool_choice: { type: "auto" },
    });
    meterResponse(params.model, res);
    const use = res.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === toolName);
    if (use) return use.input as Record<string, unknown>;
  }
  return undefined;
}

function describeQuestion(q: InterviewQuestion, ranges: Record<string, [number, number]>): string {
  const head = `QUESTION (${q.kind}): ${q.prompt}${q.helpText ? `\n(${q.helpText})` : ""}`;
  if (q.kind === "slider") return `${head}\nSlider from "${q.lowLabel}" (-100) through "${q.centerLabel}" (0) to "${q.highLabel}" (100). Answer with sliderValue.`;
  if (q.kind === "target-slider") {
    const [min, max] = q.boundTo === "circadianTolerance" ? [0, 4] : ranges[q.boundTo] ?? [0, 30];
    return `${head}\nPick a number of ${q.unitPlural} between ${min} and ${max}${q.rangeRole ? ` (this is your ${q.rangeRole === "min" ? "floor — the fewest you'd accept" : q.rangeRole === "max" ? "ceiling — the most you'd accept" : "ideal"})` : ""}. Answer with targetValue.`;
  }
  if (q.kind === "choice") return `${head}\nOptions (pick exactly one):\n${q.options.map((o, i) => `${i}: ${o.label}${o.description ? ` — ${o.description}` : ""}`).join("\n")}\nAnswer with choiceIndex.`;
  return `${head}\nAnswer with text.`;
}

async function simAnswer(
  client: Anthropic,
  persona: Persona,
  history: string[],
  q: InterviewQuestion,
  ranges: Record<string, [number, number]>
): Promise<InterviewAnswer> {
  const input = await callTool(client, {
    model: SIM_MODEL,
    max_tokens: 2000,
    system: personaSheet(persona),
    messages: [
      {
        role: "user",
        content: `${history.length ? `The interview so far:\n${history.join("\n")}\n\n` : ""}${describeQuestion(q, ranges)}`,
      },
    ],
    tools: [SIM_ANSWER_TOOL],
  }, "answer");
  const elaboration = typeof input?.elaboration === "string" && input.elaboration.trim() ? input.elaboration.trim() : undefined;
  if (q.kind === "slider") return { kind: "slider", value: Math.max(-100, Math.min(100, Number(input?.sliderValue ?? 0))), elaboration };
  if (q.kind === "target-slider") {
    return { kind: "target-slider", value: typeof input?.targetValue === "number" ? input.targetValue : undefined, elaboration };
  }
  if (q.kind === "choice") {
    const idx = Number(input?.choiceIndex ?? 0);
    return { kind: "choice", selectedIndex: Number.isInteger(idx) && idx >= 0 && idx < q.options.length ? idx : 0, elaboration };
  }
  return { kind: "free-text", text: typeof input?.text === "string" && input.text.trim() ? input.text : "No real preference there." };
}

async function simStory(client: Anthropic, persona: Persona): Promise<string> {
  checkBudget();
  const res = await client.messages.create({
    model: SIM_MODEL,
    max_tokens: 3000,
    system: personaSheet(persona),
    messages: [
      {
        role: "user",
        content: `The tool's first screen says: "Walk us through your whole bidding process, start to finish — every detail. The more you tell us, the better the rest of this goes." Write what you'd actually type into that box, in your own voice. Naturally you'd bring up: ${persona.storyCovers} ${persona.storyLength === "long" ? "You're the type who takes this seriously: write a long, thorough answer — several paragraphs, roughly 500-700 words, walking through your process in the order you actually think about it, with your reasons." : "Don't cover everything you care about — real people don't."} Reply with only the text you'd type.`,
      },
    ],
  });
  meterResponse(SIM_MODEL, res);
  return res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
}

function formatAnswer(q: InterviewQuestion, a: InterviewAnswer): string {
  const base =
    a.kind === "choice" && q.kind === "choice"
      ? q.options[a.selectedIndex]?.label ?? "?"
      : a.kind === "slider" || a.kind === "target-slider"
        ? String(a.value)
        : a.kind === "free-text"
          ? a.text
          : "(skipped)";
  const elab = "elaboration" in a && a.elaboration ? ` — "${a.elaboration}"` : "";
  return base + elab;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function explicitWeightAccuracy(truth: Truth, profile: PreferenceProfile, ids: readonly string[]) {
  const rows = ids.map((id) => {
    const t = truth.weights[id] ?? 0;
    const g = (profile.weights as unknown as Record<string, number>)[id] ?? 0;
    let correct: boolean;
    if (Math.abs(t) >= 30) correct = Math.sign(g) === Math.sign(t) && Math.abs(g) >= 15;
    else if (Math.abs(t) < 15) correct = Math.abs(g) <= 35;
    else correct = Math.sign(g) === Math.sign(t) || Math.abs(g) <= 35;
    return { id, truth: t, got: g, correct, absError: Math.abs(g - t) };
  });
  return {
    rows,
    correct: rows.filter((r) => r.correct).length,
    total: rows.length,
    meanAbsError: Math.round(rows.reduce((s, r) => s + r.absError, 0) / rows.length),
  };
}

function idealOf(v: number | RangeTarget | undefined): RangeTarget {
  return v === undefined ? {} : typeof v === "number" ? { ideal: v } : v;
}

function targetAccuracy(truth: Truth, profile: PreferenceProfile) {
  const out: { key: string; role: string; truth: number; got: number | null; ok: boolean }[] = [];
  const tol: Record<string, number> = { daysOff: 1, dutyPeriods: 2, creditHours: 3, circadianTolerance: 0 };
  for (const key of ["daysOff", "dutyPeriods"] as const) {
    const t = truth.targets[key];
    if (!t) continue;
    const g = idealOf(profile.explicitTargets?.[key]);
    for (const role of ["min", "ideal", "max"] as const) {
      if (t[role] === undefined) continue;
      // A pilot's floor/ceiling captured as their only number still counts as the right number.
      const got = g[role] ?? (Object.keys(g).length === 1 ? Object.values(g)[0]! : null);
      out.push({ key, role, truth: t[role]!, got, ok: got !== null && Math.abs(got - t[role]!) <= tol[key] });
    }
  }
  for (const key of ["creditHours", "circadianTolerance"] as const) {
    const t = truth.targets[key];
    if (t === undefined) continue;
    const raw = profile.explicitTargets?.[key];
    const got = raw === undefined ? null : typeof raw === "number" ? raw : raw.ideal ?? null;
    out.push({ key, role: "ideal", truth: t, got, ok: got !== null && Math.abs(got - t) <= tol[key] });
  }
  return out;
}

const JUDGE_TOOL: Anthropic.Tool = {
  name: "grade",
  description: "Grade this interview.",
  input_schema: {
    type: "object",
    properties: {
      personalCaptured: {
        type: "array",
        description: "One entry per truth personal-life item, in order.",
        items: { type: "object", properties: { item: { type: "string" }, captured: { type: "boolean" }, note: { type: "string" } }, required: ["item", "captured"] },
      },
      dealbreakers: {
        type: "object",
        properties: {
          correct: { type: "integer", description: "Truth dealbreakers the profile flagged as dealbreakers." },
          missed: { type: "integer", description: "Truth dealbreakers not flagged as dealbreakers." },
          spurious: { type: "integer", description: "Facts flagged as dealbreakers that are not real refusals per the truth sheet." },
        },
        required: ["correct", "missed", "spurious"],
      },
      redundantQuestions: {
        type: "array",
        description: "Questions that re-asked something the pilot had already clearly answered (in the bidding story or an earlier turn) with no new angle. Quote the question briefly and say where it was already answered.",
        items: { type: "string" },
      },
      wastedQuestions: {
        type: "array",
        description: "Questions that could not plausibly change this pilot's ranking or sharpen the profile (filler), or that were confusing/ambiguous enough to produce a misleading answer.",
        items: { type: "string" },
      },
      misreads: {
        type: "array",
        description: "Facts in the final profile that contradict the truth sheet or the pilot's actual words (wrong direction, wrong number, invented details, meta-commentary).",
        items: { type: "string" },
      },
      missedSignals: {
        type: "array",
        description: "Things the pilot actually said (story or answers) that the final profile failed to capture at all.",
        items: { type: "string" },
      },
      voiceMatch: { type: "integer", description: "1-5: how native the interviewer's questions would feel to THIS pilot given how they talk (5 = feels like a colleague who talks like them; 1 = generic/mismatched register, e.g. long-winded questions to a terse pilot, idioms to a non-native speaker)." },
      voiceNote: { type: "string" },
      jargonExplained: { type: "integer", description: "Count of questions that defined or explained pilot jargon (a rule violation)." },
      overall: { type: "integer", description: "1-10 overall quality of this interview as an experience AND as a profile builder." },
      topImprovements: { type: "array", items: { type: "string" }, description: "The 3 most valuable concrete changes that would have made this interview smarter or its result cleaner." },
    },
    required: ["personalCaptured", "dealbreakers", "redundantQuestions", "wastedQuestions", "misreads", "missedSignals", "voiceMatch", "jargonExplained", "overall", "topImprovements"],
  },
};

async function judge(client: Anthropic, persona: Persona, story: string | null, conversation: string[], profileSummary: unknown) {
  const input = await callTool(client, {
    model: JUDGE_MODEL,
    max_tokens: 8000,
    system:
      "You grade an AI interview that builds a FedEx pilot's bid-line preference profile. You see the pilot's hidden truth sheet, the conversation, and the final profile. Be exacting and concrete; do not give credit for things the profile does not actually contain.",
    messages: [
      {
        role: "user",
        content: `TRUTH SHEET\n${personaSheet(persona)}\n\nBIDDING STORY\n${story ?? "(skipped)"}\n\nCONVERSATION\n${conversation.join("\n")}\n\nFINAL PROFILE\n${JSON.stringify(profileSummary, null, 1)}`,
      },
    ],
    tools: [JUDGE_TOOL],
  }, "grade");
  return input ?? { error: "judge returned no grade" };
}

// ---------------------------------------------------------------------------
// One interview, end to end
// ---------------------------------------------------------------------------

async function runPersona(client: Anthropic, apiKey: string, pack: BidPack, persona: Persona, withStory: boolean, outDir: string, opts: { storyOnly: boolean; judge: boolean }) {
  const grounding = computeBidPackGroundingStats(pack);
  const ranges = getBidPackRanges(pack) as unknown as Record<string, [number, number]>;
  const cityCodes = rankLayoverCitiesByFrequency(pack).map((c) => c.code);
  const usage = { turns: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, ms: 0 };
  const log = (s: string) => console.log(`[${persona.name}] ${s}`);
  const md: string[] = [`# ${persona.name}${withStory ? "" : " (no story)"}\n`];
  const mdPath = path.join(outDir, `${persona.name}${withStory ? "" : "-nostory"}.md`);
  // Written after every turn, so a run cut short (an API outage, credits running out) still leaves its transcript.
  const flush = () => writeFile(mdPath, md.join("\n"));

  // 1. Bidding story
  let story: string | null = null;
  let storyFacts: PreferenceFact[] = [];
  let storyCommuter: boolean | null = null;
  if (withStory) {
    story = await simStory(client, persona);
    md.push(`## Bidding story\n\n${story}\n`);
    const t0 = Date.now();
    checkBudget();
    const extraction = await runBiddingStoryExtraction(
      apiKey,
      { bidStoryText: story, grounding, base: pack.base, aircraft: pack.aircraft, isCommuter: null, cityCodes },
      (u) => meter(INTERVIEW_MODEL, u)
    );
    usage.ms += Date.now() - t0;
    if (!extraction.ok) throw new Error(`story extraction failed: ${extraction.error}`);
    storyFacts = applyProfileUpdates([], extraction.profileUpdates);
    storyCommuter = extraction.commuterStatus;
    md.push(`## Extracted from story (${storyFacts.length})\n\n${storyFacts.map((f) => `- [${f.kind}${f.measurable ? ` ${JSON.stringify(f.measurable)}` : ""} imp ${f.importance} conf ${f.confidence}${f.severity ? " DEALBREAKER" : ""}${f.recurringWeekday ? ` weekly:${f.recurringWeekday}` : ""}${f.specificDates ? ` dates:${f.specificDates.join(",")}` : ""}${f.cityReason ? ` cityReason:${JSON.stringify(f.cityReason)}` : ""}] ${f.statement}`).join("\n")}\n`);
    md.push(`Style phrases: ${JSON.stringify(extraction.styleSamplePhrases)} tags: ${JSON.stringify(extraction.styleTags)}${storyCommuter !== null ? ` commuter: ${storyCommuter}` : ""}\n`);
    log(`story: ${story.length} chars -> ${storyFacts.length} facts`);
  }

  if (opts.storyOnly) {
    await flush();
    const storyIds = new Set(storyFacts.flatMap((f) => (f.measurable && "key" in f.measurable ? [f.measurable.key] : f.measurable?.type === "implicit-weight" ? [f.measurable.variableId] : [])));
    log(`story-only: ${storyFacts.length} facts, ids ${[...storyIds].join(",")}`);
    return { persona: persona.name, storyOnly: true, storyChars: story?.length ?? 0, storyFacts: storyFacts.length, ids: [...storyIds], dealbreakers: storyFacts.filter((f) => f.severity).map((f) => f.statement), weekly: storyFacts.flatMap((f) => (f.recurringWeekday ? [f.recurringWeekday] : [])), dates: storyFacts.flatMap((f) => f.specificDates ?? []), commuter: storyCommuter };
  }

  // 2. City picker: the story's own picks prefill it, the pilot adds theirs on top.
  const cityPreferences: Record<string, CitySentiment> = { ...storyCitySentiments(storyFacts), ...persona.pickerCities };
  let facts = mergeStoryAndCityFacts(storyFacts, cityPreferences);
  const storyCovered = new Set(facts.filter((f) => f.measurable && "key" in f.measurable).map((f) => (f.measurable as { key: string }).key));

  // 3. Turn loop
  let transcript: InterviewTurnRecord[] = [];
  let turnsUsed = 0;
  const conversation: string[] = [];
  let wrapped = false;
  md.push("## Interview\n");
  while (true) {
    const req = buildTurnRequest({
      transcript, facts, grounding, base: pack.base, aircraft: pack.aircraft, isCommuter: persona.isCommuter, turnsUsed,
      bidStory: story ?? undefined,
    });
    const t0 = Date.now();
    checkBudget();
    const result = await runInterviewTurn(apiKey, req, (u) => {
      meter(INTERVIEW_MODEL, u);
      usage.turns++;
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.cacheRead += u.cacheReadTokens;
      usage.cacheWrite += u.cacheWriteTokens;
    });
    usage.ms += Date.now() - t0;
    if (!result.ok) {
      md.push(`**Turn failed: ${result.error}**`);
      log(`turn ${turnsUsed} FAILED: ${result.error}`);
      break;
    }
    facts = applyProfileUpdates(facts, result.turn.profileUpdates);
    const added = result.turn.profileUpdates.filter((u) => u.op !== "retire").map((u) => (u as { fact: PreferenceFact }).fact);
    const retired = result.turn.profileUpdates.filter((u) => u.op === "retire").length;
    if (added.length) md.push(added.map((f) => `  - _${f.kind}${f.measurable ? ` ${JSON.stringify(f.measurable)} imp ${f.importance}` : ""}${f.severity ? " DEALBREAKER" : ""}${f.recurringWeekday ? ` weekly:${f.recurringWeekday}` : ""}${f.specificDates ? ` dates:${f.specificDates.join(",")}` : ""}: ${f.statement}_`).join("\n"));
    if (retired) md.push(`  - _retired ${retired}_`);
    if (result.turn.heard) md.push(`  > heard: ${result.turn.heard}`);
    md.push(`  > reasoning (t${turnsUsed}, ${Math.round((Date.now() - t0) / 100) / 10}s, floor ${req.minTurnsBeforeWrap}, uncovered: ${req.uncoveredExplicitWeightIds.join(",") || "none"}, essentials: ${req.openEssentials.join(",") || "none"}): ${result.turn.reasoning ?? "-"}`);
    if (result.turn.action === "wrap_up" || !result.turn.question || turnsUsed >= HARD_CEILING_TURNS) {
      wrapped = result.turn.action === "wrap_up";
      md.push(`\n**${wrapped ? "Wrapped up" : "Stopped"} after ${turnsUsed} questions.**\n`);
      break;
    }
    const q = result.turn.question;
    const answer = await simAnswer(client, persona, conversation, q, ranges);
    const qLine = `Q${turnsUsed + 1} (${q.kind}${"boundTo" in q ? ` ${q.boundTo}` : ""}${q.topic ? ` · ${q.topic}` : ""}${"rangeRole" in q && q.rangeRole ? ` ${q.rangeRole}` : ""}): ${q.prompt}${q.kind === "slider" ? ` [${q.lowLabel} | ${q.centerLabel} | ${q.highLabel}]` : ""}${q.kind === "choice" ? ` [${q.options.map((o) => o.label).join(" / ")}]` : ""}`;
    const aLine = `A: ${formatAnswer(q, answer)}`;
    conversation.push(qLine, aLine);
    md.push(`\n**${qLine}**\n${aLine}`);
    transcript = [...transcript, { turnIndex: turnsUsed, question: q, answer, profileFactIdsTouched: [] }];
    turnsUsed++;
    if (turnsUsed % 5 === 0) log(`turn ${turnsUsed}`);
    await flush();
  }

  const profile = finalizeAdaptiveProfile({ facts, transcript, isCommuter: persona.isCommuter, hasCrashPad: persona.hasCrashPad, cityPreferencesSeed: cityPreferences });
  const ids = applicableExplicitWeightIds(packHasHotelStandby(grounding));
  const weightAcc = explicitWeightAccuracy(persona.truth, profile, ids);
  const targets = targetAccuracy(persona.truth, profile);
  const cityRows = Object.entries(persona.truth.cities).map(([code, s]) => ({ code, truth: s, got: profile.cityPreferences[code] ?? null }));
  const profileSummary = {
    weights: profile.weights,
    explicitTargets: profile.explicitTargets,
    cityPreferences: profile.cityPreferences,
    implicitWeights: profile.implicitWeights,
    dealbreakers: profile.discoveredFacts.filter((f) => f.severity === "dealbreaker").map((f) => f.statement),
    qualitativeFacts: profile.discoveredFacts
      .filter((f) => f.kind === "qualitative")
      .map((f) => `${f.statement}${f.recurringWeekday ? ` [weekly: ${f.recurringWeekday}]` : ""}${f.specificDates ? ` [dates: ${f.specificDates.join(", ")}]` : ""}`),
  };
  const grade = opts.judge ? await judge(client, persona, story, conversation, profileSummary) : { skipped: true, overall: null as number | null };

  const summary = {
    persona: persona.name,
    withStory,
    turns: turnsUsed,
    wrapped,
    storyFacts: storyFacts.length,
    storyExplicitIdsCovered: [...storyCovered],
    explicitCorrect: `${weightAcc.correct}/${weightAcc.total}`,
    explicitMeanAbsError: weightAcc.meanAbsError,
    wrongIds: weightAcc.rows.filter((r) => !r.correct).map((r) => `${r.id} truth ${r.truth} got ${r.got}`),
    targets,
    cities: cityRows,
    implicitCount: Object.keys(profile.implicitWeights ?? {}).length,
    storyCommuterCorrect: storyCommuter === null ? "not stated" : storyCommuter === persona.isCommuter,
    calendar: {
      implicit: Object.entries(persona.truth.implicit ?? {}).map(([id, dir]) => ({
        id,
        truth: dir,
        got: profile.implicitWeights?.[id] ?? null,
        ok: Math.sign(profile.implicitWeights?.[id] ?? 0) === dir,
      })),
      weekly: persona.truth.weekly
        ? { truth: persona.truth.weekly, ok: profile.discoveredFacts.some((f) => f.recurringWeekday === persona.truth.weekly) }
        : null,
      dates: persona.truth.dates
        ? {
            truth: persona.truth.dates,
            got: [...new Set(profile.discoveredFacts.flatMap((f) => f.specificDates ?? []))],
            ok: persona.truth.dates.every((d) => profile.discoveredFacts.some((f) => f.specificDates?.includes(d))),
          }
        : null,
    },
    qualitativeCount: profileSummary.qualitativeFacts.length,
    usage,
    grade,
  };
  md.push(`\n## Final profile\n\n\`\`\`json\n${JSON.stringify(profileSummary, null, 1)}\n\`\`\`\n\n## Scores\n\n\`\`\`json\n${JSON.stringify(summary, null, 1)}\n\`\`\``);
  await flush();
  log(`done: ${turnsUsed} turns, explicit ${summary.explicitCorrect}, MAE ${summary.explicitMeanAbsError}, overall ${grade.overall}`);
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const [packPath, outDir, ...rest] = args;
  const withStory = !rest.includes("--no-story");
  const opts = { storyOnly: rest.includes("--story-only"), judge: !rest.includes("--no-judge") };
  const names = rest.filter((a) => !a.startsWith("--"));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !packPath || !outDir) throw new Error("usage: eval-adaptive-interview.ts <pack.json> <outDir> [persona...] [--no-story]");
  const pack = JSON.parse(await readFile(packPath, "utf-8")) as BidPack;
  await mkdir(outDir, { recursive: true });
  const client = new Anthropic({ apiKey });
  const personas = names.length ? PERSONAS.filter((p) => names.includes(p.name)) : PERSONAS;
  const results = await Promise.all(personas.map((p) => runPersona(client, apiKey, pack, p, withStory, outDir, opts).catch((e) => ({ persona: p.name, error: String(e) }))));
  await writeFile(path.join(outDir, `summary${withStory ? "" : "-nostory"}${opts.storyOnly ? "-storyonly" : ""}.json`), JSON.stringify({ results, spend }, null, 1));
  console.log(`SPEND (estimate): $${spend.usd.toFixed(3)}`, JSON.stringify(spend.byModel));
  console.log(JSON.stringify(results.map((r) => ("error" in r ? r : { ...r, grade: undefined, targets: undefined, cities: undefined })), null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
