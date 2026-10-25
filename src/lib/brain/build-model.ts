import { METRICS_BY_ID, type MetricParams } from "@/lib/metrics/catalog";
import type { Region } from "@/lib/metrics/trip-facts";
import { TIER_WEIGHT, type Criterion, type CriterionShape, type CriterionTier, type PilotModel, type PilotThread } from "@/types/pilot-model";
import { structuredCall, type BrainUsage, type Effort } from "./llm";
import { modelToDepartures, modelToHomePay, modelToHubTurns } from "./model-upgrade";
import { applyPilotFacts, readPilotFacts, type PilotFacts } from "./pilot-facts";

/**
 * The pilot brain's core step: read everything a pilot has said — the
 * opening story and every answer since — and write their whole model from
 * it: what they care about, each bound to a real measurement with the shape
 * of how they value it, how much each matters next to the others, and what
 * the interview still needs to understand.
 *
 * It re-reads the whole interview every time rather than patching the last
 * model, so nothing they said early is forgotten or double-counted, and a
 * later answer can re-weigh an earlier one. The previous model is passed in
 * only so ids and settled criteria stay stable from turn to turn.
 */

/** Bumped whenever the prompt or schema changes, so cached evaluations of an older brain aren't mistaken for this one. */
export const BRAIN_PROMPT_VERSION = 21;

export interface InterviewExchange {
  /** 0 = the opening story. */
  turn: number;
  question: string;
  answer: string;
}

export interface BuildModelInput {
  /** From `buildPackBrief` — cached across calls. */
  packBrief: string;
  pilotContext: string;
  exchanges: InterviewExchange[];
  prior?: PilotModel | null;
  /** Anonymous patterns from other pilots in the same group (see `fleetNotes`), when there are enough of them. */
  fleetNotes?: string | null;
  effort?: Effort;
  apiKey?: string;
  model?: string;
}

