import type { DayPart } from "@/lib/metrics/catalog";
import type { PilotModel } from "@/types/pilot-model";

/**
 * A commuter counts the month in departures — each time they leave home to fly — not in trips: trips flown back to back
 * without going home are one departure, and one pair of commutes. Models built before the brain knew departures bound
 * those priorities to the trip count and to commutes counted at every trip's ends, which charge a chained trip as if
 * the pilot went home in between.
 *
 * Each such priority moves to the measure it meant — same id, label, shape, anchors, limit and weight, so nothing they
 * said is re-weighed; only what's counted changes. Commutes move for every pilot, whatever the reading made of where
 * they live: the trip-by-trip count was never right (a line read 10 commutes with 5 real), and the departure count is
 * none at all for a pilot who lives at base. The trip count moves only for a commuter — for a pilot who lives at base a
 * trip is a departure. When the departure count is already there, the two were one priority read twice: their weights
 * join on it. Safe to run on any model, any number of times.
 */
export const COMMUTER_MEASURES: Record<string, string> = {
  tripCount: "homeDepartures",
  baseCommutesNeeded: "departureCommutes",
};
/** Measures that move for every pilot, commuter or not. */
const ALWAYS_MOVED = new Set(["baseCommutesNeeded"]);

export function modelToDepartures(model: PilotModel): PilotModel;
export function modelToDepartures(model: PilotModel | null | undefined): PilotModel | null | undefined;
export function modelToDepartures(model: PilotModel | null | undefined): PilotModel | null | undefined {
  if (!model) return model;
  const moves = (metric: string) => metric in COMMUTER_MEASURES && (ALWAYS_MOVED.has(metric) || !!model.home?.commuter);
  if (!model.criteria.some((c) => moves(c.metric))) return model;
  let criteria = model.criteria.map((c) => (moves(c.metric) ? { ...c, metric: COMMUTER_MEASURES[c.metric] } : c));
  // The same measure twice, now: one priority read twice — its weights join on the first.
  for (const metric of new Set(Object.values(COMMUTER_MEASURES))) {
    const same = criteria.filter((c) => c.metric === metric && !c.params);
    if (same.length < 2) continue;
    const weight = Math.min(1, same.reduce((s, c) => s + c.weight, 0));
    criteria = criteria.filter((c) => !same.slice(1).includes(c)).map((c) => (c === same[0] ? { ...c, weight } : c));
  }
  return { ...model, criteria };
}

/**
 * What the interview's commute step learned that the brain's reading doesn't carry: whether the pilot keeps a crash pad
 * at base (nights there then cost nothing — see `baseHotelNights`), and how many hours at home make going home between
 * trips worth it (under that, the trips are one departure). The pilot's own answers win over anything already set.
 */
export function withHomeFacts(model: PilotModel, facts: { hasCrashPad?: boolean | null; minHomeHours?: number | null }): PilotModel {
  if (!model.home) return model;
  const home = { ...model.home };
  if (facts.hasCrashPad !== null && facts.hasCrashPad !== undefined) home.hasCrashPad = facts.hasCrashPad;
  if (facts.minHomeHours !== null && facts.minHomeHours !== undefined && facts.minHomeHours > 0) home.minHomeHours = facts.minHomeHours;
  return home.hasCrashPad === model.home.hasCrashPad && home.minHomeHours === model.home.minHomeHours ? model : { ...model, home };
}

/**
 * A commuter's pay "after shortening trips" is pay per day away from HOME: that measure already counts the deviated
 * deadheads they'd take from home, and the commute when they can't. Earlier brains bound it to
 * `effectiveCreditPerDayAway`, which shortens trips but counts time from base — it leaves the commute out, and ranked a
 * simulated commuter's lines far off his own (Oct 2026: 0.62 vs 0.77 with only that one measure swapped).
 *
 * The priority moves to `creditPerDayAwayFromHome` with its weight and parameters; its anchors were in from-base hours
 * per day, a different scale, so the shape restarts at "more is better" and a hard limit set on that scale is let go. When the model already weighs pay from home, the
 * two were the same priority read twice, and their weights join on the one measure. Only for a commuter whose home is
 * known — the home measure needs it.
 */
