import type { RangeTarget } from "@/types/preferences";

export type TargetRole = "min" | "ideal" | "max";

export interface TargetParts {
  min?: number;
  ideal?: number;
  max?: number;
}

/** Normalizes today's two stored shapes — a bare number (a single pinned ideal) or a `RangeTarget` — into one editable shape. */
export function targetParts(value: number | RangeTarget | undefined): TargetParts {
  if (value === undefined) return {};
  return typeof value === "number" ? { ideal: value } : { min: value.min, ideal: value.ideal, max: value.max };
}

/** The inverse of `targetParts`: a lone ideal stays a bare number (exactly what the rest of the app has always stored), anything richer becomes a `RangeTarget`, nothing at all is `undefined`. */
export function buildTarget(parts: TargetParts): number | RangeTarget | undefined {
  const { min, ideal, max } = parts;
  if (min === undefined && ideal === undefined && max === undefined) return undefined;
  if (min === undefined && max === undefined) return ideal;
  const range: RangeTarget = {};
  if (min !== undefined) range.min = min;
  if (ideal !== undefined) range.ideal = ideal;
  if (max !== undefined) range.max = max;
  return range;
}

/**
 * Sets one role and nudges the others just enough to keep floor <= ideal <=
 * ceiling — dragging the floor above the ideal drags the ideal up with it
 * instead of leaving an impossible band that would score every line wrong.
 */
export function setTargetRole(parts: TargetParts, role: TargetRole, value: number): TargetParts {
  const next: TargetParts = { ...parts, [role]: value };
  if (role === "min") {
    if (next.ideal !== undefined && next.ideal < value) next.ideal = value;
    if (next.max !== undefined && next.max < value) next.max = value;
  } else if (role === "max") {
    if (next.ideal !== undefined && next.ideal > value) next.ideal = value;
    if (next.min !== undefined && next.min > value) next.min = value;
  } else {
    if (next.min !== undefined && next.min > value) next.min = value;
    if (next.max !== undefined && next.max < value) next.max = value;
  }
  return next;
}
