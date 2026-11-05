import { fleetNotes, resolveBrainCohort, type BrainFleetModel } from "@/lib/learning/brain-learning";
import { loadActiveModel } from "@/lib/server/learning-store";

/**
 * Whether fleet notes reach the brain at all. Off unless `FLEET_NOTES=on`: the notes are built partly from the brain's
 * own earlier reads, so feeding them back nudges every pilot toward their group's average, and that average grows
 * stronger each time. They stay off until they're rebuilt from what pilots themselves said and did, and checked.
 */
export function fleetNotesEnabled(): boolean {
  return process.env.FLEET_NOTES === "on";
}

/**
 * The fleet's notes for one pilot's group, for the brain's prompts — or nothing, quietly, when they're switched off,
 * there's no learned model yet, the group is too small, or the database is unreachable. The interview never waits on
 * or fails for this.
 */
export async function fleetNotesFor(cohort: { base: string; aircraft: string; seat: string; commute: "commuter" | "local" | "unknown" } | null): Promise<string | null> {
  if (!cohort || !fleetNotesEnabled()) return null;
  try {
    const stored = await loadActiveModel<BrainFleetModel>("brain");
    return stored ? fleetNotes(resolveBrainCohort(stored.payload, cohort)) : null;
  } catch (e) {
    console.error("[brain] fleet notes unavailable", e);
    return null;
  }
}
