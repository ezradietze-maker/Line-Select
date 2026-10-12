import { isJsonObject, isText } from "@/lib/server/json-body";
import type { InterviewExchange } from "@/lib/brain/build-model";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Checks for what the pilot-brain routes accept. Everything here comes from
 * a pilot's browser, so each field is bounded before it reaches a model call
 * — a long interview is still far inside these limits.
 */

export const MAX_PACK_BRIEF = 80_000;
export const MAX_CONTEXT = 2_000;
export const MAX_EXCHANGES = 80;
export const MAX_ANSWER = 12_000;
export const MAX_QUESTION = 3_000;

export function readExchanges(value: unknown): InterviewExchange[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EXCHANGES) return null;
  const out: InterviewExchange[] = [];
  for (const e of value) {
    if (!isJsonObject(e) || typeof e.turn !== "number" || !isText(e.question, MAX_QUESTION) || typeof e.answer !== "string" || e.answer.length > MAX_ANSWER) return null;
    out.push({ turn: e.turn, question: e.question, answer: e.answer });
  }
  return out;
}

/** A pilot model sent back by the client — only its shape is checked; it is only ever read as context. */
export function readModel(value: unknown): PilotModel | null {
  if (!isJsonObject(value) || value.version !== 2 || !Array.isArray(value.criteria) || !Array.isArray(value.threads) || !Array.isArray(value.notMeasurable)) return null;
  if (JSON.stringify(value).length > 200_000) return null;
  return value as unknown as PilotModel;
}

/** The pilot's group, for fleet notes — the same coarse facts every bid pack prints. */
export function readCohort(value: unknown): { base: string; aircraft: string; seat: string; commute: "commuter" | "local" | "unknown" } | null {
  if (!isJsonObject(value) || !isText(value.base, 5) || !isText(value.aircraft, 8) || !isText(value.seat, 4)) return null;
  const commute = value.commute === "commuter" || value.commute === "local" ? value.commute : "unknown";
  return { base: value.base, aircraft: value.aircraft, seat: value.seat, commute };
}
