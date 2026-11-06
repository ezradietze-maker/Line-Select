import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, number>();
vi.mock("@/lib/server/kv", () => ({
  getJson: async (key: string) => store.get(key) ?? null,
  addToCounter: async (key: string, amount: number) => {
    const next = (store.get(key) ?? 0) + amount;
    store.set(key, next);
    return next;
  },
  incrementCounter: async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  },
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => null }));
const sent: { to: string; subject: string }[] = [];
vi.mock("@/lib/server/email", () => ({
  sendEmail: async (m: { to: string; subject: string }) => {
    sent.push(m);
    return true;
  },
}));

const { checkSpend, recordSpend, spenderFor, spendLimitResponse } = await import("./spend-guard");

const pilot = { key: "u:pilot-1", signedIn: true };
const otherPilot = { key: "u:pilot-2", signedIn: true };
const guest = { key: "ip:203.0.113.9", signedIn: false };
const day = new Date("2026-11-05T15:00:00Z");
const nextDay = new Date("2026-11-06T00:30:00Z");

beforeEach(() => {
  store.clear();
  sent.length = 0;
  delete process.env.SPEND_SITE_DAILY_USD;
  delete process.env.SPEND_PILOT_DAILY_USD;
  delete process.env.SPEND_GUEST_DAILY_USD;
  process.env.ALERT_EMAIL = "owner@example.com";
});

describe("spend guard", () => {
  it("lets a pilot spend up to their $8 a day, then stops them until the next day", async () => {
    expect(await checkSpend(pilot, { now: day })).toEqual({ ok: true });
    await recordSpend(pilot, 7.99, { now: day });
    expect(await checkSpend(pilot, { now: day })).toEqual({ ok: true });
    await recordSpend(pilot, 0.02, { now: day });
    expect(await checkSpend(pilot, { now: day })).toEqual({ ok: false, scope: "pilot" });
    expect(await checkSpend(otherPilot, { now: day })).toEqual({ ok: true });
    expect(await checkSpend(pilot, { now: nextDay })).toEqual({ ok: true });
  });

  it("gives a guest $2 a day", async () => {
    await recordSpend(guest, 2, { now: day });
    expect(await checkSpend(guest, { now: day })).toEqual({ ok: false, scope: "pilot" });
  });

  it("stops everyone once the site's $100 is spent, and emails once", async () => {
    for (let i = 0; i < 20; i++) await recordSpend({ key: `u:p${i}`, signedIn: true }, 5, { now: day });
    expect(await checkSpend(otherPilot, { now: day })).toEqual({ ok: false, scope: "site" });
    await recordSpend(pilot, 1, { now: day });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("owner@example.com");
  });

  it("charges hotel lookups to the site only", async () => {
    for (let i = 0; i < 100; i++) await recordSpend(guest, 0.15, { siteOnly: true, now: day });
    expect(await checkSpend(guest, { now: day })).toEqual({ ok: true });
    expect(await checkSpend(guest, { siteOnly: true, now: day })).toEqual({ ok: true });
  });

  it("reads its ceilings from the environment", async () => {
    process.env.SPEND_PILOT_DAILY_USD = "1";
    await recordSpend(pilot, 1, { now: day });
    expect(await checkSpend(pilot, { now: day })).toEqual({ ok: false, scope: "pilot" });
  });

  it("ignores zero and missing costs", async () => {
    await recordSpend(pilot, 0, { now: day });
    await recordSpend(pilot, Number.NaN, { now: day });
    expect(store.size).toBe(0);
  });

  it("charges a guest to their device and to their address", async () => {
    const device = "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b";
    const withCookie = new Request("https://example.com", { headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1", cookie: `theme=dark; ls_device=${device}` } });
    expect(await spenderFor(withCookie)).toEqual({ key: `device:${device}`, signedIn: false, addressKey: "address:198.51.100.4" });
    const noCookie = new Request("https://example.com", { headers: { "x-forwarded-for": "198.51.100.4" } });
    expect(await spenderFor(noCookie)).toEqual({ key: "ip:198.51.100.4", signedIn: false, addressKey: "address:198.51.100.4" });
  });

  it("gives each guest in a crew room their own $2, up to $10 for the address", async () => {
    const guest = (n: number) => ({ key: `device:${n}`, signedIn: false, addressKey: "address:203.0.113.1" });
    for (let n = 0; n < 4; n++) await recordSpend(guest(n), 2, { now: day });
    expect(await checkSpend(guest(0), { now: day })).toEqual({ ok: false, scope: "pilot" });
    expect(await checkSpend(guest(4), { now: day })).toEqual({ ok: true });
    await recordSpend(guest(4), 2, { now: day });
    expect(await checkSpend(guest(5), { now: day })).toEqual({ ok: false, scope: "pilot" });
    expect(await checkSpend({ key: "device:x", signedIn: false, addressKey: "address:198.51.100.7" }, { now: day })).toEqual({ ok: true });
  });

  it("answers a stopped call with a 429 the app already shows", async () => {
    const res = spendLimitResponse({ ok: false, scope: "site" });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/resting until tomorrow/);
  });
});
