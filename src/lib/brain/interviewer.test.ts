import { beforeEach, describe, expect, it, vi } from "vitest";

const proposals: unknown[] = [];
vi.mock("@/lib/brain/llm", () => ({
  structuredCall: vi.fn(async () => ({ data: proposals.shift(), usage: { model: "m", inputTokens: 0, outputTokens: 0, costUsd: 0.01, ms: 5 } })),
}));

import { nextInterviewStep, rankingHasSettled, SWEEP_QUESTION, type InterviewStepInput } from "@/lib/brain/interviewer";
import type { PilotModel } from "@/types/pilot-model";

const step = (over: Record<string, unknown>) => ({ settled: [], done: false, reason: "r", threadId: "", kind: "free-text", ack: "", prompt: "", helpText: "", options: [], pairIndex: -1, examples: [], ...over });
const model: PilotModel = {
  version: 2, home: null, criteria: [], notMeasurable: [], synopsis: "s",
  threads: [
    { id: "buffers", topic: "Commute buffer", why: "w", priority: 0.9, status: "open", criteria: [], timesAsked: 0 },
    { id: "china", topic: "Other China cities", why: "w", priority: 0.5, status: "open", criteria: [], timesAsked: 0 },
  ],
};
const input = (over: Partial<InterviewStepInput> = {}): InterviewStepInput => ({
  packBrief: "brief", pilotContext: "ctx", model, turn: 3, maxTurns: 20,
  exchanges: [{ turn: 0, question: "Walk us through how you bid.", answer: "Double deadheads, single legs." }, { turn: 1, question: "How many backup flights do you want?", answer: "Two." }],
  threads: { buffers: { status: "settled", timesAsked: 1 }, china: { status: "open", timesAsked: 0 } },
  linePairs: [{ index: 0, a: "1011", b: "1018", trade: "x|y", tension: "t", summaryA: "a", summaryB: "b" }],
  ...over,
});

describe("the interviewer's guard rails", () => {
  beforeEach(() => {
    proposals.length = 0;
  });

  it("never re-asks a settled thread or a question already asked — it asks again for something new", async () => {
    proposals.push(
      step({ threadId: "buffers", prompt: "How much buffer do you want before a report?" }),
      step({ threadId: "china", prompt: "How many backup flights do you want?" }),
      step({ threadId: "china", prompt: "Do Shanghai and Shenzhen bother you as much as Guangzhou?" })
    );
    const r = await nextInterviewStep(input());
    expect(r).toMatchObject({ done: false, threadId: "china", prompt: "Do Shanghai and Shenzhen bother you as much as Guangzhou?" });
  });

  it("accepts a line pair it was offered, never one it wasn't or one already compared", async () => {
    proposals.push(step({ kind: "line-pair", pairIndex: 3, prompt: "Which?" }), step({ kind: "line-pair", pairIndex: 0, prompt: "Line 1011 or 1018?" }));
    const r = await nextInterviewStep(input());
    expect(r).toMatchObject({ done: false, kind: "line-pair", pair: { a: "1011", b: "1018" } });

    proposals.push(step({ kind: "line-pair", pairIndex: 0, prompt: "Again?" }), step({ prompt: "Something else?" }));
    const again = await nextInterviewStep(input({ exchanges: [...input().exchanges, { turn: 2, question: "Pick one [Line 1011 vs Line 1018: t]", answer: "1011" }] }));
    expect(again).toMatchObject({ prompt: "Something else?" });
  });

  it("never asks two line choices in a row", async () => {
    const one = [...input().exchanges, { turn: 2, question: "A? [Line 1001 vs Line 1002: t]", answer: "1001" }];
    proposals.push(step({ kind: "line-pair", pairIndex: 0, prompt: "Line 1011 or 1018?" }), step({ prompt: "What makes a layover long for you?" }));
    expect(await nextInterviewStep(input({ exchanges: one }))).toMatchObject({ kind: "free-text", prompt: "What makes a layover long for you?" });
  });

  it("keeps line choices to about a third of the questions", async () => {
    // Story, commute, cities; then four questions, two of them line choices — a third would make it 3 of 5.
    const opening = [0, 1, 2].map((turn) => ({ turn, question: `Opening ${turn}`, answer: "a" }));
    const asked = [
      { turn: 3, question: "A? [Line 1001 vs Line 1002: t]", answer: "1001" },
      { turn: 4, question: "Why weekends?", answer: "Soccer." },
      { turn: 5, question: "B? [Line 1003 vs Line 1004: t]", answer: "1004" },
      { turn: 6, question: "How many days at home?", answer: "Five days." },
    ];
    proposals.push(step({ kind: "line-pair", pairIndex: 0, prompt: "1011 or 1018?" }), step({ prompt: "Night flying into Memphis — how many is too many?" }));
    expect(await nextInterviewStep(input({ exchanges: [...opening, ...asked], turn: 4 }))).toMatchObject({ kind: "free-text" });
  });

  it("says back what it heard before the next question, but not before the first", async () => {
    proposals.push(step({ ack: "Saturdays over Sundays — got it.", prompt: "How many days at home make a real break?" }));
    expect(await nextInterviewStep(input())).toMatchObject({ ack: "Saturdays over Sundays — got it." });
    proposals.push(step({ ack: "Hello.", prompt: "First question?" }));
    expect(await nextInterviewStep(input({ turn: 0 }))).not.toHaveProperty("ack");
  });

  it("ends by itself once the ranking has stopped moving", async () => {
    const r = await nextInterviewStep(input({ turn: 13, rankingShifts: [2, 1, 0], threads: { buffers: { status: "settled", timesAsked: 1 }, china: { status: "settled", timesAsked: 1 } } }));
    expect(r).toMatchObject({ done: true });
  });

  it("turns a choice with too few options into an open question, and stops at the turn limit or after three dead ends", async () => {
    proposals.push(step({ kind: "choice", options: ["Only one"], prompt: "Pick?" }));
    expect(await nextInterviewStep(input())).toMatchObject({ kind: "free-text" });

    // At the limit it's done without asking the model: no call is paid for.
    expect(await nextInterviewStep(input({ turn: 20 }))).toMatchObject({ done: true });
    expect(proposals).toHaveLength(0);

    proposals.push(...[1, 2, 3].map(() => step({ threadId: "buffers", prompt: "Buffer again?" })));
    expect(await nextInterviewStep(input())).toMatchObject({ done: true, reason: "No new question left to ask." });
  });

  it("only passes on settled ids for threads that exist", async () => {
    proposals.push(step({ done: true, settled: ["china", "made-up"] }));
    expect(await nextInterviewStep(input())).toMatchObject({ done: true, settled: ["china"] });
  });
});

