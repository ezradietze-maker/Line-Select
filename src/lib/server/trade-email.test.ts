import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; text: string }[] = [];
const counters = new Map<string, number>();
let targets = new Map<string, string>();
let configured = true;
vi.mock("@/lib/server/email", () => ({
  getEmailConfig: () => (configured ? { appUrl: "https://example.com" } : null),
  sendEmail: async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
    return true;
  },
}));
vi.mock("@/lib/server/kv", () => ({
  incrementCounter: async (k: string) => {
    counters.set(k, (counters.get(k) ?? 0) + 1);
    return counters.get(k)!;
  },
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimit: async (bucket: string, id: string, limit: number) => {
    const k = `${bucket}:${id}`;
    counters.set(k, (counters.get(k) ?? 0) + 1);
    return { ok: counters.get(k)! <= limit };
  },
}));
vi.mock("@/lib/server/trade-suggestions", () => ({ listTradeEmailTargets: async () => targets }));

const { emailNewTrade } = await import("./trade-email");

const member = (n: number) => ({ userId: `u${n}`, displayName: `Pilot ${n}`, position: n, give: { pairingNumber: `${n}00`, date: "2026-12-05" }, value: { gain: 9, reasons: [{ label: "secret reason" }] } });
const trade = (size = 3) => ({ members: Array.from({ length: size }, (_, i) => member(i)) }) as never;

beforeEach(() => {
  sent.length = 0;
  counters.clear();
  targets = new Map();
  configured = true;
});

describe("the trade email", () => {
  it("goes only to pilots who turned it on, once each", async () => {
    targets = new Map([["u1", "one@example.com"]]);
    expect(await emailNewTrade(trade())).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(["one@example.com"]);
  });

  it("says what they'd give and get, and how to answer and stop", async () => {
    targets = new Map([["u1", "one@example.com"]]);
    await emailNewTrade(trade());
    const { text } = sent[0];
    expect(text).toContain("give Pairing 100 on Dec 5");
    expect(text).toContain("get Pairing 200 on Dec 5");
    expect(text).toContain("chain of 3 pilots");
    expect(text).toContain("https://example.com/trade-board");
    expect(text).toContain("turn them off");
  });

  it("doesn't carry anyone's score, reasons or other pilots' names", async () => {
    targets = new Map([["u1", "one@example.com"]]);
    await emailNewTrade(trade());
    expect(sent[0].text).not.toContain("secret");
    expect(sent[0].text).not.toContain("Pilot 0");
    expect(sent[0].text).not.toContain("9");
  });

  it("holds one pilot to two a day, however many trades come and go", async () => {
    targets = new Map([["u0", "zero@example.com"]]);
    for (let i = 0; i < 4; i++) await emailNewTrade(trade());
    expect(sent).toHaveLength(2);
  });

  it("stops for the whole site at 30 an hour, so password resets keep their quota", async () => {
    const big = Array.from({ length: 40 }, (_, i) => [`u${i}`, `p${i}@example.com`] as const);
    targets = new Map(big);
    const members = Array.from({ length: 40 }, (_, i) => member(i));
    await emailNewTrade({ members } as never);
    expect(sent).toHaveLength(30);
  });

  it("does nothing, quietly, until email is set up", async () => {
    configured = false;
    targets = new Map([["u1", "one@example.com"]]);
    expect(await emailNewTrade(trade())).toBe(0);
    expect(sent).toEqual([]);
  });

  it("never throws: a failed email can't undo a trade", async () => {
    targets = null as never;
    await expect(emailNewTrade(trade())).resolves.toBe(0);
  });
});
