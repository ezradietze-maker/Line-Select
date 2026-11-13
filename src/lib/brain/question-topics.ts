import { formatValue } from "@/lib/brain/describe";
import { namedDomicile } from "@/lib/domicile-name";
import { METRICS_BY_ID, type MetricCategory } from "@/lib/metrics/catalog";
import { measure, type PackMetrics } from "@/lib/metrics/compute";
import { homeParams, scorePackV2 } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";
import type { QuestionExample } from "./question-examples";
import { HUB_TURNS_LEAD, REST_HOTEL_LEAD } from "@/lib/brain/hub-turn-question";

/**
 * What's worth asking next. The interviewer used to choose its own topic every turn, and asked five near-identical
 * questions about time at home while things that would have reordered the pilot's list went unasked (the owner, Nov
 * 2026). Now the app works out which topics are still unclear and would move the pilot's top 20 most, and the
 * interviewer writes the question for one of them. The test is the ranking itself: each of the pilot's priorities is
 * nudged the way an answer could move it — mattering half as much or half again as much, or with the point where it
 * starts to cost (or stops adding) set at the pack's middle — and the topic whose answer would move the most of their
 * top 20 comes first. Features the pilot never mentioned are tried both ways (hotel standby liked, or avoided), which is
 * how the Anchorage commuter's eight standby lines in his top 10 surface as the first thing to ask.
 *
 * Similar priorities are one topic — days off, a real break and the longest stretch at home are all "time at home" —
 * and each topic is asked once.
 */

export interface TopicCandidate {
  /** "home", "standby", … — what the interviewer sets `topic` to. */
  id: string;
  label: string;
  /** How many of the pilot's top 20 an answer could move (3 places or more, or out of the 20). */
  moves: number;
  /** The priorities it covers, by name; empty for a feature they never mentioned. */
  priorities: string[];
  /**
   * What an answer would settle: how much it matters against their other priorities (asked best as a real choice),
   * the number where it starts to cost or stops adding (their number), or how they feel about a feature (by name).
   */
  unclear: "weight" | "number" | "feature";
  /** A feature in their top lines they never mentioned, to ask about by name. */
  feature?: { metric: string; label: string };
  /** Ids of the examples (from the same turn's list) that show it. */
  exampleIds: string[];
}

/** One topic per kind of thing a pilot weighs, so similar priorities aren't asked about one after another. */
const TOPIC_LABELS: Record<string, string> = {
  trips: "Departures and trip length",
  home: "Time at home",
  commute: "Getting to and from work",
  night: "Night flying and hub turns",
  duty: "The work in a duty period",
  layovers: "Layovers and cities",
  pay: "Pay",
  standby: "Hotel standby",
  dates: "Days they need off",
};

const BY_CATEGORY: Record<MetricCategory, string> = { pay: "pay", time: "trips", commute: "commute", calendar: "home", duty: "duty", body: "night", layover: "layovers", city: "layovers", standby: "standby" };

const BY_METRIC: Record<string, string> = {
  tripCount: "trips",
  homeDepartures: "trips",
  departureCommutes: "trips",
  workDays: "trips",
  longestTripDays: "trips",
  avgTripDays: "trips",
  tafbHours: "trips",
  homeAwayHours: "trips",
  tripsShortenableByADay: "commute",
  shortenableHours: "commute",
  effectiveCreditPerDayAway: "pay",
  creditPerDayAwayFromHome: "pay",
  restHotelHubTurns: "night",
  dayHubTurns: "night",
  hubTurns: "night",
  weekdaysOff: "dates",
  requestedDatesWorked: "dates",
};

export function topicOf(metric: string): string {
  return BY_METRIC[metric] ?? BY_CATEGORY[METRICS_BY_ID.get(metric)?.category ?? "calendar"] ?? "home";
}

/** Features worth asking about by name when the pilot never mentioned them — the ones the ex-pilot said pilots differ on. */
const FEATURES = ["hotelStandbyDays", "nightHubTurnRuns", "restHotelHubTurns", "doubleDeadheadTrips", "dutiesWithManyLegs", "longDuties", "eatAndSleepLayovers", "earlyReports", "deIcingExposure"];