export function modelToHomePay(model: PilotModel): PilotModel;
export function modelToHomePay(model: PilotModel | null | undefined): PilotModel | null | undefined;
export function modelToHomePay(model: PilotModel | null | undefined): PilotModel | null | undefined {
  if (!model?.home?.commuter || !model.home.airports.length) return model;
  const moving = model.criteria.filter((c) => c.metric === "effectiveCreditPerDayAway");
  if (!moving.length) return model;
  const home = model.criteria.find((c) => c.metric === "creditPerDayAwayFromHome");
  if (home) {
    const weight = home.weight + moving.reduce((s, c) => s + c.weight, 0);
    return { ...model, criteria: model.criteria.filter((c) => !moving.includes(c)).map((c) => (c === home ? { ...c, weight } : c)) };
  }
  return { ...model, criteria: model.criteria.map((c) => (moving.includes(c) ? { ...c, metric: "creditPerDayAwayFromHome", shape: { kind: "more" }, hardLimit: undefined } : c)) };
}

/**
 * A priority about weeks of night hub turns that an earlier brain could only bind to the general night streak (the
 * ex-pilot's weeks of back-to-back night hub turning, read as `longestNightStreak`) moves to the hub-turn
 * measure it meant — recognized by its label or the pilot's own words naming hub turns. Same weight; the shape restarts
 * at "none is best", since the streak's anchors were in nights in a row. On his own sort (Oct 2026) the move took his
 * readings from 95.2% to 96.6%.
 */
export function modelToHubTurns(model: PilotModel): PilotModel;
export function modelToHubTurns(model: PilotModel | null | undefined): PilotModel | null | undefined;
export function modelToHubTurns(model: PilotModel | null | undefined): PilotModel | null | undefined {
  const aboutHubTurns = (c: PilotModel["criteria"][number]) => c.metric === "longestNightStreak" && [c.label, ...c.evidence.map((e) => e.quote)].some((t) => /hub[- ]?turn/i.test(t));
  if (!model || !model.criteria.some(aboutHubTurns) || model.criteria.some((c) => c.metric === "nightHubTurnRuns")) return model;
  return { ...model, criteria: model.criteria.map((c) => (aboutHubTurns(c) ? { ...c, metric: "nightHubTurnRuns", shape: { kind: "less", fineAt: 0 } } : c)) };
}

/**
 * The body clock was rated 1–5 stars; it's now a 1–100 score with far more behind it (`lib/body-clock-score.ts`) — night
 * work, nights in a row, early reports, time awake, layover sleep, day/night flips, time zones and recovery. A priority
 * on the old rating moves to the score it meant — the line's rating to `bodyClockScore`, the hardest trip's to
 * `hardestTripBodyClock` — with its weight, label and words, and any number the pilot gave carried across the scale
 * (1★ → 1, 3★ → 50.5, 5★ → 100; a tolerance by the same stretch). Safe to run on any model, any number of times.
 */
export const STAR_MEASURES: Record<string, string> = {
  avgCircadianStars: "bodyClockScore",
  worstCircadianStars: "hardestTripBodyClock",
};
const starToScore = (s: number) => Math.min(100, Math.max(1, 1 + ((s - 1) * 99) / 4));

