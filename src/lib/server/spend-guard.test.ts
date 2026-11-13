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
  takeSlot: async (key: string, limit: number) => {
    const held = store.get(key) ?? 0;
    if (held >= limit) return false;
    store.set(key, held + 1);
    return true;
  },
  releaseSlot: async (key: string) => {
    const held = (store.get(key) ?? 0) - 1;
    if (held > 0) store.set(key, held);
    else store.delete(key);
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

const { checkSpend, pilotSpender, recordSpend, spenderFor, spendLimitResponse, startPaidCall } = await import("./spend-guard");

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
  delete process.env.SPEND_IN_FLIGHT_PER_PILOT;
  delete process.env.SPEND_IN_FLIGHT_PER_ADDRESS;
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

  it("charges a signed-in pilot to their address too, apart from its guests", () => {
    const req = new Request("https://example.com", { headers: { "x-forwarded-for": "198.51.100.4" } });
    expect(pilotSpender("p1", req)).toEqual({ key: "u:p1", signedIn: true, addressKey: "pilot-address:198.51.100.4" });
  });

  it("stops accounts made on one address at $30 between them, well short of the site's $100", async () => {
    const account = (n: number) => ({ key: `u:fake-${n}`, signedIn: true, addressKey: "pilot-address:203.0.113.5" });
    for (let n = 0; n < 3; n++) await recordSpend(account(n), 8, { now: day });
    expect(await checkSpend(account(3), { now: day })).toEqual({ ok: true });
    await recordSpend(account(3), 6, { now: day });
    expect(await checkSpend(account(4), { now: day })).toEqual({ ok: false, scope: "pilot" });
    // Pilots elsewhere, and guests on that address, aren't touched.
    expect(await checkSpend({ key: "u:elsewhere", signedIn: true, addressKey: "pilot-address:198.51.100.7" }, { now: day })).toEqual({ ok: true });
    expect(await checkSpend({ key: "device:g", signedIn: false, addressKey: "address:203.0.113.5" }, { now: day })).toEqual({ ok: true });
  });

  it("answers a stopped call with a 429 the app already shows", async () => {
    const res = spendLimitResponse({ ok: false, scope: "site" });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/resting until tomorrow/);
  });
});

describe("a feature's own allowance", () => {
  it("is kept apart from the AI's: spending one leaves the other whole", async () => {
    await recordSpend(pilot, 2, { feature: "flights", now: day });
    expect(await checkSpend(pilot, { feature: "flights", now: day })).toEqual({ ok: false, scope: "pilot" });
    expect(await checkSpend(pilot, { now: day })).toEqual({ ok: true });

    await recordSpend(otherPilot, 8, { now: day });
    expect(await checkSpend(otherPilot, { now: day })).toEqual({ ok: false, scope: "pilot" });
    expect((await checkSpend(otherPilot, { feature: "flights", now: day })).ok).toBe(true);
  });

  it("is smaller for a guest, and says how much is left", async () => {
    expect(await checkSpend(guest, { feature: "flights", now: day })).toEqual({ ok: true, leftUsd: 0.5 });
    expect(await checkSpend(pilot, { feature: "flights", now: day })).toEqual({ ok: true, leftUsd: 2 });
    await recordSpend(pilot, 0.5, { feature: "flights", now: day });
    expect(await checkSpend(pilot, { feature: "flights", now: day })).toEqual({ ok: true, leftUsd: 1.5 });
  });

  it("has its own ceiling for the signed-in pilots on one address", async () => {
    const account = (n: number) => ({ key: `u:fake-${n}`, signedIn: true, addressKey: "pilot-address:203.0.113.5" });
    for (let n = 0; n < 3; n++) await recordSpend(account(n), 2, { feature: "flights", now: day });
    expect(await checkSpend(account(3), { feature: "flights", now: day })).toEqual({ ok: true, leftUsd: 1.5 });
    await recordSpend(account(3), 1.5, { feature: "flights", now: day });
    expect(await checkSpend(account(4), { feature: "flights", now: day })).toEqual({ ok: false, scope: "pilot" });
  });

  it("still counts toward the site's ceiling, and stops at it", async () => {
    process.env.SPEND_SITE_DAILY_USD = "1";
    await recordSpend(pilot, 1, { feature: "flights", now: day });
    expect(await checkSpend(otherPilot, { feature: "flights", now: day })).toEqual({ ok: false, scope: "site" });
    expect(await checkSpend(otherPilot, { now: day })).toEqual({ ok: false, scope: "site" });
  });
});

