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

async function post<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  // A dropped connection (a hotel's Wi-Fi, a jet bridge) waits for the connection and tries again, instead of failing
  // the interview: every call here carries the whole interview and the server keeps no state, so sending it again is
  // safe. A slow answer is a different thing: it still times out.
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
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
  const r = await post<{ model: PilotModel }>("/api/brain/build", body, 290_000);
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
    turn: number;
    maxTurns: number;
    rankingShifts?: number[];
  }
): Promise<StepResponse> {
  return post<StepResponse>("/api/brain/question", body, 85_000);
}
