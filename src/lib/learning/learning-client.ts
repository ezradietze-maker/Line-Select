import type { CorrectionEvent } from "@/lib/learning/interview-learning";
import type { Bucket, InterviewOutcome } from "@/lib/learning/interview-outcome";
import type { HoldHistorySummary } from "@/lib/learning/hold-history";
import type { PopulationInsights } from "@/types/interview-session";

/**
 * The browser's side of the fleet learning. Every call is best-effort and
 * bounded: the interview never waits more than a moment on it and never
 * fails because of it — with no learned plan, it just asks everything, as
 * it always has.
 */

export interface InterviewPlan {
  version: string | null;
  groupSize: number;
  /** Dimensions pilots in this group answer so consistently they're assumed rather than asked. */
  assume: { dim: string; bucket: Bucket; share: number; support: number; typicalStrength: number }[];
  /** What the model expects for each dimension — checked against the pilot's real answer afterward. */
  predictions: Record<string, Bucket>;
  focus: { dim: string; shares: Record<Bucket, number>; support: number }[];
  productiveTopics: string[];
  quietTopics: string[];
  targets: Record<string, { median: number; low: number; high: number; n: number }>;
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchInterviewPlan(params: { base: string; aircraft: string; seat: string; isCommuter: boolean | null; percentile: number | null }): Promise<InterviewPlan | null> {
  const q = new URLSearchParams({ base: params.base, aircraft: params.aircraft, seat: params.seat });
  if (params.isCommuter !== null) q.set("commuter", params.isCommuter ? "1" : "0");
  if (params.percentile !== null) q.set("percentile", String(Math.round(params.percentile * 100) / 100));
  return withTimeout(async (signal) => {
    const res = await fetch(`/api/learning/interview-policy?${q.toString()}`, { signal });
    return res.ok ? ((await res.json()) as InterviewPlan) : null;
  }, 2500);
}

export function postInterviewOutcome(outcome: InterviewOutcome): void {
  void withTimeout(
    (signal) => fetch("/api/learning/interview-outcome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(outcome), signal, keepalive: true }),
    8000
  );
}

export function postCorrections(pack: { base: string; aircraft: string; seat: string }, events: CorrectionEvent[]): void {
  if (events.length === 0) return;
  void withTimeout(
    (signal) => fetch("/api/learning/corrections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pack, events }), signal, keepalive: true }),
    8000
  );
}

export function fetchHoldHistory(): Promise<HoldHistorySummary | null> {
  return withTimeout(async (signal) => {
    const res = await fetch("/api/learning/hold-history", { signal });
    if (!res.ok) return null;
    return ((await res.json()) as { history: HoldHistorySummary | null }).history;
  }, 6000);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** The plan, in the compact form the interview model reads (see `PopulationInsights`). Undefined when there's no learned plan. */
export function insightsFromPlan(plan: InterviewPlan | null): PopulationInsights | undefined {
  if (!plan?.version || plan.groupSize === 0) return undefined;
  return {
    groupSize: plan.groupSize,
    assumedFromGroup: plan.assume.map((a) => a.dim),
    whereThisGroupSplits: plan.focus.map((f) => ({
      dim: f.dim,
      split: `${pct(f.shares.pos)} lean one way, ${pct(f.shares.neg)} the other, ${pct(f.shares.zero)} don't care (${f.support} pilots)`,
    })),
    usuallyRevealsSomething: plan.productiveTopics,
    rarelyChangesAnything: plan.quietTopics,
    typicalNumbers: Object.fromEntries(
      Object.entries(plan.targets).map(([k, t]) => [k, `${fmt(t.median)} (most ${fmt(t.low)}-${fmt(t.high)}, from ${t.n} pilots)`])
    ),
  };
}
