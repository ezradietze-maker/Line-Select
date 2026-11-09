import { describe, expect, it } from "vitest";
import { DEFAULT_POLLER_CONFIG, afterError, afterSuccess, backoffInterval, decidePoll, type PollerState } from "@/lib/fedex-connect/poller";

const DAY = "2026-11-08";
const base: PollerState = { lastReadAt: null, consecutiveErrors: 0, usedToday: 0, quotaDay: null, sessionExpiresAt: null };

describe("decidePoll", () => {
  it("reads when nothing has been read yet", () => {
    expect(decidePoll(base, DEFAULT_POLLER_CONFIG, () => 1000, DAY)).toEqual({ read: true, reason: "due" });
  });

  it("waits until the interval has passed", () => {
    const state: PollerState = { ...base, lastReadAt: 1000, quotaDay: DAY, usedToday: 1 };
    const soon = decidePoll(state, DEFAULT_POLLER_CONFIG, () => 1000 + DEFAULT_POLLER_CONFIG.baseIntervalMs - 1, DAY);
    expect(soon.read).toBe(false);
    const due = decidePoll(state, DEFAULT_POLLER_CONFIG, () => 1000 + DEFAULT_POLLER_CONFIG.baseIntervalMs, DAY);
    expect(due).toEqual({ read: true, reason: "due" });
  });

  it("stops at the daily quota and resets on a new day", () => {
    const maxed: PollerState = { ...base, usedToday: DEFAULT_POLLER_CONFIG.dailyQuota, quotaDay: DAY, lastReadAt: 1 };
    expect(decidePoll(maxed, DEFAULT_POLLER_CONFIG, () => 1e9, DAY)).toEqual({ read: false, reason: "quota-reached" });
    // A new day clears the count, so it reads again.
    expect(decidePoll(maxed, DEFAULT_POLLER_CONFIG, () => 1e9, "2026-11-09").read).toBe(true);
  });

  it("does not read once the session has expired", () => {
    const expired: PollerState = { ...base, sessionExpiresAt: 500 };
    expect(decidePoll(expired, DEFAULT_POLLER_CONFIG, () => 1000, DAY)).toEqual({ read: false, reason: "session-expired" });
  });

  it("backs off further with each consecutive error, capped", () => {
    expect(backoffInterval(0, DEFAULT_POLLER_CONFIG)).toBe(DEFAULT_POLLER_CONFIG.baseIntervalMs);
    expect(backoffInterval(1, DEFAULT_POLLER_CONFIG)).toBe(DEFAULT_POLLER_CONFIG.baseIntervalMs * 2);
    expect(backoffInterval(2, DEFAULT_POLLER_CONFIG)).toBe(DEFAULT_POLLER_CONFIG.baseIntervalMs * 4);
    expect(backoffInterval(100, DEFAULT_POLLER_CONFIG)).toBe(DEFAULT_POLLER_CONFIG.maxBackoffMs);
  });
});

describe("state transitions", () => {
  it("counts a success against the quota and clears errors", () => {
    const after = afterSuccess({ ...base, consecutiveErrors: 3 }, () => 2000, DAY);
    expect(after).toMatchObject({ lastReadAt: 2000, consecutiveErrors: 0, usedToday: 1, quotaDay: DAY });
  });

  it("counts a failed read against the quota too and grows the error streak", () => {
    const after = afterError({ ...base, usedToday: 2, quotaDay: DAY, consecutiveErrors: 1 }, () => 3000, DAY);
    expect(after).toMatchObject({ lastReadAt: 3000, consecutiveErrors: 2, usedToday: 3 });
  });
});