const SYSTEM = `You are the "pilot brain" of a FedEx line-bidding assistant. Your job: understand one pilot deeply from their own words and write a precise, structured model of how they would rank the lines in their bid pack. Another program scores every line against your model, criterion by criterion, in real units — so the ranking is only as good as your model.

HOW TO BUILD THE MODEL

1. Read every word the pilot has said, start to finish. Speech-to-text dictation repeats phrases and garbles names ("Gojo"/"Juan Joe" = Guangzhou CAN, "Soul" = Seoul ICN, "dad has" = deadheads). Repetition is dictation, not emphasis — weigh emphasis by their words ("most", "really hard", "high priority", "ideal", "never", "fine", "OK", "not my favorite").

2. One criterion per distinct thing they care about that a bid pack can show. Bind each to the metric that measures it most directly AS THEY MEAN IT, with parameters (cities, legs threshold, hours window). Prefer the specific measurement over a proxy:
   - "avoid three-leg duties" → dutiesWithManyLegs {n:3}, not avgLegsPerDuty.
   - "minimize time in X" → layoverHoursInCities {cities:[X]}; "I love X layovers" → layoversInCities or layoverHoursInCities for those cities.
   - For a commuter, time-away-from-home measures (creditPerDayAwayFromHome, homeAwayHours, tripsJoinedFromHome, departureCommutes) beat paper ones (creditPerDayAway, tafbHours) whenever they talk about time away from HOME or commuting.
   - For a commuter, trips flown back to back without going home in between are one departure ("a series of trips", "a trip sequence"), and one pair of commutes. So bind "few trips / few departures / time at home between trips" to homeDepartures and "getting to and from base" to departureCommutes — tripCount and baseCommutesNeeded count every trip separately and are for a pilot who lives at base. This changes only what's counted: give them the points and anchors their words call for, as you would the trip count and commutes. Departures already use the hours at home they said make going home worth it (their commute answer) — don't add a criterion for that number. Trips joined straight from home on a deadhead (tripsJoinedFromHome) stay their own priority when they value them — less work and less stress than flying out of base, not only a commute saved.
   - Time at home, for a commuter, counted door to door: a day off spent commuting home, or getting in at dawn, isn't time at home, so calendar days off overstate it. "A real break", "days at home in a row", "only a couple of days home between trips", "nights in my own bed" → shortHomeGaps (less) for stays at home between departures too short to be a real break; realBreakNights (more) for real time off; nightsHome (more) for time at home overall; longestHomeStretch (more) rather than longestDaysOffBlock for one long stretch at home. params.n = the days or nights at home they say make a real break, only when they gave a number. These are the same concern as departures — fewer departures leave longer stretches — so bind homeDepartures for how often they leave home and these for how long they get at home between, and give these their points out of what that concern is worth to them, splitting it with homeDepartures, not out of their other priorities: pay, the flying and the rest weigh what their words say, however many measures time at home is spread over. daysOff, longestDaysOffBlock and singleDaysOff are calendar days: for a pilot who lives at base, or a commuter talking about calendar days as such (dates, weekends, a count of days off).
   - Hotel nights at base — the cost and hassle of a hotel at base, having to go in the night before an early show — → baseHotelNights (less). It's usually a light cost next to a whole extra departure; give it few points unless they dwell on it. A pilot with a crash pad at base has none (the PILOT line says).
   - Trip shortening by deviating on deadheads → shortenableHours / tripsShortenableByADay, with their buffers in params. Pay counted after shortening trips: for a commuter that is creditPerDayAwayFromHome — it already counts the deadheads they'd deviate onto from home, and the commute when they can't; effectiveCreditPerDayAway counts from base and leaves the commute out, so it's for a pilot who lives at base.
   - Backup flights on the commute, flights being full or scarce, getting stranded → fewestBackupFlights / tripsShortOnBackups (params.n = the backups they want); a stated minimum ("I need at least two backups") is a hardLimit. Long or awkward trips home after a trip → longestTripHome. These read real airline schedules for the pilot's best lines.
   - Specific dates they need off → requestedDatesWorked {dates:[...]} (real calendar dates in this bid period); a date they "need" or call "the one hard date" is a hardLimit {op:"max", value:0}.
   - Hotel standby: tripStandbyDays is standby at a layover city mid-trip; baseStandbyDays is standby sitting at base — a commuter who likes "hotel standby" on trips may feel very differently about days of standby at base. Bind to what they mean.
   - Finishing trips on a red-eye ("the 5 am red-eye home", "ending a trip with an all-nighter", "I'm worthless the first day home") → redEyeFinishes — it's the trip's last leg they mean, not every night of flying: a short night turn that's home by 00:30 isn't it.
   - Layovers they can't sleep on ("arrive at 6 am and leave at 8 pm is worthless", "I need the night in the hotel") → daytimeLayovers (less) — the count of those layovers; avgLayoverNightHours averages them away behind a few good ones.
   - "I'd rather be on a day schedule", "day turns", "afternoon sorts" → dayFlyingShare (more) — what they want more of, alongside whatever night measure fits what they want less of.
   - "Early sign-ins are fine" means early reports and early launches are not night work to them — don't bind nightsWorked or longestNightStreak to their night complaints unless they mean flying through the night.
   - All-nighters — duties that fly through the night — "two all-nighters in a row is my limit", "back to back all-nighters" → allNighterStreak (put their limit on this one) and backToBackRedEyes for how many. Don't put an all-nighter limit on longestNightStreak or nightsWorked: those count every night with any small-hours work, early launches included.
   - Hub turning — flying into a sort hub, sitting while the packages are sorted, then flying back out to an outstation ("hub turns", "night hub turning", "sitting in Indy through the sort") → the hub-turn measures, not the general night ones. A week or more of night hub turns ("four nights of hub turning", "two weeks of back-to-back night hub turns") → nightHubTurnRuns (less); a limit on nights in a row → longestHubTurnRun; the short airport hotel for a nap on long hub sits (crew-rest hotel) → restHotelHubTurns, the way they feel about it (some like the nap, some would rather have a shorter sit); long daytime sits at a hub → dayHubTurns. One hub turn now and then is fine for most pilots: bind hubTurns only for a pilot who minds hub turns as such.
   - Sleep, night flying in general, "the back side of the clock" → nightsWorked, longestNightStreak and deepNightHours, which count hotel standby that runs past midnight as night work too (a standby window to 02:30 keeps a pilot on a night schedule). redEyeLegs counts flying only. avgCircadianStars is a rough overall rating — never the only body-clock criterion for a pilot who talks about sleep.
   - A standing weekly commitment ("home Wednesday nights", "Saturdays are soccer") → weekdaysOff {weekdays:[...]}; weekends alone → weekendDaysOff.
   - A stated limit ("two in a row is my absolute limit", "nothing over 12 hours, period") is a hardLimit at that number, plus a shape that prefers staying well under it.
   - How they feel about layover cities → ONE graded cityScores list (−1 hates … +1 loves). An ordered list of favorites gets descending scores (e.g. 1.0, 0.9, 0.8 …, never below 0.3 for a city they called a favorite); "fine"/"OK" ≈ 0.2; "not my favorite" ≈ −0.3; "hard to avoid, but I minimize it" ≈ −0.5; "X sucks", "never" ≈ −1. A statement about a group ("I can't stand any of the cities in that country") goes on every city of that group in this pack — except where they said something more specific about one city ("that hub is hard to avoid; the less time there the better"), which sets that city's score instead. Use it in layoverValue — location and length together, the main layover criterion for any pilot with city feelings — and in standbyDaysByCity when they like standby. Don't also bind layoversInCities/layoverHoursInCities for the same feelings — not even when they talk about "stops" in a city they dislike as well as time there: a disliked city is already counted, hour by hour, in its grade, and a second criterion counts it twice.
   - "Longer layovers are better" → longLayoverHours (no ceiling), not avgLayoverHours.
   - "Single-leg duties", "two legs is nearly twice the work" → extraLegs; a strong dislike of 3+ leg duties → dutiesWithManyLegs {n:3} as well.
   - A layover in a commuter's home city is a night at home — when the pack has those, layoversInCities {cities: their home airports} is usually worth a criterion.
   One statement can need two criteria (a goal and its mechanism), but split the weight between them rather than counting it twice. Never bind two criteria that measure the same thing for the same reason.

3. Shape — how value changes, in the metric's REAL UNITS (use this pack's ranges to set anchors):
   - more {enoughAt?}: higher better; enoughAt where more stops mattering to them.
   - less {fineAt?, worstAt?}: lower better; fineAt = as good as it gets (e.g. 0 three-leg duties), worstAt = as bad as it gets.
   - target {ideal, tolerance}: a sweet spot (e.g. ~15 days off, ±2).
   - range {min?, max?}: anything inside is fine.
   - perOccurrence {costEach}: each occurrence costs a fixed share of this criterion's value (0.25 = four of them and it's gone).
   Leave anchors at -1 when they gave none and the pack range is the right scale. Never invent a ceiling or anchor (enoughAt, fineAt, worstAt) they didn't state or clearly imply — "longer is better, period" has no ceiling, and a made-up "up to 4" or "up to 36 hours" misstates them. One reading that does clearly imply a ceiling: days off "in a couple of big chunks instead of scattered singles" — set against single days off — is about having real blocks, not one ever-longer stretch: longestDaysOffBlock with enoughAt at the size they call a real block (5 when they gave none). "Big blocks of days off" with nothing set against it, and a commuter's blocks (fewer trips to base), are longer-is-better with no ceiling.
   Read anchor words for what they mean. "Starts to hurt / starts to bother me / that's where I notice it" at N is where value STARTS falling — fineAt (for less) — not where it's as bad as it gets. worstAt is only for "as bad as it gets", "too many", "I'd hardly bid it" at a number. Never set worstAt at or just past a "starts to hurt" number: every line past worstAt scores about the same, so 6 and 10 commutes would nearly tie. With only a "starts to hurt" number, set fineAt there and leave worstAt at -1 (the pack's range carries it from there).
   A trade statement is not an anchor: "I wouldn't go from 2 commutes to 6 just for more pay" says how two priorities trade, not that 6 is as bad as it gets — it's evidence for points, not for worstAt.
   A "Bid check" answer is the most direct anchor there is: "Lower — near the bottom" (or "Low") about a line whose weak spot is a value V says V is close to as bad as it gets for them — put worstAt at about V (never well below it), and raise the criterion's points if it had few. "About right" or "Yes" at V says V isn't that bad — don't put worstAt at or below V. "Trip grades" grade single trips, not lines (love / good / fine / poor / trade away): read the grades and especially the why for what they reveal — a reason they name is a priority (create the criterion if it's new, e.g. a night stuck at base after a late finish → baseHotelNights, time in a city they dislike → its grade in cityScores), or a detail of one's shape — but don't move a priority's points on trip grades alone: they're fitted separately, for how much each priority counts on a single trip.

4. Importance. Give each criterion "points" from a budget of 100 across ALL criteria, the way this pilot would actually trade: points measure how much a line's standing on that criterion should move it up or down their list. Be decisive — a pilot who names one thing as what they "most want to optimize" usually gives it 30–50 points, a couple of strong secondary goals 10–20 each, and tie-breakers 1–5. Spreading points evenly is wrong for almost every pilot. Use everything: explicit ranking words, "lifestyle over pay", how much they dwelt on it unprompted — in their story and in what they volunteered — and what they trade for what. Never read importance from how many questions the interview asked about something: the interviewer chooses what to ask, and answering a question about a topic is not emphasis on it. A detailed answer about a minor thing ("one short Guangzhou stop is fine, two is grumpy") pins down its shape, not its points. "Fine"/"OK" about something is near-neutral — usually no criterion at all. tier (must/high/medium/low) should agree with the points. confidence (0–1) is how sure you are the binding, shape and points are right; it should be low for anything inferred rather than said.

   When they correct a reading of their priorities ("should count more", "should count less"), move it decisively — at least half again more or less than before — and if they give a reason that points at a criterion ("too many departures"), raise that criterion too.
   Soft or conditional statements ("generally", "it depends", "I'd still take it if the rest of the trip were great") are low-weight preferences — never turn them into an "avoid X" criterion or a limit. When a pilot says lifestyle matters more than pay, the pay criterion's points must stay below the combined points of their lifestyle criteria, even if they call a pay number the one they'd optimize.

5. hardLimit only for things they say they will not bid (a dealbreaker) — never for strong preferences. The "Dealbreakers" question asks exactly this: each limit they give there with a number ("more than three commutes and I won't bid it", "nothing over 6 days") is a hardLimit on the criterion that measures it — create that criterion if there isn't one, with a shape that also prefers staying well under the limit. "Nothing rules a line out" means no hardLimits from that answer; "I'd rather not" or "it depends" is a preference, not a limit. Their Dealbreakers answer is their own list of what's absolute: when it says nothing else is ("nothing else is an absolute", "I can bend on the rest"), a number they give later for something else — even "I wouldn't go below about 77" or "I'd probably pass on 71" — is the bad end of its shape (worstAt), not a hardLimit, unless they then say outright they would never bid it ("that line is out", "I won't bid it"). Hedged numbers ("about", "probably", "give or take") are never limits. A "Bid check" asks whether a line near the top of their ranking belongs there, naming its weak spot: "Never" with that weak spot as the reason is a dealbreaker at about that value (a hardLimit just below it); "Low" or "Somewhere in the middle" means that weak spot counts for clearly more than the model had it; "Yes" means the model's trade-off was right.

6. home: airports they fly from (home first, then alternates they named), whether they commute, and any buffers they stated or clearly implied (hours at base before a report, hours before an operated leg when deviating, rest before deadheading home, minimum backup flights). Use -1 when unsaid.

UPDATING A PREVIOUS READING
When YOUR PREVIOUS READING is given, the interview has continued since you wrote it; the turns marked NEW are the ones you haven't read yet. Start from that reading and update it with what the new answers say. Keep every criterion's binding, parameters, shape, anchors, limit and points as they were unless something the pilot said — in a new turn, or an earlier one you now see differently — gives a concrete reason to change it. Don't re-derive what's settled from scratch, and don't let numbers drift: an answer about one thing is not a reason to re-weigh another. When a new answer does bear on something, change it decisively and say why in that criterion's reasoning, naming the turn.

7. threads: what the interview should explore next — the open questions whose answers would change their ranking the most. Each must come from something THEY said or from a real tension in THIS pack (e.g. "Sydney trips here also carry three-leg duties — which wins?"), never a generic checklist topic. priority 0–1 = how much the answer could reorder their top lines. Mark a thread settled once they have clearly answered it; do not reopen settled ground.

8. notMeasurable: things they care about that no metric here can see (hotel quality, specific dates, who they fly with) — kept and said back honestly, never forced onto a metric.

9. synopsis: 2–4 sentences on who this pilot is as a bidder, in plain words — what they optimize, what they avoid, what they trade — addressed to them ("You…").

Keep ids stable: if the previous model has a criterion for the same thing, reuse its id. Quote their own words as evidence, with dictation stutters and misheard words cleaned up so they'd recognize it as what they said.

FLEET NOTES, when given, are anonymous patterns from other pilots in the same group. Use them only to choose threads worth asking about and to calibrate an ambiguous reading (if pilots like this often said the brain over-weighted something, be careful not to). Never add a criterion this pilot didn't express, and never let the notes outweigh their own words.

The pilot reads labels, the synopsis and thread topics. Write them TO the pilot, in second person and plain words ("You'd rather sit hotel standby than fly multi-leg duties", "Pay per day away from home"), never "he/she/they" or "the pilot". Use their own words for things where you can, and pilot terms otherwise; never invented jargon. Thread topics are questions you would ask them directly.`;

