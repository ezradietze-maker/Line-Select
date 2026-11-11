import { describe, expect, it } from "vitest";
import { pickQuestionExamples } from "@/lib/brain/question-examples";
import { askedTopics, pickTopics, topicOf, topicThread } from "@/lib/brain/question-topics";
import { prepareMetrics } from "@/lib/metrics/compute";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { BidPack } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const crit = (id: string, metric: string, weight: number, over: Partial<Criterion> = {}): Criterion => ({ id, metric, label: id, shape: { kind: "more" }, tier: "high", weight, confidence: 0.8, evidence: [], status: "settled", ...over });
const model = (criteria: Criterion[]): PilotModel => ({ version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria });
// A pack big enough to have a top 20: the sample's lines four times over, each copy with its own days off and credit.
const PACK: BidPack = {
  ...SAMPLE_BID_PACK,
  lines: [0, 1, 2, 3].flatMap((k) =>
    SAMPLE_BID_PACK.lines.map((l, i) => ({ ...l, id: `${l.id}-${k}`, lineNumber: String(3000 + k * 100 + i), daysOff: 11 + ((i * 3 + k * 5) % 8), totalCreditHours: 70 + ((i * 7 + k * 3) % 15) }))
  ),
};
const pm = prepareMetrics(PACK);

describe("what's worth asking next", () => {
  it("puts similar priorities under one topic", () => {
    expect(topicOf("daysOff")).toBe("home");
    expect(topicOf("longestDaysOffBlock")).toBe("home");
    expect(topicOf("homeDepartures")).toBe("trips");
    expect(topicOf("longestTripDays")).toBe("trips");
    expect(topicOf("nightHubTurnRuns")).toBe("night");
    expect(topicOf("restHotelHubTurns")).toBe("night");
    expect(topicOf("hotelStandbyDays")).toBe("standby");
  });

  it("offers the topics an answer could move the top 20 on, most first, each with its examples", () => {
    const m = model([crit("Days off", "daysOff", 0.9), crit("Credit", "creditHours", 0.6), crit("Fewer landings", "landings", 0.4, { shape: { kind: "less" } })]);
    const examples = pickQuestionExamples(PACK, m, pm);
    const { topics, examples: shown } = pickTopics(PACK, m, pm, {}, examples, 6);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.map((t) => t.moves)).toEqual([...topics.map((t) => t.moves)].sort((a, b) => b - a));
    expect(topics.every((t) => t.moves >= 3)).toBe(true);
    for (const t of topics) for (const id of t.exampleIds) expect(shown.some((e) => e.id === id)).toBe(true);
    expect(new Set(topics.map((t) => t.id)).size).toBe(topics.length);
  });

  it("never offers a topic already asked", () => {
    const m = model([crit("Days off", "daysOff", 0.9), crit("Credit", "creditHours", 0.6)]);
    const examples = pickQuestionExamples(PACK, m, pm);
    const first = pickTopics(PACK, m, pm, {}, examples, 6).topics;
    expect(first.length).toBeGreaterThan(0);
    const asked = askedTopics({ [topicThread(first[0].id)]: { timesAsked: 1 }, other: { timesAsked: 3 } });
    expect(asked).toEqual({ [first[0].id]: 1 });
    expect(pickTopics(PACK, m, pm, asked, examples, 6).topics.some((t) => t.id === first[0].id)).toBe(false);
  });

  it("asks about a feature only in a kind of thing they haven't talked about — one they have is asked in their words", () => {
    const m = model([crit("Days off", "daysOff", 0.9), crit("Less night work", "deepNightHours", 0.7, { shape: { kind: "less" } })]);
    const { topics } = pickTopics(PACK, m, pm, {}, [], 9);
    expect(topics.filter((t) => t.feature).every((t) => t.id !== "night" && t.id !== "home")).toBe(true);
    // Deadheads from home mean nothing to a pilot who lives where they're based.
    expect(topics.some((t) => t.feature && t.id === "commute")).toBe(false);
  });
});
