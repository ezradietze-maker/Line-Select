import { METRICS_BY_ID, type MetricDef, type MetricParams } from "@/lib/metrics/catalog";
import { criterionWeight } from "@/lib/scoring-v2/score";
import type { Criterion, CriterionShape, PilotModel } from "@/types/pilot-model";

/**
 * The pilot model said back in plain words — what the pilot will read to
 * check that we heard them right: each priority, how much it moves their
 * ranking, how it's measured on their pack, and the words it came from.
 */

const clock = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const SINGULAR: Record<string, string> = { duties: "duty", hours: "hour", days: "day", trips: "trip", legs: "leg", layovers: "layover", commutes: "commute", landings: "landing", nights: "night", flights: "flight", departures: "departure", "hub turns": "hub turn", gaps: "gap" };

/**
 * How a value of each measure reads on its own, "{n}" standing for the number: "{n} extra legs", not "3 legs" — so it
 * can sit beside a priority written as a wish ("Prefer single-leg duties") without the pair turning into nonsense
 * ("Prefer single-leg duties: 0 legs"). One form, or [one, many], or [one, many, none] where "no …" would read badly
 * ("no layovers with no real night"); otherwise a count of none reads "no …". Measures not listed
 * read by their unit. Each reads as something a line has ("it has a 04:30 show at base"), so it fits any sentence.
 */