describe("rankingHasSettled", () => {
  const model = { version: 2, home: null, criteria: [], notMeasurable: [], synopsis: "", threads: [{ id: "t1", topic: "", why: "", priority: 0.8, status: "open", criteria: [], timesAsked: 0 }] } as unknown as PilotModel;
  it("waits for enough questions and two quiet re-reads", () => {
    expect(rankingHasSettled({ exchanges: [], turn: 8, rankingShifts: [0, 0], model: null, threads: {} })).toBe(false);
    expect(rankingHasSettled({ exchanges: [], turn: 12, rankingShifts: [3, 1, 0], model: null, threads: {} })).toBe(true);
    expect(rankingHasSettled({ exchanges: [], turn: 12, rankingShifts: [0, 2], model: null, threads: {} })).toBe(false);
  });
  it("never stops straight after the anything-else screen — what they raised there gets its follow-ups", () => {
    const sweep = [{ turn: 9, question: SWEEP_QUESTION, answer: "Hotel gyms, actually." }];
    expect(rankingHasSettled({ exchanges: sweep, turn: 14, rankingShifts: [0, 0], model: null, threads: {} })).toBe(false);
  });
  it("keeps going while an important thread is still open", () => {
    expect(rankingHasSettled({ exchanges: [], turn: 14, rankingShifts: [0, 0], model, threads: {} })).toBe(false);
    expect(rankingHasSettled({ exchanges: [], turn: 14, rankingShifts: [0, 0], model, threads: { t1: { status: "settled", timesAsked: 1 } } })).toBe(true);
  });
});

