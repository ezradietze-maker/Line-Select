import Anthropic from "@anthropic-ai/sdk";

/**
 * One structured call to the strongest model, for the pilot brain's heavy
 * thinking (reading a pilot's whole interview and building their model). The
 * answer comes back as JSON that matches `schema`, streamed so long answers
 * can't time out, with a server-side fallback so a rare policy decline is
 * re-run on another model instead of failing the interview.
 */

export const BRAIN_MODEL = process.env.BRAIN_MODEL || "claude-sonnet-5-5";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** $/MTok, input and output. Cache reads and writes priced from input. */
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-fable-5-1": { in: 10, out: 50, cacheRead: 0.25 },
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
  "claude-opus-4-8": { in: 5, out: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
};

export interface BrainUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
}

export function costOf(model: string, u: Anthropic.Beta.BetaUsage): number {
  const p = PRICES[model] ?? PRICES["claude-fable-5-1"];
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  return (u.input_tokens * p.in + cacheWrite * p.in * 1.25 + cacheRead * p.cacheRead + u.output_tokens * p.out) / 1e6;
}

export interface StructuredCallOptions {
  apiKey?: string;
  model?: string;
  system: string;
  /** Static content first (cached), then what changes per call. */
  user: { cached?: string; fresh: string };
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
}

/** The request a structured call sends — one place, so a call routed elsewhere (see `routeStructuredCalls`) sends exactly the same. */
export function structuredParams(opts: StructuredCallOptions, extra: { cacheFresh?: boolean } = {}) {
  const model = opts.model ?? BRAIN_MODEL;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (opts.user.cached) content.push({ type: "text", text: opts.user.cached, cache_control: { type: "ephemeral" } });
  content.push({ type: "text", text: opts.user.fresh, ...(extra.cacheFresh ? { cache_control: { type: "ephemeral" as const } } : {}) });
  return {
    model,
    max_tokens: opts.maxTokens ?? 32000,
    system: opts.system,
    messages: [{ role: "user" as const, content }],
    output_config: { effort: opts.effort ?? "high", format: { type: "json_schema", schema: opts.schema } },
    ...refusalFallback(model),
  };
}

/**
 * A request the model declines is re-run on another model inside the same call, instead of failing the pilot's
 * interview. Sonnet 5.5 takes only Anthropic's "default" routing (it picks the fallback by the reason declined);
 * Fable keeps its fixed fallback. Other models get none.
 */
function refusalFallback(model: string) {
  if (model.startsWith("claude-fable")) return { betas: ["server-side-fallback-2026-06-01"], fallbacks: [{ model: "claude-opus-4-8" }] };
  if (model === "claude-sonnet-5-5") return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  return {};
}

/** A structured call's answer, from the model's reply — shared with routed calls. */
export function structuredResult<T>(res: Pick<Anthropic.Beta.BetaMessage, "stop_reason" | "content" | "model" | "usage">, ms: number, priceFactor = 1): { data: T; usage: BrainUsage } {
  const usage: BrainUsage = { model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, costUsd: costOf(res.model, res.usage) * priceFactor, ms };
  // A reply that can't be used was still paid for: the error carries its cost, so the spend caps count it (see `failedCallCost`).
  const fail = (message: string) => Object.assign(new Error(message), { usage });
  if (res.stop_reason === "refusal") throw fail("brain call declined");
  if (res.stop_reason === "max_tokens") throw fail("brain call ran out of room");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw fail("brain call returned unreadable JSON");
  }
  return { data, usage };
}

/** What a failed call had already cost, when the model answered before it failed; 0 when it never got that far. */
export function failedCallCost(error: unknown): number {
  const usage = (error as { usage?: BrainUsage } | null)?.usage;
  return typeof usage?.costUsd === "number" && Number.isFinite(usage.costUsd) ? usage.costUsd : 0;
}

/** The error, carrying `usd` more of cost: calls in the same request that were paid for before this one failed. */
export function withSpent(error: unknown, usd: number): unknown {
  if (!(usd > 0)) return error;
  const failed = error instanceof Error ? error : new Error(String(error));
  const usage = (failed as { usage?: Partial<BrainUsage> }).usage;
  return Object.assign(failed, { usage: { ...usage, costUsd: failedCallCost(failed) + usd } });
}

type Caller = <T>(opts: StructuredCallOptions) => Promise<{ data: T; usage: BrainUsage }>;
let routed: Caller | null = null;

/**
 * Sends every structured call somewhere else until called with null — for the evaluation scripts, which run the same
 * brain, facts and interviewer code through the Batches API at half price (`scripts/eval/batch.ts`). The app never sets it.
 */
export function routeStructuredCalls(caller: Caller | null): void {
  routed = caller;
}

export async function structuredCall<T>(opts: StructuredCallOptions): Promise<{ data: T; usage: BrainUsage }> {
  if (routed) return routed<T>(opts);
  const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  const started = Date.now();
  const res = await client.beta.messages.stream(structuredParams(opts) as unknown as Anthropic.Beta.MessageCreateParamsStreaming).finalMessage();
  return structuredResult<T>(res, Date.now() - started);
}
