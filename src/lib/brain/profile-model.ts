import { applyCityRatings } from "@/lib/brain/city-ratings";
import { fitTripWeights, shareChanges, type WeightChange } from "@/lib/brain/fit-choices";
import { learnFromChoices } from "@/lib/brain/reorder-learner";
import type { PackMetrics } from "@/lib/metrics/compute";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice, PilotModel, TripChoice } from "@/types/pilot-model";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * Keeping a pilot's model current after the interview. The model the pilot
 * confirmed is the base; their city grades and every line choice they've
 * made (in the interview and by dragging lines on the results) are applied
 * on top of it, every time, from scratch — so a hundred drags sharpen the
 * model without ever drifting it away from what the pilot said.
 */

/** The model the pilot confirmed — or, for a profile saved before that was kept, the model itself. */
export function baseModelOf(profile: PreferenceProfile): PilotModel | null {
  return profile.brainInterview?.reviewedModel ?? profile.pilotModel ?? null;
}

/**
 * The pilot model for a confirmed base: city grades in, fitted to every line choice, then the pilot's own settings on
 * top, then how each priority counts on a single trip, fitted to their trip choices.
 */
export function deriveModel(
  bidPack: BidPack,
  base: PilotModel,
  profile: Pick<PreferenceProfile, "cityRatings">,
  choices: LineChoice[],
  pack?: PackMetrics,
  pins: Record<string, number> = {},
  tripChoices: TripChoice[] = []
): { model: PilotModel; changes: WeightChange[]; heldByLimit: LineChoice[] } {
  const rated = applyCityRatings(base, profile.cityRatings);
  // The line choices are fitted on the score the pilot sees — with their trip grades in, once they have some
  // (`learnFromChoices` reads `tripWeights`) — then the trip grades are fitted again on the lines that came out.
  const seenTrips = tripChoices.length ? fitTripWeights(bidPack, applyPins(rated, pins), tripChoices, pack).tripWeights : undefined;
  const fit = learnFromChoices(bidPack, { ...rated, tripWeights: seenTrips }, choices, pack);
  const lineModel = applyPins({ ...fit.model, tripWeights: undefined }, pins);
  const tripWeights = tripChoices.length ? fitTripWeights(bidPack, lineModel, tripChoices, pack).tripWeights : undefined;
  return { model: { ...lineModel, tripWeights }, changes: fit.changes, heldByLimit: fit.heldByLimit };
}

/** A pinned priority counts exactly what the pilot set, relative to their strongest unpinned one ("Top" ties it). */
export function applyPins(model: PilotModel, pins: Record<string, number>): PilotModel {
  const ids = Object.keys(pins).filter((id) => model.criteria.some((c) => c.id === id));
  if (!ids.length) return model;
  const free = model.criteria.filter((c) => !(c.id in pins));
  const scale = Math.max(0, ...free.map((c) => c.weight)) || 1;
  const criteria = model.criteria.map((c) => (c.id in pins ? { ...c, weight: pins[c.id] * scale, confidence: Math.max(c.confidence, 0.95) } : c));
  const top = Math.max(...criteria.map((c) => c.weight)) || 1;
  return { ...model, criteria: criteria.map((c) => ({ ...c, weight: c.weight / top })) };
}