/** Features one of the fixed questions asks about by name (see `hub-turn-question.ts`), with how its question starts. */
const FEATURE_ASKED_BY: Record<string, string> = { nightHubTurnRuns: HUB_TURNS_LEAD, restHotelHubTurns: REST_HOTEL_LEAD };

/** A feature they never mentioned is tried at the weight a passing mention gets — not as if it were a top priority. */
const FEATURE_WEIGHT = 0.25;
/** How many of the top lines are compared. */
const TOP = 20;
/** A topic that moves fewer of the top 20 than this isn't worth a question. */
const MIN_MOVES = 3;
/** Places a line has to move to count as moved. */
const MOVED = 3;

function topLines(bidPack: BidPack, model: PilotModel, pm: PackMetrics): string[] {
  return scorePackV2(bidPack, model, { pack: pm })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.lineNumber);
}

/** How many of the base top 20 move 3 places or more, or drop out, under another ranking. */
function movedCount(base: string[], other: string[]): number {
  const at = new Map(other.map((n, i) => [n, i]));
  return base.slice(0, TOP).filter((n, i) => Math.abs((at.get(n) ?? Infinity) - i) >= MOVED).length;
}

/** A pack this small has too few lines to tell topics apart. */
const MIN_LINES = 8;

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/** The ways an answer could move one priority: weight halved or half again, or its anchor set at the pack's middle. */
function nudges(c: Criterion, values: number[]): Criterion[] {
  const out: Criterion[] = [
    { ...c, weight: c.weight * 0.5 },
    { ...c, weight: Math.min(1, c.weight * 1.5 + 0.1) },
  ];
  if (values.length >= 4) {
    const mid = quantile(values, 0.5);
    if (c.shape.kind === "less" && c.shape.fineAt === undefined) out.push({ ...c, shape: { ...c.shape, fineAt: mid } });
    if (c.shape.kind === "more" && c.shape.enoughAt === undefined) out.push({ ...c, shape: { ...c.shape, enoughAt: mid } });
  }
  return out;
}

const withCriterion = (model: PilotModel, c: Criterion): PilotModel => ({ ...model, criteria: model.criteria.some((x) => x.id === c.id) ? model.criteria.map((x) => (x.id === c.id ? c : x)) : [...model.criteria, c] });

/**
 * The topics worth asking now, most useful first: those not yet asked whose answer would move at least 3 of the
 * pilot's top 20. `asked` counts how often each topic has been asked (from the interview's threads, `topic:<id>`).
 * `examples` is the turn's list of lines and trips to show; examples for unmentioned features are added to it.
 */
/**
 * `answered`: the transcript's questions, for features a fixed question has already asked about. The hub-turn and
 * crew-rest hotel questions ask about night hub turns directly; answered "They don't bother me", no priority comes of
 * it, and without this they were asked again as a feature the pilot "never mentioned".
 */
