/**
 * Contract-aware polling DESIGN for the open-time feed (step-8 phase 4), as a pure decision function behind a clear
 * interface. It decides *whether and when* to read a pilot's open time next; the actual reading is the stubbed
 * `FedexClient` (see `fedex-client.ts`), which does nothing against FedEx yet.
 *
 * The hard limits this enforces (step-8 "Limits on this plan", hard limit 3):
 *   - Each pilot is polled on their OWN connection only. There is no shared-across-pilots feed here — spreading requests
 *     across pilots to beat a per-pilot limit is a separate owner + lawyer decision, and is NOT built.
 *   - Stay well below the per-pilot daily open-time quota and STOP when it's reached. The quota size is UNKNOWN until
 *     phase-1 discovery, so it's a parameter, set conservatively.
 *   - Back off automatically on errors. Never hammer, never disguise traffic, never rotate addresses to dodge a block.
 *
 * Timing against the contract: the 5-minute real-time holds (CBA 2026 25.L.1.a.i, from August 2027) and the hold
 * countdown are already computed by the open-time engine (`realTimeTiming` in `rules.ts`) off each row's `appearedAt`.
 * The poller doesn't re-implement that; it only governs read cadence so the feed is fresh enough to show a live hold
 * without reading faster than we need to.
 */

/** A clock, injected so the decision is testable. */
export type Now = () => number;

export interface PollerConfig {
  /** Base interval between reads, ms. "As slow as still wins" (step-8 phase 4). Firmed up from phase-1 discovery. */
  baseIntervalMs: number;
  /** The per-pilot daily quota we will not exceed. UNKNOWN until phase 1 — set conservatively well below the real cap. */
  dailyQuota: number;
  /** Multiplier applied to the interval per consecutive error, capped by `maxBackoffMs`. */
  backoffFactor: number;
  maxBackoffMs: number;
}

/** Sensible, deliberately cautious defaults until phase-1 discovery gives real numbers. */
export const DEFAULT_POLLER_CONFIG: PollerConfig = {
  baseIntervalMs: 90_000, // 90s: frequent enough to show a 5-minute hold, slow enough to be polite.
  dailyQuota: 100, // placeholder; the real per-pilot cap is unknown and this stays well under any plausible value.
  backoffFactor: 2,
  maxBackoffMs: 30 * 60_000, // 30 minutes.
};

/** The poller's view of one pilot's connection, enough to decide the next read. */
export interface PollerState {
  /** When the last read happened (epoch ms), or null if none yet. */
  lastReadAt: number | null;
  /** Consecutive errors since the last success; drives back-off. */
  consecutiveErrors: number;
  /** Reads spent in the current quota day. */
  usedToday: number;
  /** "YYYY-MM-DD" base-local day the count belongs to; a new day resets `usedToday`. */
  quotaDay: string | null;
  /** When the FedEx session expires (epoch ms), or null. Past this, don't read — the pilot signs in again. */
  sessionExpiresAt: number | null;
}

export type PollDecision =
  | { read: true; reason: "due" }
  | { read: false; reason: "too-soon"; nextAtMs: number }
  | { read: false; reason: "quota-reached" }
  | { read: false; reason: "session-expired" };

/**
 * Decide whether to read now. Pure: same inputs, same answer. `today` is the pilot's base-local "YYYY-MM-DD" so the
 * quota resets on their day, not UTC.
 */
export function decidePoll(state: PollerState, config: PollerConfig, now: Now, today: string): PollDecision {
  const t = now();

  if (state.sessionExpiresAt !== null && t >= state.sessionExpiresAt) {
    return { read: false, reason: "session-expired" };
  }

  // A new quota day resets the count; otherwise honour what's been spent.
  const usedToday = state.quotaDay === today ? state.usedToday : 0;
  if (usedToday >= config.dailyQuota) {
    return { read: false, reason: "quota-reached" };
  }

  if (state.lastReadAt === null) {
    return { read: true, reason: "due" };
  }

  const interval = backoffInterval(state.consecutiveErrors, config);
  const nextAtMs = state.lastReadAt + interval;
  return t >= nextAtMs ? { read: true, reason: "due" } : { read: false, reason: "too-soon", nextAtMs };
}

/** The current interval given consecutive errors: base × factor^errors, capped. No errors → base interval. */
export function backoffInterval(consecutiveErrors: number, config: PollerConfig): number {
  if (consecutiveErrors <= 0) return config.baseIntervalMs;
  const scaled = config.baseIntervalMs * config.backoffFactor ** consecutiveErrors;
  return Math.min(scaled, config.maxBackoffMs);
}

/** State after a successful read: count it against the quota, clear the error streak. */
export function afterSuccess(state: PollerState, now: Now, today: string): PollerState {
  const usedToday = state.quotaDay === today ? state.usedToday : 0;
  return { ...state, lastReadAt: now(), consecutiveErrors: 0, usedToday: usedToday + 1, quotaDay: today };
}

/** State after a failed read: back off, but a failed read still counts against the quota (FedEx saw the request). */
export function afterError(state: PollerState, now: Now, today: string): PollerState {
  const usedToday = state.quotaDay === today ? state.usedToday : 0;
  return { ...state, lastReadAt: now(), consecutiveErrors: state.consecutiveErrors + 1, usedToday: usedToday + 1, quotaDay: today };
}