const READS: Record<string, string | [string, string] | [string, string, string]> = {
  creditHours: "{n} credit hours",
  tafbHours: "{n} hours TAFB",
  blockHours: "{n} block hours",
  shortenableHours: "{n} hours the trips can be shortened",
  tripsShortenableByADay: ["{n} trip you can shorten by a day", "{n} trips you can shorten by a day"],
  homeAwayHours: "{n} hours away from home",
  tripsJoinedFromHome: ["{n} trip with a front-end deadhead from home", "{n} trips with a front-end deadhead from home"],
  tripsEndingStraightHome: ["{n} trip you can deviate home from", "{n} trips you can deviate home from"],
  fewestBackupFlights: ["{n} backup flight on the tightest trip", "{n} backup flights on the tightest trip"],
  tripsShortOnBackups: ["{n} trip short on backup flights", "{n} trips short on backup flights"],
  longestTripHome: "up to {n} hours to get home",
  daysOff: ["{n} day off", "{n} days off"],
  longestDaysOffBlock: ["{n} day off in a row", "{n} days off in a row"],
  singleDaysOff: ["{n} single day off", "{n} single days off"],
  requestedDatesWorked: ["{n} of your dates worked", "{n} of your dates worked", "none of your dates worked"],
  weekdaysOff: ["{n} of your chosen days off", "{n} of your chosen days off", "none of your chosen days off"],
  weekendDaysOff: ["{n} weekend day off", "{n} weekend days off"],
  shortHomeGaps: ["{n} short stay at home", "{n} short stays at home"],
  realBreakNights: ["{n} night at home in real breaks", "{n} nights at home in real breaks"],
  nightsHome: ["{n} night in your own bed", "{n} nights in your own bed"],
  longestHomeStretch: ["{n} night at home in a row", "{n} nights at home in a row"],
  baseHotelNights: ["{n} night at base", "{n} nights at base"],
  avgTripDays: "{n} days a trip on average",
  longestTripDays: "a {n}-day longest trip",
  dutyPeriods: ["{n} duty period", "{n} duty periods"],
  dutiesWithManyLegs: ["{n} duty with many legs", "{n} duties with many legs"],
  extraLegs: ["{n} extra leg", "{n} extra legs"],
  maxLegsInADuty: "up to {n} legs in a duty",
  singleLegDutyShare: "{n} of duties single-leg",
  avgLegsPerDuty: ["{n} leg per duty", "{n} legs per duty"],
  longDuties: ["{n} long duty day", "{n} long duty days"],
  maxDutyHours: "a {n}-hour longest duty",
  frontDeadheadTrips: ["{n} trip with a front-end deadhead", "{n} trips with a front-end deadhead"],
  backDeadheadTrips: ["{n} trip with a back-end deadhead", "{n} trips with a back-end deadhead"],
  doubleDeadheadTrips: ["{n} double-deadhead trip", "{n} double-deadhead trips"],
  midTripDeadheads: ["{n} mid-trip deadhead", "{n} mid-trip deadheads"],
  frontSlackHours: "{n} hours between the front-end deadhead and the flying",
  backSlackHours: "{n} hours between the last flight and the deadhead home",
  earliestBaseReport: "a {n} show at base",
  latestBaseRelease: "a {n} release back at base",
  avgLayoverHours: "{n}-hour layovers on average",
  layoversInRange: ["{n} layover in that range", "{n} layovers in that range"],
  shortLayovers: ["{n} short layover", "{n} short layovers"],
  sleepableLayovers: ["{n} layover you can sleep on", "{n} layovers you can sleep on"],
  daytimeLayovers: ["{n} layover with no real night", "{n} layovers with no real night", "a real night on every layover"],
  avgLayoverNightHours: "{n} night hours a layover",
  internationalLayoverShare: "{n} of layovers international",
  layoverHoursInCities: "{n} hours on layover in those cities",
  layoversInCities: ["{n} layover in those cities", "{n} layovers in those cities"],
  longLayoverHours: "{n} hours on long layovers",
  tripsTouchingCities: ["{n} trip through those cities", "{n} trips through those cities"],
  layoverShareInRegions: "{n} of layovers in those regions",
  worstCircadianStars: "{n} on the hardest trip",
  avgCircadianStars: "{n} on the body clock",
  redEyeLegs: ["{n} red-eye leg", "{n} red-eye legs"],
  nightsWorked: ["{n} night worked", "{n} nights worked"],
  nightHubTurnRuns: ["{n} night hub turn in a run of 3+ nights", "{n} night hub turns in runs of 3+ nights", "no weeks of night hub turns"],
  longestHubTurnRun: ["night hub turns one at a time", "{n} night hub turns in a row", "no night hub turns"],
  nightHubTurns: ["{n} night hub turn", "{n} night hub turns"],
  restHotelHubTurns: ["{n} hub turn with a crew-rest hotel", "{n} hub turns with a crew-rest hotel"],
  dayHubTurns: ["{n} day hub turn", "{n} day hub turns"],
  longestNightStreak: ["nights worked one at a time", "{n} nights worked in a row", "no nights worked"],
  deepNightHours: "{n} hours worked in the small hours",
  dayFlyingShare: "{n} of the flying in daytime",
  redEyeFinishes: ["{n} trip ending on a red-eye", "{n} trips ending on a red-eye"],
  allNighterStreak: ["all-nighters one at a time", "{n} all-nighters in a row", "no all-nighters"],
  backToBackRedEyes: ["{n} back-to-back red-eye duty", "{n} back-to-back red-eye duties"],
  timezoneHoursCrossed: "{n} hours of time zones crossed",
  earlyReports: ["{n} early report", "{n} early reports"],
  hotelStandbyDays: ["{n} hotel standby day", "{n} hotel standby days"],
  tripStandbyDays: ["{n} standby day on trips", "{n} standby days on trips"],
  standbyDaysByCity: ["{n} standby day", "{n} standby days"],
  baseStandbyDays: ["{n} standby day at base", "{n} standby days at base"],
};

/** On one trip, where the line's words talk about its trips ("a 6-day longest trip", "on the hardest trip"). */
const ONE_TRIP_READS: Record<string, string | [string, string]> = {
  longestTripDays: ["{n} day", "{n} days"],
  avgTripDays: ["{n} day", "{n} days"],
  worstCircadianStars: "{n} on the body clock",
  fewestBackupFlights: ["{n} backup flight", "{n} backup flights"],
  earliestBaseReport: "shows at base at {n}",
  latestBaseRelease: "back at base at {n}",
};