describe("a paid call's hold", () => {
  const spent = (key: string) => (store.get(`line-select:spend:who:2026-11-05:${key}`) ?? 0) / 1e6;
  const site = () => (store.get("line-select:spend:site:2026-11-05") ?? 0) / 1e6;
  const inFlight = () => [...store.keys()].filter((k) => k.includes(":in-flight:"));
  const crewGuest = { key: "device:g1", signedIn: false, addressKey: "address:203.0.113.1" };

  it("holds the most the call can cost while it runs, then settles to what it really cost", async () => {
    const paid = await startPaidCall(crewGuest, 0.5, { now: day });
    if (!paid.ok) throw new Error("refused");
    expect(spent("device:g1")).toBe(0.5);
    expect(spent("address:203.0.113.1")).toBe(0.5);
    expect(site()).toBe(0.5);
    expect(inFlight()).toHaveLength(2);
    await paid.finish(0.12);
    expect(spent("device:g1")).toBe(0.12);
    expect(spent("address:203.0.113.1")).toBe(0.12);
    expect(site()).toBe(0.12);
    expect(inFlight()).toHaveLength(0);
  });

  it("gives the hold back when the call fails, keeping what was billed", async () => {
    const paid = await startPaidCall(guest, 0.5, { now: day });
    if (!paid.ok) throw new Error("refused");
    await paid.finish(0.03);
    expect(spent(guest.key)).toBe(0.03);
    const unbilled = await startPaidCall(guest, 0.5, { now: day });
    if (!unbilled.ok) throw new Error("refused");
    await unbilled.finish(0);
    expect(spent(guest.key)).toBe(0.03);
  });

  it("settles once, however many times it's finished", async () => {
    const paid = await startPaidCall(pilot, 1, { now: day });
    if (!paid.ok) throw new Error("refused");
    await paid.finish(0.2);
    await paid.finish(0.2);
    expect(spent(pilot.key)).toBe(0.2);
  });

  it("lets fifty calls sent at once spend no more than the ceiling and one call's hold", async () => {
    process.env.SPEND_IN_FLIGHT_PER_PILOT = "1000";
    process.env.SPEND_IN_FLIGHT_PER_ADDRESS = "1000";
    const hold = 0.3;
    const calls = await Promise.all(Array.from({ length: 50 }, () => startPaidCall(crewGuest, hold, { now: day })));
    const letIn = calls.filter((c) => c.ok);
    // $2 / $0.30: the seventh is let in with $0.20 left, the last while there was room.
    expect(letIn.length).toBe(7);
    expect(spent("device:g1")).toBeLessThanOrEqual(2 + hold);
    expect(calls.find((c) => !c.ok)).toEqual({ ok: false, scope: "pilot" });
    // Each really costing its whole hold, what's recorded still stops there.
    await Promise.all(letIn.map((c) => c.ok && c.finish(hold)));
    expect(spent("device:g1")).toBeLessThanOrEqual(2 + hold);
    expect((await startPaidCall(crewGuest, hold, { now: day })).ok).toBe(false);
  });

  it("lets a pilot run four paid calls at once, and their address twelve", async () => {
    const running = await Promise.all(Array.from({ length: 4 }, () => startPaidCall(pilot, 0.01, { now: day })));
    expect(running.every((c) => c.ok)).toBe(true);
    expect(await startPaidCall(pilot, 0.01, { now: day })).toEqual({ ok: false, scope: "busy" });
    expect(spendLimitResponse({ ok: false, scope: "busy" }).status).toBe(429);
    // Nothing is held for a call that was turned away.
    expect(spent(pilot.key)).toBeCloseTo(0.04, 6);
    if (running[0].ok) await running[0].finish(0.01);
    expect((await startPaidCall(pilot, 0.01, { now: day })).ok).toBe(true);

    const account = (n: number) => ({ key: `u:room-${n}`, signedIn: true, addressKey: "pilot-address:198.51.100.9" });
    const room = await Promise.all(Array.from({ length: 12 }, (_, n) => startPaidCall(account(n), 0.01, { now: day })));
    expect(room.every((c) => c.ok)).toBe(true);
    expect(await startPaidCall(account(12), 0.01, { now: day })).toEqual({ ok: false, scope: "busy" });
    // The pilot's own place is given back when the address had none left.
    expect(store.has("line-select:spend:in-flight:u:room-12")).toBe(false);
  });

  it("stops at the site's ceiling, leaves the totals as they were, and emails the owner once", async () => {
    process.env.SPEND_SITE_DAILY_USD = "1";
    await recordSpend(otherPilot, 1, { now: day });
    sent.length = 0;
    expect(await startPaidCall(pilot, 0.2, { now: day })).toEqual({ ok: false, scope: "site" });
    expect(await startPaidCall(pilot, 0.2, { now: day })).toEqual({ ok: false, scope: "site" });
    expect(site()).toBe(1);
    expect(spent(pilot.key)).toBe(0);
    expect(inFlight()).toHaveLength(0);
    // recordSpend crossing the ceiling already sent the day's one email.
    expect(sent).toHaveLength(0);
  });

  it("emails the owner when a call is the first thing the site's ceiling stops", async () => {
    process.env.SPEND_SITE_DAILY_USD = "1";
    const first = await startPaidCall(pilot, 1, { now: day });
    if (!first.ok) throw new Error("refused");
    await first.finish(1);
    expect(sent).toHaveLength(0);
    expect(await startPaidCall(otherPilot, 0.2, { now: day })).toEqual({ ok: false, scope: "site" });
    expect(await startPaidCall(otherPilot, 0.2, { now: day })).toEqual({ ok: false, scope: "site" });
    expect(sent).toHaveLength(1);
  });

  it("counts toward what checkSpend sees while it runs, so hotel and flight checks see it too", async () => {
    expect((await startPaidCall(guest, 2, { now: day })).ok).toBe(true);
    expect(await checkSpend(guest, { now: day })).toEqual({ ok: false, scope: "pilot" });
  });
});