export function modelToBodyClock(model: PilotModel): PilotModel;
export function modelToBodyClock(model: PilotModel | null | undefined): PilotModel | null | undefined;
export function modelToBodyClock(model: PilotModel | null | undefined): PilotModel | null | undefined {
  if (!model?.criteria.some((c) => c.metric in STAR_MEASURES)) return model;
  const shapeOf = (shape: PilotModel["criteria"][number]["shape"]): PilotModel["criteria"][number]["shape"] => {
    switch (shape.kind) {
      case "more":
        return shape.enoughAt === undefined ? shape : { ...shape, enoughAt: starToScore(shape.enoughAt) };
      case "less":
        return { kind: "less", ...(shape.fineAt !== undefined ? { fineAt: starToScore(shape.fineAt) } : {}), ...(shape.worstAt !== undefined ? { worstAt: starToScore(shape.worstAt) } : {}) };
      case "target":
        return { kind: "target", ideal: starToScore(shape.ideal), tolerance: (shape.tolerance * 99) / 4 };
      case "range":
        return { kind: "range", ...(shape.min !== undefined ? { min: starToScore(shape.min) } : {}), ...(shape.max !== undefined ? { max: starToScore(shape.max) } : {}) };
      case "perOccurrence":
        return shape;
    }
  };
  return {
    ...model,
    criteria: model.criteria.map((c) =>
      c.metric in STAR_MEASURES
        ? { ...c, metric: STAR_MEASURES[c.metric], shape: shapeOf(c.shape), ...(c.hardLimit ? { hardLimit: { ...c.hardLimit, value: starToScore(c.hardLimit.value) } } : {}) }
        : c
    ),
  };
}

/** "Trips you can join from home": an earlier brain's made-up phrase (see `AVOIDED` in pilot-words.ts). Pilots catch a deadhead. */
const JOIN_FROM = /\b(you can|you could|that you can|to) (actually |easily )?join (straight |right )?from\b/gi;

/**
 * The words an earlier brain wrote into a saved model — its summary and its priorities' names — in a pilot's terms
 * ("deadheads you can catch from home", not "join from home"). The ex-pilot pointed out the made-up phrase (Oct 2026);
 * the brain no longer writes it, but models saved before then still showed it. The pilot's own quoted words are left as
 * they said them.
 */
export function modelInPilotWords(model: PilotModel): PilotModel;
export function modelInPilotWords(model: PilotModel | null | undefined): PilotModel | null | undefined;
export function modelInPilotWords(model: PilotModel | null | undefined): PilotModel | null | undefined {
  if (!model) return model;
  const fix = (s: string) => s.replace(JOIN_FROM, (_, lead: string, adv: string | undefined, how: string | undefined) => `${lead} ${adv ?? ""}catch ${how ?? ""}from`);
  const synopsis = model.synopsis ? fix(model.synopsis) : model.synopsis;
  const changed = synopsis !== model.synopsis || model.criteria.some((c) => fix(c.label) !== c.label);
  if (!changed) return model;
  return { ...model, synopsis, criteria: model.criteria.map((c) => ({ ...c, label: fix(c.label) })) };
}

/** A pilot judging a layover by a whole free day in the city: "a full day in a decent layover city", "the whole day to explore". */
const FULL_DAY_WORDS = /\b(full|whole|entire) days?\b|\ball day to (explore|see|walk|eat)/i;
/**
 * Of the points a pilot's city feelings carry, the share that goes to full days there (`fullDaysInLikedCities`) when
 * they judge layovers that way; the rest stays on hours in the city (`layoverValue`). One set of feelings, counted
 * once, read two ways. The ex-pilot's 20 readings (Oct 2026), lines only / with his trip picks / trip picks right:
 * hours only 98.20% / 97.82% / 100 of 100; 10% 98.49 / 98.20 / 100; 15% 98.49 / 98.27 / 100; 20% 98.45 / 98.27 / 97;
 * full days only 94.58 / 95.18 / 80. A full day is a plus, not the whole of it: he took a trip with no full day over
 * one with "just barely one" in a city he loves, for the commute it saved.
 */
export const FULL_DAY_SHARE = 0.15;

/**
 * A pilot who talks about full days in the cities they like ("a full day in a decent layover city … quite a bit more
 * appealing") gets them counted: their city priority shares its weight with full days in those cities
 * (`FULL_DAY_SHARE`), with the same city grades. A model with both already is set to that share; full days with no
 * hours priority gain one. `pilotSaid` is the pilot's own answers. Safe to run on any model, any number of times.
 */