/** Every metric is non-negative, so -1 marks "not given" — the API limits how many nullable fields a schema can have. */
const num = { type: "number", description: "-1 when not given" };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["synopsis", "home", "criteria", "threads", "notMeasurable"],
  properties: {
    synopsis: { type: "string" },
    home: {
      type: "object",
      additionalProperties: false,
      required: ["airports", "commuter", "commuteBufferHours", "frontBufferHours", "backRestHours", "backupFlights"],
      properties: {
        airports: { type: "array", items: { type: "string" } },
        commuter: { type: "string", enum: ["yes", "no", "unknown"] },
        commuteBufferHours: num,
        frontBufferHours: num,
        backRestHours: num,
        backupFlights: num,
      },
    },
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "metric", "params", "shape", "tier", "points", "confidence", "evidence", "hardLimit", "reasoning"],
        properties: {
          id: { type: "string", description: "Short camelCase id, stable across turns." },
          label: { type: "string", description: "In the pilot's terms, e.g. 'Avoid three-leg duties'." },
          metric: { type: "string" },
          params: {
            type: "object",
            additionalProperties: false,
            required: ["cities", "cityScores", "regions", "dates", "weekdays", "n", "minHours", "maxHours", "frontBufferHours", "backRestHours"],
            properties: {
              cities: { type: "array", items: { type: "string" }, description: "Airport codes; empty when not used." },
              cityScores: {
                type: "array",
                description: "Graded city feelings for layoverValue / standbyDaysByCity; empty when not used.",
                items: { type: "object", additionalProperties: false, required: ["city", "score"], properties: { city: { type: "string" }, score: { type: "number", description: "−1 hates … +1 loves" } } },
              },
              regions: { type: "array", items: { type: "string", enum: ["domestic", "alaska", "hawaii", "americas", "asia", "oceania", "europe", "middleEast", "africa"] }, description: "Empty when not used." },
              dates: { type: "array", items: { type: "string", format: "date" }, description: "Calendar dates (YYYY-MM-DD) inside the bid period; empty when not used." },
              weekdays: { type: "array", items: { type: "integer" }, description: "Days of the week, 1 = Monday … 7 = Sunday; empty when not used." },
              n: num,
              minHours: num,
              maxHours: num,
              frontBufferHours: num,
              backRestHours: num,
            },
          },
          shape: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "enoughAt", "fineAt", "worstAt", "ideal", "tolerance", "min", "max", "costEach"],
            properties: {
              kind: { type: "string", enum: ["more", "less", "target", "range", "perOccurrence"] },
              enoughAt: num,
              fineAt: num,
              worstAt: num,
              ideal: num,
              tolerance: num,
              min: num,
              max: num,
              costEach: num,
            },
          },
          tier: { type: "string", enum: ["must", "high", "medium", "low"] },
          points: { type: "number", description: "Share of the 100-point importance budget." },
          confidence: { type: "number" },
          evidence: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["quote", "turn"], properties: { quote: { type: "string" }, turn: { type: "integer" } } },
          },
          hardLimit: {
            type: "object",
            additionalProperties: false,
            required: ["op", "value"],
            properties: { op: { type: "string", enum: ["none", "max", "min"], description: "none unless it's a dealbreaker" }, value: { type: "number" } },
          },
          reasoning: { type: "string", description: "One line: why this metric, shape and weight." },
        },
      },
    },
    threads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "topic", "why", "priority", "status", "criteria"],
        properties: {
          id: { type: "string" },
          topic: { type: "string" },
          why: { type: "string" },
          priority: { type: "number" },
          status: { type: "string", enum: ["open", "settled", "parked"] },
          criteria: { type: "array", items: { type: "string" } },
        },
      },
    },
    notMeasurable: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["statement", "why"], properties: { statement: { type: "string" }, why: { type: "string" } } },
    },
  },
} as const;

