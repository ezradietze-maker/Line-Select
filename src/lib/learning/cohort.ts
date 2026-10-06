/**
 * Who a pilot is bidding alongside, for learning purposes — the groups the
 * fleet-wide learning keeps separate statistics for. Learned answers are
 * read from the most specific group that has enough pilots in it, and every
 * group borrows strength from the broader ones above it until it does (see
 * `blendLevels` in `interview-learning.ts`). Nothing here identifies a
 * pilot: these are the same coarse facts printed on every bid pack.
 */

export type CommuteGroup = "commuter" | "local" | "unknown";
export type SeniorityBand = "senior" | "middle" | "junior" | "unknown";

export interface Cohort {
  base: string;
  aircraft: string;
  seat: string;
  commute: CommuteGroup;
  seniority: SeniorityBand;
}

export function commuteGroupOf(isCommuter: boolean | null | undefined): CommuteGroup {
  return isCommuter === true ? "commuter" : isCommuter === false ? "local" : "unknown";
}

/** Thirds of the bid order: the top third bids first. `percentile` is 1 for the most senior pilot, 0 for the most junior. */
export function seniorityBandOf(percentile: number | null | undefined): SeniorityBand {
  if (percentile === null || percentile === undefined || !Number.isFinite(percentile)) return "unknown";
  return percentile >= 2 / 3 ? "senior" : percentile >= 1 / 3 ? "middle" : "junior";
}

/** 1 = most senior, 0 = most junior, from a 1-based bid position. */
export function bidPercentile(bidNumber: number, totalPilots: number): number | null {
  if (!Number.isFinite(bidNumber) || !Number.isFinite(totalPilots) || totalPilots <= 1 || bidNumber < 1) return null;
  return Math.min(1, Math.max(0, 1 - (bidNumber - 1) / (totalPilots - 1)));
}

const norm = (s: string) => s.trim().toUpperCase();

/**
 * The groups a pilot belongs to, broadest first — the whole fleet, then
 * their seat, then seat and commute, then their exact base/aircraft/seat,
 * then that with commute. Learned statistics are blended down this list:
 * each level starts from the one above and moves toward its own data as
 * its own pilots accumulate.
 */
export function cohortLevels(c: Pick<Cohort, "base" | "aircraft" | "seat" | "commute">): string[] {
  const seat = norm(c.seat);
  const pack = `${norm(c.base)}|${norm(c.aircraft)}|${seat}`;
  return ["all", `seat:${seat}`, `seat:${seat}|${c.commute}`, `pack:${pack}`, `pack:${pack}|${c.commute}`];
}
