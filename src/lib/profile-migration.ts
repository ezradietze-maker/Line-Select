import type { PreferenceProfile } from "@/types/preferences";

/**
 * "Departures" used to mean what the bid pack calls duty periods — report-to-
 * release stretches — and a pilot's pinned target, range, dealbreaker and
 * interview facts were all stored under that name. Departures now means
 * takeoffs (equal to landings), and the old dimension is `dutyPeriods`. The
 * numbers a pilot pinned still mean what they meant, so a profile saved
 * before the rename keeps its answers: they're carried across to the new key
 * rather than left pointing at a dimension that's now something else.
 *
 * Safe to run on any profile, old or new — a profile with nothing under the
 * old key comes back unchanged.
 */
const OLD_KEY = "departures";
const NEW_KEY = "dutyPeriods";

function renameKey<T extends Record<string, unknown>>(obj: T | undefined): T | undefined {
  if (!obj || !(OLD_KEY in obj)) return obj;
  const { [OLD_KEY]: value, ...rest } = obj as Record<string, unknown>;
  return { ...rest, [NEW_KEY]: (rest as Record<string, unknown>)[NEW_KEY] ?? value } as unknown as T;
}

export function migrateDeparturesToDutyPeriods<T extends Partial<PreferenceProfile>>(profile: T): T {
  const facts = profile.discoveredFacts?.map((fact) => {
    const m = fact.measurable;
    if (!m || (m.type !== "explicit-target" && m.type !== "explicit-weight")) return fact;
    return (m.key as string) === OLD_KEY ? { ...fact, measurable: { ...m, key: NEW_KEY } as typeof m } : fact;
  });
  const transcript = profile.interviewTranscript?.map((turn) => {
    const q = turn.question as { boundTo?: string };
    return q.boundTo === OLD_KEY ? { ...turn, question: { ...turn.question, boundTo: NEW_KEY } as typeof turn.question } : turn;
  });
  return {
    ...profile,
    weights: renameKey(profile.weights as Record<string, unknown> | undefined) as T["weights"],
    explicitTargets: renameKey(profile.explicitTargets as Record<string, unknown> | undefined) as T["explicitTargets"],
    ...(facts ? { discoveredFacts: facts } : {}),
    ...(transcript ? { interviewTranscript: transcript } : {}),
  };
}
