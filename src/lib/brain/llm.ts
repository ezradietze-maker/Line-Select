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
    ...(model.startsWith("claude-fable") ? { betas: ["server-side-fallback-2026-06-01"], fallbacks: [{ model: "claude-opus-4-8" }] } : {}),
  };
}

/** A structured call's answer, from the model's reply — shared with routed calls. */
export function structuredResult<T>(res: Pick<Anthropic.Beta.BetaMessage, "stop_reason" | "content" | "model" | "usage">, ms: number, priceFactor = 1): { data: T; usage: BrainUsage } {
  if (res.stop_reason === "refusal") throw new Error("brain call declined");
  if (res.stop_reason === "max_tokens") throw new Error("brain call ran out of room");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return {
    data: JSON.parse(text) as T,
    usage: { model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, costUsd: costOf(res.model, res.usage) * priceFactor, ms },
  };
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
