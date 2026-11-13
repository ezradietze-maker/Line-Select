import { callCeilingUsd, schemaChars, structuredCall, type BrainUsage } from "@/lib/brain/llm";
import { METRICS, METRICS_BY_ID, type MetricParams } from "@/lib/metrics/catalog";
import { neverSayForPrompt } from "./pilot-words";

/**
 * "Ask your pack": a pilot's plain question about their bid pack ("lines with Honolulu and no weekends worked") read as
 * a query over the app's own measures — never answered from the model's head. The model only turns the words into
 * conditions; the browser measures every line and keeps the ones that meet them (`runAskQuery`), so the answer is the
 * pack's real numbers, the same ones the scores use.
 */

export interface AskCondition {
  metric: string;
  op: "atMost" | "atLeast" | "equals";
  value: number;
  params?: MetricParams;
  /** The condition in a pilot's words, for showing beside each line's figure: "no weekends worked". */
  label: string;
}

export interface AskQuery {
  conditions: AskCondition[];
  sort: { metric: string; direction: "asc" | "desc"; params?: MetricParams } | null;
  /** The question restated in one plain sentence — what's being looked for. */
  summary: string;
  /** Set (and no conditions) when the pack can't answer it — why, in a sentence. */
  cannotAnswer: string | null;
}

/**
 * The measures the model may name: the brief's menu, as an enum, so a near-miss id ("layoversInCity") can't be written at
 * all. A free string let one through, `cleanAskQuery` dropped it, and the answer listed every line under the pilot's
 * filter ("Lines with a Honolulu layover — 49 lines").
 */
const METRIC_IDS = METRICS.filter((def) => !def.retired).map((def) => def.id);

const PARAMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cities: { type: "array", items: { type: "string" } },
    regions: { type: "array", items: { type: "string" } },
    n: { type: "number" },
    minHours: { type: "number" },
    maxHours: { type: "number" },
    weekdays: { type: "array", items: { type: "integer" } },
    dates: { type: "array", items: { type: "string" } },
  },
};

/** What the model fills in (exported for the tests). */
export const ASK_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["conditions", "sort", "summary", "cannotAnswer"],
  properties: {
    conditions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["metric", "op", "value", "params", "label"],
        properties: {
          metric: { type: "string", enum: METRIC_IDS },
          op: { type: "string", enum: ["atMost", "atLeast", "equals"] },
          value: { type: "number" },
          params: PARAMS_SCHEMA,
          label: { type: "string" },
        },
      },
    },
    sort: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["metric", "direction", "params"],
          properties: { metric: { type: "string", enum: METRIC_IDS }, direction: { type: "string", enum: ["asc", "desc"] }, params: PARAMS_SCHEMA },
        },
      ],
    },
    summary: { type: "string" },
    cannotAnswer: { anyOf: [{ type: "null" }, { type: "string" }] },
  },
};

const SYSTEM = `You turn a FedEx pilot's question about their bid pack into a precise query over measures the app computes for every line. You never answer from your own knowledge: the app measures each line and keeps the ones that meet your conditions.

The pack brief lists every measure you can use (its id, unit and what it counts, and this pack's range), and the pack's layover cities. For each thing the pilot asks for:
- Pick the measure that counts it most directly, with its params (cities as the brief's codes; weekdays 1 = Monday … 7 = Sunday; dates as YYYY-MM-DD inside this bid period; n for a leg count; minHours/maxHours for a layover window).
- Set op and value: "no X" / "without X" → equals 0; "at least / more than" → atLeast (more than 3 → atLeast 4 for whole counts); "at most / fewer than / under" → atMost (fewer than 3 → atMost 2); "with X" / "has X" for a count → atLeast 1.
- label: the condition in a pilot's plain words ("no weekends worked", "Honolulu layovers", "3 departures or fewer"). Never an id, unit name or the words "metric" or "criterion". The measures' names are for you to find them, not words to write.
"Best", "most", "least", "highest" with no number → a sort (desc for most, asc for least) instead of a condition, or alongside the conditions. If the pilot only asks to rank, conditions is empty and sort is set.
Use only measure ids from the brief, exactly as written. If nothing in the brief can measure what they ask (pay rates, seniority, who else bids a line), set cannotAnswer to one plain sentence on why — naming the closest thing the pack can measure, if there is one ("The pack has no pay rates — credit per day away is the closest it measures.") — and leave conditions empty and sort null. summary: one plain sentence restating what's being looked for, in pilot terms. Never write "I" or "me": say what the pack has, not what you can do.

In label, summary and cannotAnswer: ${neverSayForPrompt()}`;

