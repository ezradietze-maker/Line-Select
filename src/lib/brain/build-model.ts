import { METRICS_BY_ID, type MetricParams } from "@/lib/metrics/catalog";
import type { Region } from "@/lib/metrics/trip-facts";
import { TIER_WEIGHT, type Criterion, type CriterionShape, type CriterionTier, type PilotModel, type PilotThread } from "@/types/pilot-model";
import { structuredCall, type BrainUsage, type Effort } from "./llm";

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
export const BRAIN_PROMPT_VERSION = 6;

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
   - For a commuter, time-away-from-home measures (creditPerDayAwayFromHome, homeAwayHours, tripsJoinedFromHome, baseCommutesNeeded) beat paper ones (creditPerDayAway, tafbHours) whenever they talk about time away from HOME or commuting.
   - Trip shortening by deviating on deadheads → effectiveCreditPerDayAway / shortenableHours / tripsShortenableByADay, with their buffers in params.
   - Specific dates they need off → requestedDatesWorked {dates:[...]} (real calendar dates in this bid period); a date they "need" or call "the one hard date" is a hardLimit {op:"max", value:0}.
   - Hotel standby: tripStandbyDays is standby at a layover city mid-trip; baseStandbyDays is standby sitting at base — a commuter who likes "hotel standby" on trips may feel very differently about days of standby at base. Bind to what they mean.
   - Sleep, night flying, "all-nighters", "the back side of the clock" → nightsWorked, longestNightStreak and deepNightHours, which count hotel standby that runs past midnight as night work too (a standby window to 02:30 keeps a pilot on a night schedule). redEyeLegs counts flying only. avgCircadianStars is a rough overall rating — never the only body-clock criterion for a pilot who talks about sleep.
   - A standing weekly commitment ("home Wednesday nights", "Saturdays are soccer") → weekdaysOff {weekdays:[...]}; weekends alone → weekendDaysOff.
   - A stated limit ("two in a row is my absolute limit", "nothing over 12 hours, period") is a hardLimit at that number, plus a shape that prefers staying well under it.
   - How they feel about layover cities → ONE graded cityScores list (−1 hates … +1 loves). An ordered list of favorites gets descending scores (e.g. 1.0, 0.9, 0.8 …, never below 0.3 for a city they called a favorite); "fine"/"OK" ≈ 0.2; "not my favorite" ≈ −0.3; "hard to avoid, but I minimize it" ≈ −0.5; "X sucks", "never" ≈ −1. A statement about a group ("I can't stand any of the cities in that country") goes on every city of that group in this pack — except where they said something more specific about one city ("that hub is hard to avoid; the less time there the better"), which sets that city's score instead. Use it in layoverValue — location and length together, the main layover criterion for any pilot with city feelings — and in standbyDaysByCity when they like standby. Don't also bind layoversInCities/layoverHoursInCities for the same feelings.
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
   Leave anchors at -1 when they gave none and the pack range is the right scale. Never invent a ceiling or anchor (enoughAt, fineAt, worstAt) they didn't state or clearly imply — "longer is better, period" has no ceiling, and a made-up "up to 4" or "up to 36 hours" misstates them.

4. Importance. Give each criterion "points" from a budget of 100 across ALL criteria, the way this pilot would actually trade: points measure how much a line's standing on that criterion should move it up or down their list. Be decisive — a pilot who names one thing as what they "most want to optimize" usually gives it 30–50 points, a couple of strong secondary goals 10–20 each, and tie-breakers 1–5. Spreading points evenly is wrong for almost every pilot. Use everything: explicit ranking words, "lifestyle over pay", how long they dwelt on it, what they trade for what. "Fine"/"OK" about something is near-neutral — usually no criterion at all. tier (must/high/medium/low) should agree with the points. confidence (0–1) is how sure you are the binding, shape and points are right; it should be low for anything inferred rather than said.

   When they correct a reading of their priorities ("should count more", "should count less"), move it decisively — at least half again more or less than before — and if they give a reason that points at a criterion ("too many departures"), raise that criterion too.
   Soft or conditional statements ("generally", "it depends", "I'd still take it if the rest of the trip were great") are low-weight preferences — never turn them into an "avoid X" criterion or a limit. When a pilot says lifestyle matters more than pay, the pay criterion's points must stay below the combined points of their lifestyle criteria, even if they call a pay number the one they'd optimize.

5. hardLimit only for things they say they will not bid (a dealbreaker) — never for strong preferences.

6. home: airports they fly from (home first, then alternates they named), whether they commute, and any buffers they stated or clearly implied (hours at base before a report, hours before an operated leg when deviating, rest before deadheading home, minimum backup flights). Use -1 when unsaid.

7. threads: what the interview should explore next — the open questions whose answers would change their ranking the most. Each must come from something THEY said or from a real tension in THIS pack (e.g. "Sydney trips here also carry three-leg duties — which wins?"), never a generic checklist topic. priority 0–1 = how much the answer could reorder their top lines. Mark a thread settled once they have clearly answered it; do not reopen settled ground.

8. notMeasurable: things they care about that no metric here can see (hotel quality, specific dates, who they fly with) — kept and said back honestly, never forced onto a metric.

9. synopsis: 2–4 sentences on who this pilot is as a bidder, in plain words — what they optimize, what they avoid, what they trade — addressed to them ("You…").

Keep ids stable: if the previous model has a criterion for the same thing, reuse its id. Quote their own words as evidence, with dictation stutters and misheard words cleaned up so they'd recognize it as what they said.

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
    model: {
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
    },
  };
}

function renderExchanges(exchanges: InterviewExchange[]): string {
  return exchanges
    .map((e) => (e.turn === 0 ? `[turn 0 — opening story]\nQ: ${e.question}\nA: ${e.answer}` : `[turn ${e.turn}]\nQ: ${e.question}\nA: ${e.answer}`))
    .join("\n\n");
}

export interface BuildModelResult {
  model: PilotModel;
  /** Per-criterion one-line reasoning, for logs and the transparency page. */
  reasoning: Record<string, string>;
  dropped: string[];
  usage: BrainUsage;
}

export async function buildPilotModel(input: BuildModelInput): Promise<BuildModelResult> {
  const fresh = [
    `PILOT: ${input.pilotContext}`,
    input.prior ? `PREVIOUS MODEL (keep ids stable; re-judge everything against the full interview below):\n${JSON.stringify({ criteria: input.prior.criteria.map((c) => ({ id: c.id, label: c.label, metric: c.metric, relativeWeight: +c.weight.toFixed(2) })), threads: input.prior.threads.map((t) => ({ id: t.id, topic: t.topic, status: t.status, timesAsked: t.timesAsked })) })}` : "",
    `THE INTERVIEW SO FAR — everything the pilot has said:\n\n${renderExchanges(input.exchanges)}`,
    `Write the pilot's complete model now.`,
  ].filter(Boolean).join("\n\n");

  const { data, usage } = await structuredCall<RawModel>({
    apiKey: input.apiKey,
    model: input.model,
    system: SYSTEM,
    user: { cached: input.packBrief, fresh },
    schema: SCHEMA as unknown as Record<string, unknown>,
    effort: input.effort ?? "high",
  });
  const { model, dropped } = parsePilotModel(data, input.prior);
  const reasoning = Object.fromEntries(data.criteria.map((c) => [c.id, c.reasoning]));
  return { model, reasoning, dropped, usage };
}
