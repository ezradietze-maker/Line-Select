import { isJsonObject, isText } from "@/lib/server/json-body";
import { MAX_ANSWER, MAX_EXCHANGES } from "@/lib/brain/answer-limits";
import type { InterviewExchange } from "@/lib/brain/build-model";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Checks for what the pilot-brain routes accept. Everything here comes from
 * a pilot's browser, so each field is bounded before it reaches a model call
 * — a long interview is still far inside these limits.
 */

export const MAX_PACK_BRIEF = 80_000;
export const MAX_CONTEXT = 2_000;
export { MAX_ANSWER, MAX_EXCHANGES };
export const MAX_QUESTION = 3_000;
/** Every question and answer together. The longest saved interview (42 answers, a real pilot's) runs to about 34,000. */
export const MAX_INTERVIEW_CHARS = 150_000;
/** A whole brain request: the interview, the pack brief, the prior model and the rest, with room to spare. */
export const MAX_BRAIN_BODY = 500_000;

/**
 * What's wrong with an interview the routes refuse, in the pilot's words — or null when it isn't one of these. "Missing
 * interview input" told a pilot with one long answer nothing, and Try again sent the same answer again.
 */
export function exchangesProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_EXCHANGES) return `This interview has more answers than one read can take (${MAX_EXCHANGES}). Go back a few answers and build your priorities from there.`;
  let chars = 0;
  for (const [i, e] of value.entries()) {
    if (!isJsonObject(e)) return null;
    const answer = typeof e.answer === "string" ? e.answer : "";
    const question = typeof e.question === "string" ? e.question : "";
    if (answer.length > MAX_ANSWER) {
      const asked = question.replace(/ \[(Line|Trip) .*\]$/, "").replace(/\s+/g, " ").trim();
      const which = i === 0 && e.turn === 0 ? "Your story" : asked ? `Your answer to “${asked.length > 60 ? `${asked.slice(0, 58).replace(/\s+\S*$/, "")}…` : asked}”` : `Answer ${i + 1}`;
      return `${which} is too long: ${answer.length.toLocaleString("en-US")} characters, and one answer can be up to ${MAX_ANSWER.toLocaleString("en-US")}. Go back and shorten it.`;
    }
    chars += question.length + answer.length;
  }
  if (chars > MAX_INTERVIEW_CHARS) return `Your answers together are longer than one read can take (${MAX_INTERVIEW_CHARS.toLocaleString("en-US")} characters). Go back and shorten one of your longer answers.`;
  return null;
}

export function readExchanges(value: unknown): InterviewExchange[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EXCHANGES) return null;
  const out: InterviewExchange[] = [];
  let chars = 0;
  for (const e of value) {
    if (!isJsonObject(e) || typeof e.turn !== "number" || !isText(e.question, MAX_QUESTION) || typeof e.answer !== "string" || e.answer.length > MAX_ANSWER) return null;
    chars += e.question.length + e.answer.length;
    if (chars > MAX_INTERVIEW_CHARS) return null;
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