/** A spread of the measures whose words don't start with the number ("a 6-day longest trip"), said as a spread. */
const RANGE_READS: Record<string, string> = {
  longestTripHome: "{n} hours to get home",
  longestTripDays: "longest trips of {n} days",
  maxLegsInADuty: "{n} legs at most in a duty",
  maxDutyHours: "longest duties of {n} hours",
  earliestBaseReport: "earliest shows at base from {n}",
  latestBaseRelease: "latest releases back at base from {n}",
};

/** Units whose zero is a number, not "none". */
const MEASURED_UNITS = new Set(["hours", "hours/day", "share", "minute of day", "weighted hours"]);

type ValueDef = Pick<MetricDef, "unit"> & { id?: string };

/** Just the number, in its unit's format: "4.3★", "50%", "02:30", "6.5". */
function numberOf(value: number, def: Pick<MetricDef, "unit">): string {
  if (def.unit === "minute of day") return clock(value);
  if (def.unit === "share") return `${Math.round(value * 100)}%`;
  if (def.unit.startsWith("stars")) return `${round(value)}★`;
  return round(value);
}

/** The value's words: its measure's own (`READS`), else its unit's. */
function readsOf(def: ValueDef, oneTrip = false): [string, string, string?] {
  const own = def.id ? ((oneTrip ? ONE_TRIP_READS[def.id] : undefined) ?? READS[def.id]) : undefined;
  if (own) return typeof own === "string" ? [own, own] : own;
  if (def.unit === "hours/day") return ["{n} credit hrs/day", "{n} credit hrs/day"];
  if (def.unit === "minute of day" || def.unit === "share" || def.unit.startsWith("stars")) return ["{n}", "{n}"];
  return [`{n} ${SINGULAR[def.unit] ?? def.unit}`, `{n} ${def.unit}`];
}

/**
 * A value the way a pilot reads it, on its own: "3 extra legs", "no early reports", "4.3★ on the body clock". `oneTrip`:
 * the value is one trip's own, not a line's.
 */
export function formatValue(value: number, def: ValueDef, oneTrip = false): string {
  if (def.unit === "weighted hours")
    return value >= 0 ? `${Math.round(value)} hours in cities you like` : `${Math.round(-value)} hours more in cities you avoid than in ones you like`;
  const [one, many, none] = readsOf(def, oneTrip);
  if (value === 0 && !MEASURED_UNITS.has(def.unit)) return none ?? many.replace("{n}", "no");
  const text = (value === 1 ? one : many).replace("{n}", numberOf(value, def));
  // A measure with one form says "1 hours": make it "1 hour".
  return withArticle(value === 1 ? text.replace(/\b1 ((?:night|block|credit) )?(hours|days|legs|nights)\b/, (_, kind: string | undefined, w: string) => `1 ${kind ?? ""}${w.slice(0, -1)}`) : text);
}

/** "a 8-day trip" → "an 8-day trip": numbers said with a vowel sound (8, 11, 18, 80s). */
function withArticle(text: string): string {
  return text.replace(/\ba (?=(?:8|11|18)(?:[^\d.]|$)|8\d)/g, "an ");
}

/** A spread of values, said once: "0 to 3 extra legs", "2★ to 4.3★ on the body clock", "4.9 to 9.5 credit hrs/day". */
export function formatRange(lo: number, hi: number, def: ValueDef): string {
  if (lo === hi || def.unit === "weighted hours") return lo === hi ? formatValue(lo, def) : `${formatValue(lo, def)} to ${formatValue(hi, def)}`;
  const spread = `${numberOf(lo, def)} to ${numberOf(hi, def)}`;
  return withArticle(((def.id && RANGE_READS[def.id]) ?? readsOf(def)[1]).replace("{n}", spread));
}

/** A bare amount in the measure's unit, for a tolerance or a step: "2 days", "1.5 hours". */
function amountOf(value: number, def: Pick<MetricDef, "unit">): string {
  if (def.unit === "share" || def.unit === "minute of day" || def.unit.startsWith("stars") || def.unit === "weighted hours") return numberOf(value, def);
  if (def.unit === "hours/day") return `${round(value)} credit hrs/day`;
  return `${round(value)} ${value === 1 ? (SINGULAR[def.unit] ?? def.unit) : def.unit}`;
}

