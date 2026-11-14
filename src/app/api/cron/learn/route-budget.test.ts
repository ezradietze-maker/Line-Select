import { afterEach, describe, expect, it, vi } from "vitest";

/** The daily run has Vercel's five minutes for everything: the learning, the trades, then the morning email. */
const learningTakes = vi.hoisted(() => ({ ms: 0 }));
vi.mock("@/lib/server/learning-runner", () => ({
  runLearningCycle: vi.fn(async (trigger: string) => {
    vi.setSystemTime(Date.now() + learningTakes.ms);
    return { trigger, results: [] };
  }),
}));
vi.mock("@/lib/server/kv", () => ({ incrementCounter: async () => 1 }));
const matching = vi.hoisted(() => ({
  DAILY_MATCHING_BUDGET_MS: 120_000,
  runDailyMatching: vi.fn<(now?: Date, budgetMs?: number) => Promise<{ groups: number; skipped: number; found: number; failed: number; notReached: number }>>(async () => ({ groups: 0, skipped: 0, found: 0, failed: 0, notReached: 0 })),
  tradeSummaryText: vi.fn(async () => null),
}));
vi.mock("@/lib/server/trade-matching", () => matching);
const alerts = vi.hoisted(() => ({ sendDailySummary: vi.fn(async () => true), reportProblem: vi.fn(async () => {}) }));
vi.mock("@/lib/server/alerts", () => alerts);
vi.mock("@/lib/server/weekly-summary", () => ({ weeklySection: async () => null }));
vi.mock("@/lib/server/db", () => ({ deleteUnconfirmedSignUps: async () => 0 }));

import { GET as cron, maxDuration } from "./route";

const call = () => cron(new Request("http://x/api/cron/learn", { headers: { authorization: "Bearer s3cret" } }));

describe("the daily run's time", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    matching.runDailyMatching.mockClear();
  });

  it("gives the trades only what the learning left, with room for the email", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T09:00:00Z"));
    learningTakes.ms = 250_000;
    await call();
    const budget = matching.runDailyMatching.mock.calls[0][1];
    expect(budget).toBeDefined();
    expect(250_000 + budget!).toBeLessThan(maxDuration * 1000 - 20_000);
    expect(alerts.sendDailySummary).toHaveBeenCalled();
  });

  it("gives them their usual two minutes after a quick learning run", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T09:00:00Z"));
    learningTakes.ms = 5_000;
    await call();
    expect(matching.runDailyMatching.mock.calls[0][1]).toBe(120_000);
  });
});