describe("pilot words", () => {
  beforeEach(() => {
    proposals.length = 0;
  });

  it("sends back a question in made-up words, and takes it said the way a pilot says it", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "Say a trip joins from LAX and the layovers are ordinary — how much of your layover value would you give up?" }),
      step({ threadId: "china", prompt: "How much do the trips that start with a deadhead to LAX count for you?" })
    );
    const r = await nextInterviewStep(input());
    expect(r).toMatchObject({ done: false, prompt: "How much do the trips that start with a deadhead to LAX count for you?" });
  });

  it("checks the reply and the options too", async () => {
    proposals.push(
      step({ threadId: "china", ack: "Layover value matters — got it.", prompt: "Which matters more?", kind: "choice", options: ["Trips you can join from SAN", "Layovers"] }),
      step({ threadId: "china", ack: "Layovers matter — got it.", prompt: "Which matters more?", kind: "choice", options: ["Front-end deadheads from SAN", "Layovers"] })
    );
    const r = await nextInterviewStep(input());
    expect(r).toMatchObject({ done: false, ack: "Layovers matter — got it.", options: ["Front-end deadheads from SAN", "Layovers"] });
  });

  it("lets the pilot's own words through", async () => {
    const own = input({ exchanges: [{ turn: 0, question: "Walk us through how you bid.", answer: "I like trips I can join from Denver." }] });
    proposals.push(step({ threadId: "china", prompt: "You like trips you can join from Denver — how many a month?" }));
    expect(await nextInterviewStep(own)).toMatchObject({ done: false, prompt: "You like trips you can join from Denver — how many a month?" });
  });

  it("sends back a word that's in neither the pack nor the ex-pilot's talk", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "How many red-eyes into base before it wears on you?" }),
      step({ threadId: "china", prompt: "How many nights of flying into Memphis before it wears on you?" })
    );
    expect(await nextInterviewStep(input())).toMatchObject({ done: false, prompt: "How many nights of flying into Memphis before it wears on you?" });
    expect(proposals).toHaveLength(0);
  });

  it("lets such a word through only if the pilot brought it up, and only that word", async () => {
    const own = input({ exchanges: [{ turn: 0, question: "Walk us through how you bid.", answer: "Red-eyes into Memphis wear me out." }] });
    proposals.push(step({ threadId: "china", prompt: "How many red-eyes a month is too many?" }));
    expect(await nextInterviewStep(own)).toMatchObject({ done: false, prompt: "How many red-eyes a month is too many?" });

    proposals.push(step({ threadId: "china", prompt: "How many all-nighters a month is too many?" }), step({ threadId: "china", prompt: "How many red-eyes a month is too many?" }));
    expect(await nextInterviewStep(own)).toMatchObject({ done: false, prompt: "How many red-eyes a month is too many?" });
    expect(proposals).toHaveLength(0);
  });

  it("doesn't count the app's own questions as the pilot's words", async () => {
    const asked = input({ exchanges: [{ turn: 0, question: "How many red-eyes do you fly?", answer: "Not many." }] });
    proposals.push(step({ threadId: "china", prompt: "How many red-eyes a month?" }), step({ threadId: "china", prompt: "How many nights of flying a month?" }));
    expect(await nextInterviewStep(asked)).toMatchObject({ done: false, prompt: "How many nights of flying a month?" });
  });

  it("sends back a question that stacks two asks, and takes the plain one", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "Would you take line 1005's long trip over line 1024's, and what would tip it?" }),
      step({ threadId: "china", prompt: "How many days off do you want? And how many in a row?" }),
      step({ threadId: "china", prompt: "Would you rather have great layovers, or an easier commute?", helpText: "Line 1005 has the best layovers; line 1024 starts with a deadhead from LAX." })
    );
    expect(await nextInterviewStep(input())).toMatchObject({ done: false, prompt: "Would you rather have great layovers, or an easier commute?" });
    expect(proposals).toHaveLength(0);
  });

  it("sends back a real line set against an imaginary one", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "Would you take line 1005 over one with weaker layovers?" }),
      step({ threadId: "china", prompt: "Which would you bid higher: 1005 or 1024?" })
    );
    expect(await nextInterviewStep(input())).toMatchObject({ done: false, prompt: "Which would you bid higher: 1005 or 1024?" });
  });

  it("puts a long question's figures under it", async () => {
    const long = "Line 1005 has 175 hours in cities you like but its 11-day trip starts and ends with deadheads through SFO and PHX so how do you see it?";
    proposals.push(step({ threadId: "china", prompt: long }), step({ threadId: "china", prompt: "How do you see line 1005's 11-day trip?", helpText: "175 hours in cities you like, with deadheads through SFO and PHX." }));
    expect(await nextInterviewStep(input())).toMatchObject({ prompt: "How do you see line 1005's 11-day trip?" });
  });

  it("never lets a wording slip end the interview", async () => {
    proposals.push(...[0, 1, 2].map(() => step({ threadId: "china", prompt: "How much layover value would you give up?" })));
    expect(await nextInterviewStep(input())).toMatchObject({ done: false, prompt: "How much layover value would you give up?" });
  });
});

