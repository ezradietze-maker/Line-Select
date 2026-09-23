export type Seat = "CAP" | "FO";

/**
 * Which seat the preview screen should have pre-selected. A pack with both
 * seats must never silently default to the first one — a First Officer who
 * clicks straight through would be ranked against Captain lines without ever
 * being shown a choice was made. The only safe pre-selections are: the only
 * seat present, or the seat the pilot's currently loaded (non-sample) bid
 * pack already uses, which is a real prior choice of theirs, not a guess.
 */
export function initialSeat(availableSeats: Seat[], previousSeat: Seat | null): Seat | undefined {
  if (availableSeats.length === 1) return availableSeats[0];
  if (previousSeat && availableSeats.includes(previousSeat)) return previousSeat;
  return undefined;
}

/** Whether enough lines lack a verified trip-by-trip breakdown that the pilot needs to be told plainly, not just in fine print. */
export function shouldWarnAboutEstimatedLines(estimatedCount: number, totalCount: number): boolean {
  if (totalCount === 0) return false;
  return estimatedCount / totalCount >= 0.05;
}
