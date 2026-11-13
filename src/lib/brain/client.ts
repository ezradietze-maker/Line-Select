import { fitExchanges } from "@/lib/brain/answer-limits";
import type { InterviewExchange } from "@/lib/brain/build-model";
import type { InterviewStep, LinePairCandidate, ThreadState } from "@/lib/brain/interviewer";
import type { PilotModel } from "@/types/pilot-model";
import { reportConnectionLost, waitForConnection } from "@/lib/connection";

/**
 * The browser's side of the pilot-brain routes. Each call carries everything
 * it needs (the pack brief, the whole interview so far): the server keeps no
 * interview state, so a refresh or a second device never desyncs it.
 */

/** How long a request waits for a dropped connection to come back before giving up and saying so. */
const WAIT_FOR_CONNECTION_MS = 3 * 60 * 1000;

export async function postWithRetry<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  // A dropped connection (a hotel's Wi-Fi, a jet bridge) waits for the connection and tries again, instead of failing
  // the interview: every call here carries the whole interview and the server keeps no state, so sending it again is
  // safe. A slow answer is a different thing: it still times out.
  // One id for every send of this request: a copy the server already ran (the connection dropped on the way back) is
  // answered from that run, not paid for again.
  const requestId = crypto.randomUUID();
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Request-Id": requestId }, body: JSON.stringify(body), signal: ctrl.signal });
    } catch {
      clearTimeout(timer);
      // The browser's own words for a timeout or a dropped connection ("signal is aborted without reason", "Failed to
      // fetch") are shown to the pilot as they are, so they're said plainly here.
      if (ctrl.signal.aborted) throw new Error("That took too long to come back. Try again.");
      reportConnectionLost();
      if (attempt < 3 && (await waitForConnection(WAIT_FOR_CONNECTION_MS))) continue;
      throw new Error("Couldn’t reach Line Select. Check your connection and try again.");
    }
    try {
      const json = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface BrainRequestBase {
  packBrief: string;
  pilotContext: string;
  exchanges: InterviewExchange[];
  /** The pilot's group, so the server can add what the fleet has learned about pilots like them. */
  cohort?: { base: string; aircraft: string; seat: string; commute: "commuter" | "local" | "unknown" };
}

export async function requestModelBuild(body: BrainRequestBase & { prior: PilotModel | null }): Promise<PilotModel> {
  // Every answer within the routes' limit, whatever a saved draft holds (`fitExchanges`).
  const r = await postWithRetry<{ model: PilotModel }>("/api/brain/build", { ...body, exchanges: fitExchanges(body.exchanges) }, 290_000);
  return r.model;
}

export type StepResponse = Omit<Extract<InterviewStep, { done: false }>, "usage"> | Omit<Extract<InterviewStep, { done: true }>, "usage">;

export async function requestNextStep(
  body: BrainRequestBase & {
    model: PilotModel | null;
    threads: Record<string, ThreadState>;
    linePairs: LinePairCandidate[];
    examples?: import("./question-examples").QuestionExample[];
    packNumbers?: { lines: string[]; trips: string[] };
    tripPairs?: import("./trip-pairs").TripPairCandidate[];
    topics?: import("./question-topics").TopicCandidate[];
    lastTopic?: string | null;
    turn: number;
    maxTurns: number;
    rankingShifts?: number[];
  }
): Promise<StepResponse> {
  return postWithRetry<StepResponse>("/api/brain/question", { ...body, exchanges: fitExchanges(body.exchanges) }, 85_000);
}

/** A pilot's own words for why they swapped two lines, matched to a priority or measure (see `lib/brain/swap-reason.ts`). */
export async function requestSwapReason(body: import("./swap-reason").SwapReasonInput): Promise<import("./swap-reason").SwapReason> {
  const r = await postWithRetry<{ reason: import("./swap-reason").SwapReason }>("/api/brain/swap-reason", body, 25_000);
  return r.reason;
}