describe("replies never invent a limit", () => {
  beforeEach(() => {
    proposals.length = 0;
  });
  // The ex-pilot's Dealbreakers answer, in brief: he ranks rather than filters, rules nothing out, and would ideally commute
  // to base no more than about twice. The reply he got was "That's a firm cap on Memphis".
  const ranksNotFilters = input({
    exchanges: [
      { turn: 0, question: "Walk us through how you bid.", answer: "Layovers first, then commutes." },
      { turn: 1, question: "Dealbreakers: Is there anything that rules a line out for you?", answer: "I rank lines rather than filter them out, so I wouldn't rule anything out as such. Lots of departures or commutes to Memphis give a line a very low score — ideally not more than two." },
    ],
  });

  it("sends back a reply that turns a preference into a rule, and takes it said as a preference", async () => {
    proposals.push(
      step({ threadId: "china", ack: "That's a firm cap on Memphis.", prompt: "Where does a third commute start to cost you?" }),
      step({ threadId: "china", ack: "Two or fewer Memphis commutes, ideally — got it.", prompt: "Where does a third commute start to cost you?" })
    );
    expect(await nextInterviewStep(ranksNotFilters)).toMatchObject({ done: false, ack: "Two or fewer Memphis commutes, ideally — got it." });
  });

  it("drops the reply rather than asking again when it still invents one", async () => {
    proposals.push(
      step({ threadId: "china", ack: "That's a firm cap on Memphis.", prompt: "Where does a third commute start to cost you?" }),
      step({ threadId: "china", ack: "Memphis commutes are a hard limit at two.", prompt: "Where does a third commute start to cost you?" })
    );
    const r = await nextInterviewStep(ranksNotFilters);
    expect(r).toMatchObject({ done: false, prompt: "Where does a third commute start to cost you?" });
    if (r.done) throw new Error("expected a question");
    expect(r.ack).toBeUndefined();
  });

  it("keeps a limit the pilot did state, and a denial of one", async () => {
    const stated = input({ exchanges: [{ turn: 0, question: "Is there anything that would put a line at the bottom of your list?", answer: "Two all-nighters in a row is my absolute limit — I won't bid three, no matter what." }] });
    proposals.push(step({ threadId: "china", ack: "Three in a row is the hard no — got it.", prompt: "How about spread out?" }));
    expect(await nextInterviewStep(stated)).toMatchObject({ ack: "Three in a row is the hard no — got it." });
    proposals.push(step({ threadId: "china", ack: "Commutes cost you, but nothing's an absolute — got it.", prompt: "How about spread out?" }));
    expect(await nextInterviewStep(ranksNotFilters)).toMatchObject({ ack: "Commutes cost you, but nothing's an absolute — got it." });
  });
});

