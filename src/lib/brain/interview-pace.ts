import type { PilotModel } from "@/types/pilot-model";

/**
 * The interview's pace, shared by the interviewer (server) and the interview screen (browser). Kept apart from
 * `interviewer.ts`, which talks to the AI: importing anything from there into the browser would ship the whole
 * Anthropic SDK to every pilot's phone.
 */

export const SWEEP_QUESTION = "Anything else that matters when you bid? (Topics you hadn't raised.)";

/**
 * Questions before a settled ranking may end the interview on its own: more for a pilot with more that matters to them —
 * a long story with a dozen priorities needs more questions than a short one with four. Not a target; the interviewer
 * usually goes on past it.
 */
export function minTurnsFor(model: PilotModel | null): number {
  const important = (model?.criteria ?? []).filter((c) => c.weight >= 0.3).length;
  return Math.max(12, Math.min(28, 4 + 2 * important));
}