export function modelToFullDays(model: PilotModel, pilotSaid: string[]): PilotModel;
export function modelToFullDays(model: PilotModel | null | undefined, pilotSaid: string[]): PilotModel | null | undefined;
export function modelToFullDays(model: PilotModel | null | undefined, pilotSaid: string[]): PilotModel | null | undefined {
  if (!model) return model;
  const hours = model.criteria.find((c) => c.metric === "layoverValue");
  const days = model.criteria.find((c) => c.metric === "fullDaysInLikedCities");
  if (!days && (!hours || !pilotSaid.some((t) => FULL_DAY_WORDS.test(t)))) return model;
  const total = (hours?.weight ?? 0) + (days?.weight ?? 0);
  const cityScores = { ...days?.params?.cityScores, ...hours?.params?.cityScores };
  const base = (hours ?? days)!;
  const asHours = { ...base, ...(hours ?? { id: `${base.id}-hours`, label: "Time in cities you like" }), metric: "layoverValue", params: { ...hours?.params, cityScores }, weight: total * (1 - FULL_DAY_SHARE) };
  const asDays = {
    ...base,
    ...(days ?? { id: `${base.id}-full-days`, label: "Full days in cities you like", shape: { kind: "more" as const } }),
    metric: "fullDaysInLikedCities",
    params: { ...days?.params, cityScores },
    weight: total * FULL_DAY_SHARE,
  };
  delete (asDays as { hardLimit?: unknown }).hardLimit;
  // The hours priority keeps its place (or takes the full days' place, when there was none).
  const criteria = model.criteria.flatMap((c) => (c === (hours ?? days) ? [asHours] : c === days ? [] : [c]));
  // Full days sit right after the hours priority they share with.
  const at = criteria.indexOf(asHours);
  return { ...model, criteria: [...criteria.slice(0, at + 1), asDays, ...criteria.slice(at + 1)] };
}

const WEEKDAY_WORDS: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
const PART_WORDS: Record<string, DayPart> = { morning: "morning", afternoon: "afternoon", evening: "evening", night: "night" };

/**
 * Which part of a chosen weekday a pilot means, from their own words: "home on Wednesday nights and Sunday mornings"
 * is a Wednesday night and a Sunday morning, not two whole days. The brain binds the weekdays (3, 7); the part rides in
 * the words it quotes for them, so it's read from those — the evidence and the label — for every saved model too. A
 * weekday named without a part is the whole day. Safe to run on any model, any number of times.
 */
export function modelToWeekdayParts(model: PilotModel): PilotModel;
export function modelToWeekdayParts(model: PilotModel | null | undefined): PilotModel | null | undefined;
export function modelToWeekdayParts(model: PilotModel | null | undefined): PilotModel | null | undefined {
  if (!model || !model.criteria.some((c) => c.metric === "weekdaysOff")) return model;
  return {
    ...model,
    criteria: model.criteria.map((c) => {
      if (c.metric !== "weekdaysOff" || !c.params?.weekdays?.length) return c;
      const parts = weekdayPartsIn([c.label, ...c.evidence.map((e) => e.quote)].join(" "), c.params.weekdays);
      const params = { ...c.params };
      if (Object.keys(parts).length) params.weekdayParts = parts;
      else delete params.weekdayParts;
      return { ...c, params };
    }),
  };
}

/** "Wednesday nights and Sunday mornings" → { 3: "night", 7: "morning" }, for the weekdays given. */
export function weekdayPartsIn(text: string, weekdays: number[]): Record<string, DayPart> {
  const parts: Record<string, DayPart> = {};
  for (const m of text.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s+(morning|afternoon|evening|night)s?\b/gi)) {
    const day = WEEKDAY_WORDS[m[1].toLowerCase()];
    if (weekdays.includes(day)) parts[String(day)] ??= PART_WORDS[m[2].toLowerCase()];
  }
  return parts;
}
