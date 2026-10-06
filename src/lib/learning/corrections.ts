import type { CorrectionEvent } from "@/lib/learning/interview-learning";
import { EXPLICIT_WEIGHT_IDS } from "@/lib/interview-engine";
import type { PreferenceFact } from "@/types/interview-session";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * What a pilot's slider changes say about the interview: when they move a
 * value the interview set, that's a correction — and the learning needs to
 * know whether the value was assumed from the group, read from their story,
 * or asked directly. A lot of corrected assumptions is what stops the app
 * from assuming that answer again (see `decideInterviewPolicy`).
 *
 * Values the pilot set by hand before aren't counted again, and a dimension
 * the interview never touched has nothing to correct.
 */
function sourceOf(fact: PreferenceFact): CorrectionEvent["src"] | null {
  switch (fact.source.kind) {
    case "population-prior":
      return "assumed";
    case "seed-question":
      return fact.source.questionKey === "bidding-story" ? "story" : "asked";
    case "adaptive-question":
      return "asked";
    case "manual-edit":
      return null;
  }
}

export function correctionEvents(before: PreferenceProfile, after: PreferenceProfile): CorrectionEvent[] {
  const events: CorrectionEvent[] = [];
  for (const dim of EXPLICIT_WEIGHT_IDS) {
    const from = before.weights[dim];
    const to = after.weights[dim];
    if (from === undefined || to === undefined || from === to) continue;
    // The newest fact behind this value is the one being corrected.
    const fact = [...before.discoveredFacts].reverse().find((f) => f.measurable?.type === "explicit-weight" && f.measurable.key === dim);
    const src = fact ? sourceOf(fact) : null;
    if (src) events.push({ dim, src, from: Math.round(from), to: Math.round(to) });
  }
  return events;
}

/** The demo bid pack isn't anyone's real base and seat — answers on it would teach the wrong group. */
export function isLearnablePack(pack: { id: string; month: string }): boolean {
  return pack.id !== "sample-bidpack" && /^[A-Z]{3}\d{2}$/i.test(pack.month);
}
