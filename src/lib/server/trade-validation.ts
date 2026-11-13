import type { BidPackMetaSnapshot, TradeHolding, TripSnapshot } from "@/types/trade";

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
  // Which trip on which day. Optional, as an app still open from before they were sent leaves them out.
  if (v.tripId !== undefined && !short(v.tripId, 80)) return null;
  if (v.startDayIndex !== undefined && v.startDayIndex !== null && !(num(v.startDayIndex, 0, 62) && Number.isInteger(v.startDayIndex))) return null;
  if (v.date !== undefined && v.date !== null && !(typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date))) return null;
  const day = {
    ...(v.tripId !== undefined && { tripId: v.tripId as string }),
    ...(v.startDayIndex !== undefined && { startDayIndex: v.startDayIndex as number | null }),
    ...(v.date !== undefined && { date: v.date as string | null }),
  };
  return {
    ...day,
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

/** Said when a pilot posts to, or answers an offer on, a board for a seat's month they don't fly (`pilotHasSeatMonth`). */
export const NOT_YOUR_SEAT = "You can only trade in a bid pack you fly. Save that bid pack to your account, or mark what you hold in it, first.";
/** Said when the trip offered isn't one of those they marked as theirs. */
export const NOT_YOUR_TRIP = "That trip isn't one you've marked as yours in this bid pack.";

/**
 * Whether a pilot who has confirmed what they hold in a pack may offer or give this trip: one of their held trips,
 * on its date, that they haven't marked as one they can't trade. The board only lists those (`pilotTrips`), so a
 * trip outside them was made up. With no holding confirmed there's nothing to check it against, and any trip passes,
 * as before holdings were kept.
 */
export function tripIsHeld(holding: Pick<TradeHolding, "trips"> | null, trip: Pick<TripSnapshot, "tripId" | "startDayIndex">): boolean {
  if (!holding) return true;
  return holding.trips.some((h) => h.lock === null && h.id === trip.tripId && h.startDayIndex === trip.startDayIndex);
}
