import { applyCityRatings } from "@/lib/brain/city-ratings";
import { fitWeightsToChoices, type WeightChange } from "@/lib/brain/fit-choices";
import type { PackMetrics } from "@/lib/metrics/compute";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice, PilotModel } from "@/types/pilot-model";
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

/** The pilot model for a confirmed base: city grades in, fitted to every choice, then the pilot's own settings on top. */
export function deriveModel(
  bidPack: BidPack,
  base: PilotModel,
  profile: Pick<PreferenceProfile, "cityRatings">,
  choices: LineChoice[],
  pack?: PackMetrics,
  pins: Record<string, number> = {}
): { model: PilotModel; changes: WeightChange[] } {
  const rated = applyCityRatings(base, profile.cityRatings);
  const fit = fitWeightsToChoices(bidPack, rated, choices, pack);
  return { model: applyPins(fit.model, pins), changes: fit.changes };
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
): { profile: PreferenceProfile; changes: WeightChange[] } {
  const base = update.base ?? baseModelOf(profile);
  if (!base) return { profile, changes: [] };
  const choices = update.choices ?? profile.brainInterview?.choices ?? [];
  const next = { ...profile, ...(update.cityRatings ? { cityRatings: update.cityRatings } : {}) };
  // Changes are reported against the model the pilot was looking at a moment ago.
  const before = profile.pilotModel ?? base;
  const pins = update.pins ?? profile.brainInterview?.pins ?? {};
  const { model } = deriveModel(bidPack, base, next, choices, pack, pins);
  const changes = model.criteria
    .map((c) => ({ criterionId: c.id, label: c.label, from: before.criteria.find((x) => x.id === c.id)?.weight ?? 0, to: c.weight }))
    .filter((x) => Math.abs(x.to - x.from) >= 0.03);
  return {
    profile: {
      ...next,
      pilotModel: model,
      brainInterview: { exchanges: profile.brainInterview?.exchanges ?? [], ...profile.brainInterview, choices, reviewedModel: base, pins },
    },
    changes,
  };
}

/** A drag on the results: the moved line was put above (or below) each line it passed — one choice per line passed. */
export function choicesFromDrag(passed: { favored: string; overtaken: string }[]): LineChoice[] {
  return passed.map((p) => ({ preferred: p.favored, other: p.overtaken, strength: "slightly" as const, direct: true }));
}

/** "Counting more: …; less: …" — what a change did to the pilot's priorities, in a sentence. */
export function describeChanges(changes: WeightChange[]): string | null {
  const up = changes.filter((c) => c.to > c.from).sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 2);
  const down = changes.filter((c) => c.to < c.from).sort((a, b) => a.to - a.from - (b.to - b.from)).slice(0, 2);
  if (!up.length && !down.length) return null;
  return [up.length ? `counting more: ${up.map((c) => c.label).join(", ")}` : "", down.length ? `counting less: ${down.map((c) => c.label).join(", ")}` : ""].filter(Boolean).join("; ");
}
