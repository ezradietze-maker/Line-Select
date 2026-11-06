import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, number>();
vi.mock("@/lib/server/kv", () => ({
  getJson: async (key: string) => store.get(key) ?? null,
  incrementCounter: async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  },
  addToCounter: async (key: string, amount: number) => {
    const next = (store.get(key) ?? 0) + amount;
    store.set(key, next);
    return next;
  },
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => null }));
vi.mock("@/lib/server/posthog", () => ({ posthogServer: null }));
const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/server/email", () => ({
  sendEmail: async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
    return true;
  },
}));

const { dailySummaryText, noteActivity, reportProblem, sendDailySummary, summarizeDay } = await import("./alerts");
const { recordSpend } = await import("./spend-guard");

const at = new Date("2026-11-05T15:10:00Z");
const laterSameHour = new Date("2026-11-05T15:50:00Z");
const nextHour = new Date("2026-11-05T16:05:00Z");

beforeEach(() => {
  store.clear();
  sent.length = 0;
  process.env.ALERT_EMAIL = "owner@example.com";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reportProblem", () => {
  it("emails on the hour's third failure of a kind, and only once that hour", async () => {
    await reportProblem("brain-build", new Error("overloaded_error"), {}, at);
    await reportProblem("brain-build", new Error("overloaded_error"), {}, at);
    expect(sent).toHaveLength(0);
    await reportProblem("brain-build", new Error("overloaded_error"), {}, laterSameHour);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/brain reads/i);
    expect(sent[0].text).toMatch(/3 failures in the last hour/);
    expect(sent[0].text).toMatch(/overloaded_error/);
    await reportProblem("brain-build", new Error("overloaded_error"), {}, laterSameHour);
    expect(sent).toHaveLength(1);
  });

  it("counts each kind and each hour apart", async () => {
    await reportProblem("hotels", "x", {}, at);
    await reportProblem("hotels", "x", {}, at);
    await reportProblem("dictation", "x", {}, at);
    await reportProblem("hotels", "x", {}, nextHour);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing without an address, and never throws", async () => {
    delete process.env.ALERT_EMAIL;
    for (let i = 0; i < 3; i++) await reportProblem("brain-ask", new Error("x"), {}, at);
    expect(sent).toHaveLength(0);
  });
});

describe("the daily summary", () => {
  it("adds up the day's spend, activity and failures", async () => {
    await recordSpend({ key: "u:p1", signedIn: true }, 3.5, { now: at });
    await noteActivity("brain-read", at);
    await noteActivity("brain-read", at);
    await noteActivity("pack-parsed", at);
    await reportProblem("hotels", "Google down", {}, at);
    const s = await summarizeDay("2026-11-05");
    expect(s.spentUsd).toBeCloseTo(3.5);
    expect(s.activity).toEqual({ "brain-read": 2, "interview-question": 0, ask: 0, "pack-parsed": 1 });
    expect(s.problems).toEqual({ hotels: 1 });
  });

  it("says what the learning run did, failures first in the subject", async () => {
    await reportProblem("flights", "timeout", {}, at);
    const learning = { trigger: "schedule", results: [{ kind: "brain", version: "b-1", promoted: true }, { step: "learnCalibration", error: "db down" }, { kind: "forecast-calibration", skipped: "12 checked forecasts so far" }] };
    expect(await sendDailySummary(learning, new Date("2026-11-06T09:00:00Z"))).toBe(true);
    expect(sent[0].subject).toBe("Line Select daily: something needs a look (2026-11-05)");
    expect(sent[0].text).toMatch(/Flight lookups: 1/);
    expect(sent[0].text).toMatch(/brain: new version in use/);
    expect(sent[0].text).toMatch(/learnCalibration: FAILED — db down/);
    expect(sent[0].text).toMatch(/skipped \(12 checked/);
  });

  it("reads all clear on a quiet day", () => {
    const text = dailySummaryText({ day: "2026-11-05", spentUsd: 0, activity: { "brain-read": 0, "interview-question": 0, ask: 0, "pack-parsed": 0 }, problems: {} }, { results: [] });
    expect(text).toMatch(/Failures: none/);
  });
});