/** The profile with a new confirmed base and/or new choices, its working model refitted. */
export function withModel(
  profile: PreferenceProfile,
  bidPack: BidPack,
  update: { base?: PilotModel; choices?: LineChoice[]; cityRatings?: PreferenceProfile["cityRatings"]; pins?: Record<string, number> },
  pack?: PackMetrics
): { profile: PreferenceProfile; changes: WeightChange[]; heldByLimit: LineChoice[] } {
  const base = update.base ?? baseModelOf(profile);
  if (!base) return { profile, changes: [], heldByLimit: [] };
  const choices = update.choices ?? profile.brainInterview?.choices ?? [];
  const next = { ...profile, ...(update.cityRatings ? { cityRatings: update.cityRatings } : {}) };
  // Changes are reported against the model the pilot was looking at a moment ago.
  const before = profile.pilotModel ?? base;
  const pins = update.pins ?? profile.brainInterview?.pins ?? {};
  const { model, heldByLimit } = deriveModel(bidPack, base, next, choices, pack, pins, profile.brainInterview?.tripChoices ?? []);
  const changes = shareChanges(before, model);
  return {
    profile: {
      ...next,
      pilotModel: model,
      brainInterview: { exchanges: profile.brainInterview?.exchanges ?? [], ...profile.brainInterview, choices, reviewedModel: base, pins },
    },
    changes,
    heldByLimit,
  };
}

/**
 * A drag on the results: the moved line was put above (or below) each line it passed — one choice per line passed,
 * tagged with the drag (when given) so undoing it takes them back.
 */
export function choicesFromDrag(passed: { favored: string; overtaken: string }[], dragId?: string): LineChoice[] {
  return passed.map((p) => ({ preferred: p.favored, other: p.overtaken, strength: "slightly" as const, direct: true, ...(dragId ? { dragId } : {}) }));
}

/**
 * A swap on the results, as line choices: `order` is the run of lines from the higher of the two swapped lines to the
 * lower, as the pilot left it. The line now on top was put above everything in the run, and the line now at the bottom
 * below everything — the lines between stayed where they were, so they say only that much. The first and last line
 * appear in the most pairs, which is how the learner tells the swapped pair apart (`swapPairWeights`).
 */
export function choicesFromSwap(order: string[], dragId: string): LineChoice[] {
  if (order.length < 2) return [];
  const top = order[0];
  const bottom = order[order.length - 1];
  const between = order.slice(1, -1);
  return choicesFromDrag(
    [
      { favored: top, overtaken: bottom },
      ...between.map((l) => ({ favored: top, overtaken: l })),
      ...between.map((l) => ({ favored: l, overtaken: bottom })),
    ],
    dragId
  );
}

/**
 * New drag choices joined to the pilot's earlier ones. The latest word on two lines wins: an older drag that put them
 * the other way round stops counting — set aside, not deleted, so undoing this drag brings it back (`withoutDrag`).
 * Without a drag to name, it's dropped.
 */
export function addDragChoices(existing: LineChoice[], added: LineChoice[]): LineChoice[] {
  const reversedBy = new Map(added.map((c) => [`${c.other}>${c.preferred}`, c.dragId]));
  const kept = existing.flatMap((c) => {
    const key = `${c.preferred}>${c.other}`;
    if (!c.direct || c.supersededBy || !reversedBy.has(key)) return [c];
    const by = reversedBy.get(key);
    return by ? [{ ...c, supersededBy: by }] : [];
  });
  return [...kept, ...added];
}

/** The pilot's choices without the ones a drag added — undoing that drag — and whatever it had set aside counting again. */
export function withoutDrag(choices: LineChoice[], dragId: string): LineChoice[] {
  return choices
    .filter((c) => c.dragId !== dragId)
    .map((c) => {
      if (c.supersededBy !== dragId) return c;
      const back = { ...c };
      delete back.supersededBy;
      return back;
    });
}

/** "Counting more: …; less: …" — what a change did to the pilot's priorities (each one's share of all the weight), in a sentence. */
export function describeChanges(changes: WeightChange[]): string | null {
  const up = changes.filter((c) => c.to > c.from).sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 2);
  const down = changes.filter((c) => c.to < c.from).sort((a, b) => a.to - a.from - (b.to - b.from)).slice(0, 2);
  if (!up.length && !down.length) return null;
  return [up.length ? `counting more: ${up.map((c) => c.label).join(", ")}` : "", down.length ? `counting less: ${down.map((c) => c.label).join(", ")}` : ""].filter(Boolean).join("; ");
}