type N = number | null;
interface RawCriterion {
  id: string;
  label: string;
  metric: string;
  params: { cities: string[]; cityScores: { city: string; score: number }[]; regions: Region[]; dates: string[]; weekdays: number[]; n: N; minHours: N; maxHours: N; frontBufferHours: N; backRestHours: N };
  shape: { kind: CriterionShape["kind"]; enoughAt: N; fineAt: N; worstAt: N; ideal: N; tolerance: N; min: N; max: N; costEach: N };
  tier: CriterionTier;
  points: number;
  confidence: number;
  evidence: { quote: string; turn: number }[];
  hardLimit: { op: "none" | "max" | "min"; value: number };
  reasoning: string;
}
interface RawModel {
  synopsis: string;
  home: { airports: string[]; commuter: "yes" | "no" | "unknown"; commuteBufferHours: N; frontBufferHours: N; backRestHours: N; backupFlights: N };
  criteria: RawCriterion[];
  threads: (Omit<PilotThread, "timesAsked">)[];
  notMeasurable: { statement: string; why: string }[];
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
/** Set, and not the schema's -1 "not given" mark. */
const def = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function toShape(s: RawCriterion["shape"]): CriterionShape | null {
  switch (s.kind) {
    case "more":
      return { kind: "more", ...(def(s.enoughAt) ? { enoughAt: s.enoughAt } : {}) };
    case "less":
      return { kind: "less", ...(def(s.fineAt) ? { fineAt: s.fineAt } : {}), ...(def(s.worstAt) ? { worstAt: s.worstAt } : {}) };
    case "target":
      return def(s.ideal) ? { kind: "target", ideal: s.ideal, tolerance: def(s.tolerance) && s.tolerance > 0 ? s.tolerance : Math.max(1, Math.abs(s.ideal) * 0.2) } : null;
    case "range":
      return def(s.min) || def(s.max) ? { kind: "range", ...(def(s.min) ? { min: s.min } : {}), ...(def(s.max) ? { max: s.max } : {}) } : null;
    case "perOccurrence":
      return { kind: "perOccurrence", costEach: def(s.costEach) && s.costEach > 0 ? Math.min(1, s.costEach) : 0.25 };
  }
}

function toParams(p: RawCriterion["params"], allowed: (keyof MetricParams)[]): MetricParams | undefined {
  const out: MetricParams = {};
  if (allowed.includes("cities") && p.cities?.length) out.cities = [...new Set(p.cities.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)))];
  if (allowed.includes("regions") && p.regions?.length) out.regions = p.regions;
  if (allowed.includes("cityScores") && p.cityScores?.length) {
    const scores: Record<string, number> = {};
    for (const { city, score } of p.cityScores) {
      const code = city.trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(code) && Number.isFinite(score)) scores[code] = Math.max(-1, Math.min(1, score));
    }
    if (Object.keys(scores).length) out.cityScores = scores;
  }
  if (allowed.includes("weekdays") && p.weekdays?.length) out.weekdays = [...new Set(p.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
  if (allowed.includes("dates") && p.dates?.length) out.dates = [...new Set(p.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (allowed.includes("n") && def(p.n) && p.n >= 1) out.n = Math.round(p.n);
  if (allowed.includes("minHours") && def(p.minHours)) out.minHours = p.minHours;
  if (allowed.includes("maxHours") && def(p.maxHours)) out.maxHours = p.maxHours;
  if (allowed.includes("frontBufferHours") && def(p.frontBufferHours)) out.frontBufferHours = p.frontBufferHours;
  if (allowed.includes("backRestHours") && def(p.backRestHours)) out.backRestHours = p.backRestHours;
  return Object.keys(out).length ? out : undefined;
}

/** Turn the model's answer into a valid PilotModel: unknown metrics, missing city lists and impossible shapes are dropped, numbers are clamped. */
export function parsePilotModel(raw: RawModel, prior?: PilotModel | null): { model: PilotModel; dropped: string[] } {
  const dropped: string[] = [];
  const seen = new Set<string>();
  const criteria: Criterion[] = [];
  // Weights are points relative to the top criterion's, so the strongest priority is always 1.
  const topPoints = Math.max(0, ...raw.criteria.map((r) => (Number.isFinite(r.points) ? r.points : 0)));
  for (const r of raw.criteria) {
    const metric = METRICS_BY_ID.get(r.metric);
    if (!metric) {
      dropped.push(`${r.id}: unknown metric ${r.metric}`);
      continue;
    }
    const params = toParams(r.params, metric.params ?? []);
    if (metric.params?.includes("cities") && !params?.cities?.length) {
      dropped.push(`${r.id}: ${r.metric} needs cities`);
      continue;
    }
    if (metric.params?.includes("cityScores") && !params?.cityScores) {
      dropped.push(`${r.id}: ${r.metric} needs cityScores`);
      continue;
    }
    if (metric.params?.includes("weekdays") && !params?.weekdays?.length) {
      dropped.push(`${r.id}: ${r.metric} needs weekdays`);
      continue;
    }
    if (metric.params?.includes("dates") && !params?.dates?.length) {
      dropped.push(`${r.id}: ${r.metric} needs dates`);
      continue;
    }
    if (metric.params?.includes("regions") && !metric.params.includes("cities") && !params?.regions?.length) {
      dropped.push(`${r.id}: ${r.metric} needs regions`);
      continue;
    }
    const shape = toShape(r.shape);
    if (!shape) {
      dropped.push(`${r.id}: unusable shape ${r.shape.kind}`);
      continue;
    }
    let id = r.id.replace(/[^A-Za-z0-9_-]/g, "") || r.metric;
    while (seen.has(id)) id += "_";
    seen.add(id);
    const weight = topPoints > 0 && r.points > 0 ? clamp01(r.points / topPoints) : TIER_WEIGHT[r.tier] * 0.1;
    criteria.push({
      id,
      metric: r.metric,
      ...(params ? { params } : {}),
      shape,
      tier: r.tier,
      weight,
      confidence: clamp01(r.confidence),
      label: r.label,
      evidence: r.evidence.map((e) => ({ quote: e.quote, turn: Math.max(0, Math.round(e.turn)) })),
      status: "settled",
      ...(r.hardLimit.op !== "none" && def(r.hardLimit.value) ? { hardLimit: { op: r.hardLimit.op, value: r.hardLimit.value } } : {}),
    });
  }
  const h = raw.home;
  const priorAsked = new Map((prior?.threads ?? []).map((t) => [t.id, t.timesAsked]));
  return {
    dropped,
    // A commuter's trip count and trip-end commutes mean departures, and their pay after shortening trips is pay from home,
    // whatever the reading bound them to.
    model: modelToHomePay(modelToHubTurns(modelToDepartures({
      version: 2,
      home: h.airports.length || h.commuter !== "unknown"
        ? {
            airports: [...new Set(h.airports.map((a) => a.trim().toUpperCase()).filter((a) => /^[A-Z]{3}$/.test(a)))],
            commuter: h.commuter === "yes",
            ...(def(h.commuteBufferHours) ? { commuteBufferHours: h.commuteBufferHours } : {}),
            ...(def(h.frontBufferHours) ? { frontBufferHours: h.frontBufferHours } : {}),
            ...(def(h.backRestHours) ? { backRestHours: h.backRestHours } : {}),
            ...(def(h.backupFlights) ? { backupFlights: Math.round(h.backupFlights) } : {}),
          }
        : null,
      criteria,
      threads: raw.threads.map((t) => ({ ...t, priority: clamp01(t.priority), criteria: t.criteria.filter((c) => seen.has(c)), timesAsked: priorAsked.get(t.id) ?? 0 })),
      notMeasurable: raw.notMeasurable,
      synopsis: raw.synopsis,
    }))),
  };
}

/** The interview as the brain reads it; turns its previous reading hadn't seen are marked NEW. */
function renderExchanges(exchanges: InterviewExchange[], readUpTo?: number): string {
  return exchanges
    .map((e, i) => {
      const fresh = readUpTo !== undefined && i >= readUpTo ? " — NEW" : "";
      return e.turn === 0 ? `[turn 0 — opening story${fresh}]\nQ: ${e.question}\nA: ${e.answer}` : `[turn ${e.turn}${fresh}]\nQ: ${e.question}\nA: ${e.answer}`;
    })
    .join("\n\n");
}

/** The brain's previous reading in full — bindings, shapes, anchors, limits and points — so the next one can build on it. */
function renderPrior(prior: PilotModel): string {
  const total = prior.criteria.reduce((s, c) => s + c.weight, 0) || 1;
  return JSON.stringify({
    home: prior.home,
    criteria: prior.criteria.map((c) => ({
      id: c.id,
      label: c.label,
      metric: c.metric,
      ...(c.params ? { params: c.params } : {}),
      shape: c.shape,
      tier: c.tier,
      points: Math.round((c.weight / total) * 100),
      confidence: +c.confidence.toFixed(2),
      ...(c.hardLimit ? { hardLimit: c.hardLimit } : {}),
      evidenceTurns: [...new Set(c.evidence.map((e) => e.turn))],
    })),
    threads: prior.threads.map((t) => ({ id: t.id, topic: t.topic, status: t.status, timesAsked: t.timesAsked })),
    notMeasurable: prior.notMeasurable.map((n) => n.statement),
  });
}

export interface BuildModelResult {
  model: PilotModel;
  /** Per-criterion one-line reasoning, for logs and the transparency page. */
  reasoning: Record<string, string>;
  dropped: string[];
  /** Both calls together: the brain's reading and the facts read beside it. */
  usage: BrainUsage;
  /** The facts read beside the brain (see `readPilotFacts`); null when that call failed — the reading stands without them. */
  facts: PilotFacts | null;
}

export async function buildPilotModel(input: BuildModelInput): Promise<BuildModelResult> {
  const fresh = [
    `PILOT: ${input.pilotContext}`,
    input.prior ? `YOUR PREVIOUS READING${input.prior.readUpTo ? ` (of turns 0–${input.prior.readUpTo - 1})` : ""} — update it, don't start over:\n${renderPrior(input.prior)}` : "",
    input.fleetNotes ? `FLEET NOTES — other pilots in the same group:\n${input.fleetNotes}` : "",
    `THE INTERVIEW SO FAR — everything the pilot has said:\n\n${renderExchanges(input.exchanges, input.prior?.readUpTo)}`,
    `Write the pilot's complete model now.`,
  ].filter(Boolean).join("\n\n");

  // The facts the brain's format has no room for, read beside it — never holding up or failing the reading itself.
  const [{ data, usage }, factsRead] = await Promise.all([
    structuredCall<RawModel>({
      apiKey: input.apiKey,
      model: input.model,
      system: SYSTEM,
      user: { cached: input.packBrief, fresh },
      schema: SCHEMA as unknown as Record<string, unknown>,
      effort: input.effort ?? "high",
    }),
    readPilotFacts({ pilotContext: input.pilotContext, exchanges: input.exchanges, apiKey: input.apiKey, model: input.model }).catch(() => null),
  ]);
  const parsed = parsePilotModel(data, input.prior);
  const read: PilotModel = { ...parsed.model, readUpTo: input.exchanges.length };
  const model = factsRead ? applyPilotFacts(read, factsRead.facts) : read;
  const dropped = parsed.dropped;
  const reasoning = Object.fromEntries(data.criteria.map((c) => [c.id, c.reasoning]));
  const both: BrainUsage = factsRead
    ? { ...usage, inputTokens: usage.inputTokens + factsRead.usage.inputTokens, outputTokens: usage.outputTokens + factsRead.usage.outputTokens, costUsd: usage.costUsd + factsRead.usage.costUsd, ms: Math.max(usage.ms, factsRead.usage.ms) }
    : usage;
  return { model, reasoning, dropped, usage: both, facts: factsRead?.facts ?? null };
}
