import type { InterviewExchange } from "@/lib/brain/build-model";
import type { InterviewStep, LinePairCandidate, ThreadState } from "@/lib/brain/interviewer";
import type { PilotModel } from "@/types/pilot-model";

/**
 * The browser's side of the pilot-brain routes. Each call carries everything
 * it needs (the pack brief, the whole interview so far): the server keeps no
 * interview state, so a refresh or a second device never desyncs it.
 */

async function post<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export interface BrainRequestBase {
  packBrief: string;
  pilotContext: string;
  exchanges: InterviewExchange[];
}

export async function requestModelBuild(body: BrainRequestBase & { prior: PilotModel | null }): Promise<PilotModel> {
  const r = await post<{ model: PilotModel }>("/api/brain/build", body, 290_000);
  return r.model;
}

export type StepResponse = Omit<Extract<InterviewStep, { done: false }>, "usage"> | Omit<Extract<InterviewStep, { done: true }>, "usage">;

export async function requestNextStep(
  body: BrainRequestBase & { model: PilotModel | null; threads: Record<string, ThreadState>; linePairs: LinePairCandidate[]; turn: number; maxTurns: number }
): Promise<StepResponse> {
  return post<StepResponse>("/api/brain/question", body, 85_000);
}
