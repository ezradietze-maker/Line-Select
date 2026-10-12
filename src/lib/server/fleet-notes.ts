import { fleetNotes, resolveBrainCohort, type BrainFleetModel } from "@/lib/learning/brain-learning";
import { loadActiveModel } from "@/lib/server/learning-store";

/**
 * The fleet's notes for one pilot's group, for the brain's prompts — or nothing, quietly, when there's no learned
 * model yet, the group is too small, or the database is unreachable. The interview never waits on or fails for this.
 */
export async function fleetNotesFor(cohort: { base: string; aircraft: string; seat: string; commute: "commuter" | "local" | "unknown" } | null): Promise<string | null> {
  if (!cohort) return null;
  try {
    const stored = await loadActiveModel<BrainFleetModel>("brain");
    return stored ? fleetNotes(resolveBrainCohort(stored.payload, cohort)) : null;
  } catch (e) {
    console.error("[brain] fleet notes unavailable", e);
    return null;
  }
}
