import type { BidPackMetaSnapshot, TripSnapshot } from "@/types/trade";

const REPORT_TIMES = new Set(["early", "afternoon", "evening"]);

const short = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const num = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/**
 * Rebuilds a trip snapshot from a request body field by field, so only the
 * fields the board actually shows are stored — whatever else a client stuffed
 * into the object (or however large it made it) never reaches the shared
 * store other pilots read from. null when a required field is missing or out
 * of range.
 */
export function sanitizeTripSnapshot(value: unknown): TripSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!short(v.lineNumber, 12)) return null;
  if (v.pairingNumber !== null && !short(v.pairingNumber, 12)) return null;
  if (!num(v.days, 1, 30) || !num(v.creditHours, 0, 400) || !num(v.tafbHours, 0, 1000) || !num(v.landings, 0, 200) || !num(v.deadheadLegs, 0, 200)) return null;
  if (typeof v.international !== "boolean" || !REPORT_TIMES.has(v.reportTime as string)) return null;
  if (!Array.isArray(v.layoverCities) || v.layoverCities.length > 40 || !v.layoverCities.every((c) => short(c, 6))) return null;
  return {
    lineNumber: v.lineNumber,
    pairingNumber: v.pairingNumber as string | null,
    days: v.days,
    layoverCities: v.layoverCities as string[],
    international: v.international,
    reportTime: v.reportTime as TripSnapshot["reportTime"],
    creditHours: v.creditHours,
    tafbHours: v.tafbHours,
    landings: v.landings,
    deadheadLegs: v.deadheadLegs,
  };
}

export function sanitizeBidPackMeta(value: unknown): BidPackMetaSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!short(v.base, 12) || !short(v.aircraft, 20) || !short(v.seat, 8) || !short(v.month, 12)) return null;
  return { base: v.base, aircraft: v.aircraft, seat: v.seat, month: v.month };
}