function describeParams(p: MetricParams | undefined): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.cities?.length) parts.push(p.cities.join(", "));
  if (p.cityScores) {
    const sorted = Object.entries(p.cityScores).sort((a, b) => b[1] - a[1]);
    const liked = sorted.filter(([, v]) => v > 0).map(([c]) => c);
    const avoided = sorted.filter(([, v]) => v < 0).reverse().map(([c]) => c);
    if (liked.length) parts.push(`best: ${liked.join(", ")}`);
    if (avoided.length) parts.push(`worst: ${avoided.join(", ")}`);
  }
  if (p.regions?.length) parts.push(p.regions.join(", "));
  if (p.dates?.length) parts.push(p.dates.join(", "));
  if (p.weekdays?.length) parts.push(p.weekdays.map((d) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d - 1]).join(", "));
  if (p.n !== undefined) parts.push(`${p.n}+ legs`);
  if (p.minHours !== undefined || p.maxHours !== undefined) parts.push(`${p.minHours ?? 0}–${p.maxHours ?? "∞"} h`);
  if (p.frontBufferHours !== undefined) parts.push(`${p.frontBufferHours} h before flying`);
  if (p.backRestHours !== undefined) parts.push(`${p.backRestHours} h rest before heading home`);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

export function describeShape(shape: CriterionShape, def: ValueDef): string {
  const v = (n: number) => formatValue(n, def);
  const ideal = (n: number) => (n === 0 && !MEASURED_UNITS.has(def.unit) ? "none" : v(n));
  switch (shape.kind) {
    case "more":
      return shape.enoughAt !== undefined ? `More is better, up to ${v(shape.enoughAt)}` : "More is better";
    case "less":
      if (shape.fineAt !== undefined && shape.worstAt !== undefined) return `Less is better: ${ideal(shape.fineAt)} is ideal, ${v(shape.worstAt)} or more is as bad as it gets`;
      if (shape.fineAt !== undefined) return `Less is better: ${ideal(shape.fineAt)} is ideal`;
      return "Less is better";
    case "target":
      return `Best around ${v(shape.ideal)} (give or take ${amountOf(shape.tolerance, def)})`;
    case "range":
      if (shape.min !== undefined && shape.max !== undefined) return `Anything from ${v(shape.min)} to ${v(shape.max)} is fine`;
      return shape.min !== undefined ? `At least ${v(shape.min)}` : `No more than ${v(shape.max!)}`;
    case "perOccurrence":
      return `Each one costs about ${Math.round(shape.costEach * 100)}% of this priority`;
  }
}

export interface DescribedCriterion {
  id: string;
  label: string;
  /** Share of the ranking this priority drives, 0–100. */
  influence: number;
  tier: Criterion["tier"];
  measuredAs: string;
  shape: string;
  dealbreaker: string | null;
  quotes: string[];
  confidence: number;
}

export function describeModel(model: PilotModel): DescribedCriterion[] {
  const known = model.criteria.filter((c) => METRICS_BY_ID.has(c.metric));
  const total = known.reduce((a, c) => a + criterionWeight(c), 0) || 1;
  return known
    .map((c) => {
      const def = METRICS_BY_ID.get(c.metric)!;
      return {
        id: c.id,
        label: c.label,
        influence: Math.round((criterionWeight(c) / total) * 1000) / 10,
        tier: c.tier,
        measuredAs: `${def.label}${describeParams(c.params)}`,
        shape: describeShape(c.shape, def),
        dealbreaker: c.hardLimit
          ? c.hardLimit.op === "max" && c.hardLimit.value === 0
            ? "Dealbreaker: any at all rules a line out"
            : `Dealbreaker: ${c.hardLimit.op === "max" ? "more than" : "fewer than"} ${formatValue(c.hardLimit.value, def)} rules a line out`
          : null,
        quotes: c.evidence.map((e) => e.quote),
        confidence: c.confidence,
      };
    })
    .sort((a, b) => b.influence - a.influence);
}