const MAX_TOKENS = 4000;

/** The most `readAskQuery` can cost, held against the spend ceilings before it's asked. */
export function askQueryCeilingUsd(input: { question: string; packBrief: string; model?: string }): number {
  return callCeilingUsd(input.model, SYSTEM.length + schemaChars(ASK_QUERY_SCHEMA) + input.packBrief.length + input.question.length, MAX_TOKENS);
}

/** Reads a question into a query. `packBrief` is the pack's measure menu (`buildPackBrief`), the same the brain reads. */
export async function readAskQuery(input: { question: string; packBrief: string; apiKey?: string; model?: string }): Promise<{ query: AskQuery; usage: BrainUsage }> {
  const { data, usage } = await structuredCall<AskQuery>({
    apiKey: input.apiKey,
    model: input.model,
    system: SYSTEM,
    user: { cached: input.packBrief, fresh: `THE PILOT'S QUESTION:\n${input.question}` },
    schema: ASK_QUERY_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
    maxTokens: MAX_TOKENS,
  });
  return { query: cleanAskQuery(data), usage };
}

/** Params that say which cities, regions, dates or weekdays: a measure that reads one counts nothing without it. */
const CHOSEN: (keyof MetricParams)[] = ["cities", "regions", "dates", "weekdays"];
const MAX_CONDITIONS = 6;

/**
 * Only measures the app has, only the params each one takes — anything else the model wrote is dropped. A condition
 * that can't be checked as written (a measure the app doesn't have, a city measure left with no cities, one past the
 * sixth) turns the whole answer into a plain "couldn't check", naming it: a list with the condition quietly gone would
 * still read as filtered by it ("Lines with a Honolulu layover — 49 lines").
 */
export function cleanAskQuery(q: AskQuery): AskQuery {
  const params = (metric: string, p: MetricParams | undefined): MetricParams | undefined => {
    const allowed = new Set(METRICS_BY_ID.get(metric)?.params ?? []);
    if (!p) return undefined;
    const out = Object.fromEntries(
      Object.entries(p).filter(([k, v]) => allowed.has(k as keyof MetricParams) && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    ) as MetricParams;
    return Object.keys(out).length ? out : undefined;
  };
  /** The measure reads a chosen city, region, date or weekday, and none survived. */
  const missingChoice = (metric: string, p: MetricParams | undefined) => {
    const def = METRICS_BY_ID.get(metric);
    const needs = (def?.params ?? []).filter((k) => CHOSEN.includes(k) && def?.defaults?.[k] === undefined);
    return needs.length > 0 && !needs.some((k) => p?.[k] !== undefined);
  };
  const unchecked: string[] = [];
  const conditions: AskCondition[] = [];
  for (const c of q.conditions ?? []) {
    const label = String(c.label ?? "").slice(0, 120);
    const p = params(c.metric, c.params);
    const ok = METRICS_BY_ID.has(c.metric) && Number.isFinite(c.value) && (c.op === "atMost" || c.op === "atLeast" || c.op === "equals") && !missingChoice(c.metric, p);
    if (ok && conditions.length < MAX_CONDITIONS) conditions.push({ ...c, params: p, label });
    else unchecked.push(label.trim() ? `"${label.trim()}"` : "part of the question");
  }
  let sort: AskQuery["sort"] = null;
  if (q.sort) {
    const p = params(q.sort.metric, q.sort.params);
    if (METRICS_BY_ID.has(q.sort.metric) && !missingChoice(q.sort.metric, p)) sort = { metric: q.sort.metric, direction: q.sort.direction === "asc" ? "asc" : "desc", params: p };
    else unchecked.push("the order asked for");
  }
  const said = typeof q.cannotAnswer === "string" && q.cannotAnswer.trim() ? q.cannotAnswer.trim().slice(0, 300) : null;
  const cannotAnswer =
    said ?? (unchecked.length ? `The pack couldn't be checked for ${joinAnd(unchecked)} as asked, so no lines are shown — try asking it another way.`.slice(0, 300) : null);
  return { conditions: cannotAnswer ? [] : conditions, sort: cannotAnswer ? null : sort, summary: String(q.summary ?? "").slice(0, 300), cannotAnswer };
}

const joinAnd = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
