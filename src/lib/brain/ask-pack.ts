import { structuredCall, type BrainUsage } from "@/lib/brain/llm";
import { METRICS_BY_ID, type MetricParams } from "@/lib/metrics/catalog";
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

const SCHEMA = {
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
          metric: { type: "string" },
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
          properties: { metric: { type: "string" }, direction: { type: "string", enum: ["asc", "desc"] }, params: PARAMS_SCHEMA },
        },
      ],
    },
    summary: { type: "string" },
    cannotAnswer: { anyOf: [{ type: "null" }, { type: "string" }] },
  },
} as const;

const SYSTEM = `You turn a FedEx pilot's question about their bid pack into a precise query over measures the app computes for every line. You never answer from your own knowledge: the app measures each line and keeps the ones that meet your conditions.

The pack brief lists every measure you can use (its id, unit and what it counts, and this pack's range), and the pack's layover cities. For each thing the pilot asks for:
- Pick the measure that counts it most directly, with its params (cities as the brief's codes; weekdays 1 = Monday … 7 = Sunday; dates as YYYY-MM-DD inside this bid period; n for a leg count; minHours/maxHours for a layover window).
- Set op and value: "no X" / "without X" → equals 0; "at least / more than" → atLeast (more than 3 → atLeast 4 for whole counts); "at most / fewer than / under" → atMost (fewer than 3 → atMost 2); "with X" / "has X" for a count → atLeast 1.
- label: the condition in a pilot's plain words ("no weekends worked", "Honolulu layovers", "3 departures or fewer"). Never an id, unit name or the words "metric" or "criterion". The measures' names are for you to find them, not words to write.
"Best", "most", "least", "highest" with no number → a sort (desc for most, asc for least) instead of a condition, or alongside the conditions. If the pilot only asks to rank, conditions is empty and sort is set.
Use only measure ids from the brief, exactly as written. If nothing in the brief can measure what they ask (pay rates, seniority, who else bids a line), set cannotAnswer to one plain sentence on why — naming the closest thing the pack can measure, if there is one ("The pack has no pay rates — credit per day away is the closest it measures.") — and leave conditions empty and sort null. summary: one plain sentence restating what's being looked for, in pilot terms. Never write "I" or "me": say what the pack has, not what you can do.

In label, summary and cannotAnswer: ${neverSayForPrompt()}`;

/** Reads a question into a query. `packBrief` is the pack's measure menu (`buildPackBrief`), the same the brain reads. */
export async function readAskQuery(input: { question: string; packBrief: string; apiKey?: string; model?: string }): Promise<{ query: AskQuery; usage: BrainUsage }> {
  const { data, usage } = await structuredCall<AskQuery>({
    apiKey: input.apiKey,
    model: input.model,
    system: SYSTEM,
    user: { cached: input.packBrief, fresh: `THE PILOT'S QUESTION:\n${input.question}` },
    schema: SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
    maxTokens: 4000,
  });
  return { query: cleanAskQuery(data), usage };
}

/** Only measures the app has, only the params each one takes — anything else the model wrote is dropped. */
export function cleanAskQuery(q: AskQuery): AskQuery {
  const params = (metric: string, p: MetricParams | undefined): MetricParams | undefined => {
    const allowed = new Set(METRICS_BY_ID.get(metric)?.params ?? []);
    if (!p) return undefined;
    const out = Object.fromEntries(Object.entries(p).filter(([k, v]) => allowed.has(k as keyof MetricParams) && v !== null && v !== undefined)) as MetricParams;
    return Object.keys(out).length ? out : undefined;
  };
  const conditions = (q.conditions ?? [])
    .filter((c) => METRICS_BY_ID.has(c.metric) && Number.isFinite(c.value) && (c.op === "atMost" || c.op === "atLeast" || c.op === "equals"))
    .slice(0, 6)
    .map((c) => ({ ...c, params: params(c.metric, c.params), label: String(c.label ?? "").slice(0, 120) }));
  const sort = q.sort && METRICS_BY_ID.has(q.sort.metric) ? { metric: q.sort.metric, direction: q.sort.direction === "asc" ? ("asc" as const) : ("desc" as const), params: params(q.sort.metric, q.sort.params) } : null;
  const cannotAnswer = typeof q.cannotAnswer === "string" && q.cannotAnswer.trim() ? q.cannotAnswer.trim().slice(0, 300) : null;
  return { conditions: cannotAnswer ? [] : conditions, sort: cannotAnswer ? null : sort, summary: String(q.summary ?? "").slice(0, 300), cannotAnswer };
}