export function pickTopics(
  bidPack: BidPack,
  model: PilotModel,
  pm: PackMetrics,
  asked: Record<string, number>,
  examples: QuestionExample[],
  limit = 3,
  answered: readonly { question: string }[] = []
): { topics: TopicCandidate[]; examples: QuestionExample[] } {
  const askedAlready = new Set(Object.entries(FEATURE_ASKED_BY).flatMap(([metric, lead]) => (answered.some((e) => e.question.startsWith(lead)) ? [metric] : [])));
  const base = topLines(bidPack, model, pm);
  if (base.length < MIN_LINES) return { topics: [], examples };
  const lineOf = new Map(bidPack.lines.map((l) => [l.lineNumber, l]));
  const valuesOf = (metric: string, params: Criterion["params"]) =>
    bidPack.lines.map((l) => measure(metric, l, pm, { ...homeParams(model), ...params })).filter((v): v is number => v !== null);

  const byTopic = new Map<string, TopicCandidate>();
  const consider = (t: TopicCandidate) => {
    const was = byTopic.get(t.id);
    if (!was || t.moves > was.moves) byTopic.set(t.id, was ? { ...t, priorities: [...new Set([...was.priorities, ...t.priorities])], exampleIds: [...new Set([...was.exampleIds, ...t.exampleIds])] } : t);
    else byTopic.set(t.id, { ...was, priorities: [...new Set([...was.priorities, ...t.priorities])], exampleIds: [...new Set([...was.exampleIds, ...t.exampleIds])] });
  };

  // Their priorities, nudged the ways an answer could move them.
  for (const c of model.criteria) {
    const id = topicOf(c.metric);
    if ((asked[id] ?? 0) > 0 || !METRICS_BY_ID.has(c.metric)) continue;
    // The first two nudges are its weight, any after them its number.
    const moved = nudges(c, valuesOf(c.metric, c.params)).map((n) => movedCount(base, topLines(bidPack, withCriterion(model, n), pm)));
    const moves = Math.max(0, ...moved);
    const unclear = moved.slice(2).some((m) => m === moves && m > Math.max(...moved.slice(0, 2))) ? "number" : "weight";
    consider({ id, label: TOPIC_LABELS[id] ?? id, moves, unclear, priorities: [c.label], exampleIds: examples.filter((e) => e.criterionId === c.id).map((e) => e.id) });
  }

  // Features they never mentioned, in a kind of thing they haven't talked about at all (one they have is asked about
  // in their own words), tried both ways at the weight a passing mention gets.
  const talkedAbout = new Set(model.criteria.map((c) => topicOf(c.metric)));
  const extra: QuestionExample[] = [];
  const features = new Map<string, TopicCandidate>();
  for (const metric of FEATURES) {
    const def = METRICS_BY_ID.get(metric);
    const id = topicOf(metric);
    // Deadheads from home and riding home only mean something to a commuter.
    if (!def || askedAlready.has(metric) || talkedAbout.has(id) || (asked[id] ?? 0) > 0 || (id === "commute" && model.home?.commuter !== true)) continue;
    const top = base.slice(0, 30).map((n) => ({ n, v: measure(metric, lineOf.get(n)!, pm, homeParams(model)) })).filter((x): x is { n: string; v: number } => x.v !== null);
    if (top.length < 4 || Math.max(...top.map((x) => x.v)) === Math.min(...top.map((x) => x.v))) continue;
    const trial = (kind: "more" | "less"): Criterion => ({ id: `feature:${metric}`, metric, label: def.label, shape: { kind }, tier: "medium", weight: FEATURE_WEIGHT, confidence: 0.6, evidence: [], status: "open" });
    const moves = Math.max(movedCount(base, topLines(bidPack, withCriterion(model, trial("more")), pm)), movedCount(base, topLines(bidPack, withCriterion(model, trial("less")), pm)));
    // Two of their top lines, one with the most of it and one with the least, to show by name.
    const most = top.reduce((a, b) => (b.v > a.v ? b : a));
    const least = top.reduce((a, b) => (b.v < a.v ? b : a));
    const shown = [most, least].map((x, i): QuestionExample => ({
      id: `F${extra.length + i + 1}`,
      kind: "line",
      ref: x.n,
      title: `Line ${x.n}`,
      fact: namedDomicile(formatValue(x.v, def), bidPack.base),
      priority: def.label,
      criterionId: `feature:${metric}`,
      summary: "",
      rank: base.indexOf(x.n) + 1,
    }));
    extra.push(...shown);
    // One feature per kind of thing: the one that would move their list most.
    if (moves > (features.get(id)?.moves ?? -1)) features.set(id, { id, label: TOPIC_LABELS[id] ?? id, moves, unclear: "feature", priorities: [], feature: { metric, label: def.label }, exampleIds: shown.map((e) => e.id) });
  }
  for (const t of features.values()) byTopic.set(t.id, t);

  const topics = [...byTopic.values()].filter((t) => t.moves >= MIN_MOVES).sort((a, b) => b.moves - a.moves).slice(0, limit);
  const keep = new Set(topics.flatMap((t) => t.exampleIds));
  return { topics, examples: [...examples, ...extra.filter((e) => keep.has(e.id))] };
}

/** How many times each topic has been asked, from the interview's threads (`topic:<id>`). */
export function askedTopics(threads: Record<string, { timesAsked: number }>): Record<string, number> {
  return Object.fromEntries(Object.entries(threads).filter(([k]) => k.startsWith("topic:")).map(([k, v]) => [k.slice(6), v.timesAsked]));
}

/** The thread key a topic is counted under. */
export const topicThread = (id: string) => `topic:${id}`;