describe("real examples with every question", () => {
  const examples = [
    { id: "E1", kind: "line" as const, ref: "1004", title: "Line 1004", fact: "2 departures", priority: "Few departures", criterionId: "deps", summary: "2 trips", rank: 12 },
    { id: "E2", kind: "line" as const, ref: "1008", title: "Line 1008", fact: "4 departures", priority: "Few departures", criterionId: "deps", summary: "4 trips", rank: 20 },
    { id: "E3", kind: "trip" as const, ref: "88@1", title: "Trip #88 · Sep 29", fact: "2 commutes on this trip", priority: "Avoid commutes", criterionId: "commutes", summary: "MEM → ONT → MEM" },
  ];
  const packNumbers = { lines: ["1004", "1008", "1011", "1018"], trips: ["88", "93"] };
  beforeEach(() => {
    proposals.length = 0;
  });

  it("shows the examples it chose, and puts them in the transcript so the brain reads what was shown", async () => {
    proposals.push(step({ threadId: "china", prompt: "1004 gets you two departures; 1008 takes four. Where does it start to cost you?", examples: ["E1", "E2"] }));
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(r).toMatchObject({ done: false, examples: [examples[0], examples[1]] });
    if (r.done) throw new Error("expected a question");
    expect(r.transcript).toBe("1004 gets you two departures; 1008 takes four. Where does it start to cost you? (Examples shown: Line 1004 — 2 departures (Few departures); Line 1008 — 4 departures (Few departures).)");
  });

  it("asks once for examples when a question comes without them, then lets a question no example fits go as it is", async () => {
    proposals.push(step({ threadId: "china", prompt: "Does Shanghai bother you as much as Guangzhou?" }), step({ threadId: "china", prompt: "Does Shanghai bother you as much as Guangzhou?" }));
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(r).toMatchObject({ done: false, prompt: "Does Shanghai bother you as much as Guangzhou?" });
    if (r.done) throw new Error("expected a question");
    expect(r.examples).toBeUndefined();
    expect(proposals).toHaveLength(0);
  });

  it("never names a line or trip that isn't in their pack", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "Line 1077 has four departures — too many?", examples: ["E1"] }),
      step({ threadId: "china", prompt: "Trip 412 has a long sit in IND — would you fly it?", examples: ["E3"] }),
      step({ threadId: "china", prompt: "1004 has two departures and reports at 0430 on trip 88 — would you bid it?", examples: ["E1"] })
    );
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(r).toMatchObject({ done: false, prompt: "1004 has two departures and reports at 0430 on trip 88 — would you bid it?" });
  });

  it("never shows an example it wasn't offered", async () => {
    proposals.push(step({ threadId: "china", prompt: "Trip 88 has two commutes — too many?", examples: ["E9"] }), step({ threadId: "china", prompt: "Trip 88 has two commutes — too many?", examples: ["E3"] }));
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(r).toMatchObject({ done: false, examples: [examples[2]] });
  });

  it("shows examples of one priority only — the one the question is about", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "1004 has two departures and trip 88 two commutes — how do they weigh?", examples: ["E1", "E3"] }),
      step({ threadId: "china", prompt: "1004 gets you two departures; 1008 takes four. Where does it start to cost you?", examples: ["E1", "E2"] })
    );
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(r).toMatchObject({ done: false, examples: [examples[0], examples[1]] });
  });

  it("never asks about a made-up line or trip", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "If a line instead had Sydney layovers but more departures, would you take it?", examples: ["E1"] }),
      step({ threadId: "china", prompt: "Say a trip had a 5-hour sit in IND — would you fly it?", examples: ["E3"] }),
      step({ threadId: "china", prompt: "1004 gets you two departures; 1008 takes four. Where does it start to cost you?", examples: ["E1", "E2"] })
    );
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(r).toMatchObject({ done: false, prompt: "1004 gets you two departures; 1008 takes four. Where does it start to cost you?" });
  });

  it("shows every line a question names, even one it didn't pick as an example", async () => {
    proposals.push(step({ threadId: "china", prompt: "How many departures before it bothers you?", helpText: "For example, line 1004 has two; line 1008 has four.", examples: ["E3"] }));
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    // The lines it names take the place of the trip: lines or a trip, never both.
    expect(r).toMatchObject({ done: false, examples: [examples[0], examples[1]] });
  });

  it("shows lines in pairs — asks once for the other end, then adds it", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "How many departures before it bothers you?", helpText: "Line 1004 has two.", examples: ["E1"] }),
      step({ threadId: "china", prompt: "How many departures before it bothers you?", helpText: "Line 1004 has two.", examples: ["E1"] })
    );
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(proposals).toHaveLength(0);
    expect(r).toMatchObject({ done: false, examples: [examples[0], examples[1]] });
  });

  it("never weighs one thing against a list of others", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "How much does one long trip and one short trip matter next to layovers and days off?", examples: ["E1", "E2"] }),
      step({ threadId: "china", prompt: "How many departures before it bothers you?", examples: ["E1", "E2"] })
    );
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(r).toMatchObject({ done: false, prompt: "How many departures before it bothers you?" });
  });

  it("shows only what the question's thread is about — lines picked for another priority go back, or are left off", async () => {
    const onCommutes = { ...model, threads: [...model.threads.filter((t) => t.id !== "china"), { id: "china", topic: "IND layovers", why: "w", priority: 0.5, status: "open" as const, criteria: ["commutes"], timesAsked: 0 }] };
    proposals.push(
      step({ threadId: "china", prompt: "How much would you give up to avoid IND?", examples: ["E1", "E2"] }),
      step({ threadId: "china", prompt: "How much would you give up to avoid IND?", examples: ["E1", "E2"] }),
      step({ threadId: "china", prompt: "How much would you give up to avoid IND?", examples: ["E1", "E2"] })
    );
    const r = await nextInterviewStep(input({ examples, packNumbers, model: onCommutes }));
    expect(proposals).toHaveLength(0);
    expect(r).toMatchObject({ done: false, prompt: "How much would you give up to avoid IND?" });
    if (r.done) throw new Error("expected a question");
    expect(r.examples).toBeUndefined();
  });

  it("never names a line shown only for another priority than the question's", async () => {
    const onDeps = { ...model, threads: [...model.threads.filter((t) => t.id !== "china"), { id: "china", topic: "Departures", why: "w", priority: 0.5, status: "open" as const, criteria: ["deps"], timesAsked: 0 }] };
    const elsewhere = [...examples, { id: "E4", kind: "line" as const, ref: "1011", title: "Line 1011", fact: "2 commutes", priority: "Avoid commutes", criterionId: "commutes", summary: "s" }];
    proposals.push(
      step({ threadId: "china", prompt: "How many departures before it bothers you?", helpText: "Line 1004 has two; line 1011 has two commutes.", examples: ["E1", "E2"] }),
      step({ threadId: "china", prompt: "How many departures before it bothers you?", helpText: "Line 1004 has two; line 1008 has four.", examples: ["E1", "E2"] })
    );
    const r = await nextInterviewStep(input({ examples: elsewhere, packNumbers, model: onDeps }));
    expect(r).toMatchObject({ done: false, helpText: "Line 1004 has two; line 1008 has four." });
  });

  it("shows the trip it names, and asks again when it names one it doesn't show", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "How many commutes before it bothers you?", helpText: "Trip 88 takes two, line 1004 has two departures.", examples: ["E1", "E2"] }),
      step({ threadId: "china", prompt: "How many commutes before it bothers you?", helpText: "Trip 88 takes two commutes.", examples: ["E3"] })
    );
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(proposals).toHaveLength(0);
    expect(r).toMatchObject({ done: false, examples: [examples[2]] });
  });

  it("on its last try, still shows every line it names — a line no example covers, bare", async () => {
    const same = step({ threadId: "china", prompt: "How many departures before it bothers you?", helpText: "Line 1004 has two; line 1018 has five.", examples: ["E1", "E2"] });
    proposals.push(same, same, same);
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    if (r.done) throw new Error("expected a question");
    expect(r.examples?.map((e) => [e.ref, e.fact])).toEqual([["1004", "2 departures"], ["1008", "4 departures"], ["1018", ""]]);
    expect(r.transcript).toContain("; Line 1018.)");
  });

  it("never sends help text that corrects itself partway", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "How many departures before it bothers you?", helpText: "1004 has two on 1008's side. Correction: 1008 has four.", examples: ["E1", "E2"] }),
      step({ threadId: "china", prompt: "How many departures before it bothers you?", helpText: "1004 has two; 1008 has four.", examples: ["E1", "E2"] })
    );
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(r).toMatchObject({ done: false, helpText: "1004 has two; 1008 has four." });
  });

  it("asks again for a question showing a line and a trip together", async () => {
    const withTrip = [...examples, { id: "E4", kind: "trip" as const, ref: "93@2", title: "Trip #93 · Oct 1", fact: "1 departure", priority: "Few departures", criterionId: "deps", summary: "MEM → ANC → MEM" }];
    proposals.push(
      step({ threadId: "china", prompt: "How many departures before it bothers you?", examples: ["E2", "E4"] }),
      step({ threadId: "china", prompt: "How many departures before it bothers you?", examples: ["E1", "E2"] })
    );
    const r = await nextInterviewStep(input({ examples: withTrip, packNumbers }));
    expect(proposals).toHaveLength(0);
    expect(r).toMatchObject({ done: false, examples: [examples[0], examples[1]] });
  });

  it("never names a line it has no example of to show", async () => {
    proposals.push(
      step({ threadId: "china", prompt: "How many departures before it bothers you?", helpText: "Line 1004 has two; line 1011 has five.", examples: ["E1"] }),
      step({ threadId: "china", prompt: "How many departures before it bothers you?", helpText: "Line 1004 has two; line 1008 has four.", examples: ["E1", "E2"] })
    );
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(r).toMatchObject({ done: false, helpText: "Line 1004 has two; line 1008 has four." });
  });

  it("puts no examples on a line choice — the two lines are the example", async () => {
    proposals.push(step({ kind: "line-pair", pairIndex: 0, prompt: "1011 or 1018?", examples: ["E1"] }));
    const r = await nextInterviewStep(input({ examples, packNumbers }));
    expect(r).toMatchObject({ done: false, kind: "line-pair" });
    if (r.done) throw new Error("expected a question");
    expect(r.examples).toBeUndefined();
  });
});

