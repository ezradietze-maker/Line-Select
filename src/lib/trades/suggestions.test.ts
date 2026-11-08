import { describe, expect, it } from "vitest";
import { holdingsAfter, suggestionForViewer, tradeSignature, viewStatus } from "@/lib/trades/suggestions";
import type { TradeSuggestionMember, TradeSuggestionRecord, TradeTrip, TradeValue } from "@/types/trade";

const trip = (id: string): TradeTrip =>
  ({ id, startDayIndex: 5, date: "2026-12-05", lineNumber: "held", pairingNumber: id, days: 2, layoverCities: [], international: false, reportTime: "am", creditHours: 10, tafbHours: 48, landings: 2, deadheadLegs: 0 }) as unknown as TradeTrip;
const value = (gain: number): TradeValue => ({ gain, before: 50, after: 50 + gain, creditChange: 1, daysOffChange: 0, reasons: [{ label: `secret-${gain}`, from: 1, to: 2, unit: "days", better: true }] });
const member = (n: number, over: Partial<TradeSuggestionMember> = {}): TradeSuggestionMember => ({ userId: `u${n}`, displayName: `Pilot ${n}`, position: n, give: trip(`t${n}`), value: value(n + 2), answer: "waiting", ...over });
const record = (over: Partial<TradeSuggestionRecord> = {}): TradeSuggestionRecord => ({
  id: "s",
  packId: "p",
  bidPackMeta: { base: "MEM", aircraft: "MD11", seat: "FO", month: "DEC26" },
  status: "proposed",
  cancelReason: null,
  steps: [
    { a: 0, b: 1 },
    { a: 1, b: 2 },
  ],
  stepsDone: 0,
  expiresAt: "2026-12-05T00:00:00Z",
  createdAt: "2026-11-01T00:00:00Z",
  members: [member(0), member(1), member(2)],
  ...over,
});
const now = Date.parse("2026-11-20T00:00:00Z");

describe("a suggested trade as one pilot sees it", () => {
  it("shows only the pilots on it", () => {
    expect(suggestionForViewer(record(), "someone-else", now)).toBeNull();
  });

  it("gives you your own reasons and no one else's, and no account ids at all", () => {
    const view = suggestionForViewer(record(), "u1", now)!;
    const text = JSON.stringify(view);
    expect(view.you.value.gain).toBe(3);
    expect(text).toContain("secret-3");
    expect(text).not.toContain("secret-2");
    expect(text).not.toContain("secret-4");
    expect(text).not.toMatch(/"u[012]"/);
    expect(view.pilots.map((p) => p.name)).toEqual(["Pilot 0", "Pilot 1", "Pilot 2"]);
    expect(view.pilots.map((p) => p.isYou)).toEqual([false, true, false]);
  });

  it("says what you give and take: your trip goes on, and you get the next pilot's", () => {
    const view = suggestionForViewer(record(), "u0", now)!;
    expect(view.you.give.id).toBe("t0");
    expect(view.you.take.id).toBe("t1");
    expect(suggestionForViewer(record(), "u2", now)!.you.take.id).toBe("t0");
  });

  it("doesn't reveal who said no", () => {
    const declined = record({ status: "cancelled", cancelReason: "declined", members: [member(0, { answer: "accepted" }), member(1, { answer: "declined" }), member(2)] });
    const view = suggestionForViewer(declined, "u0", now)!;
    expect(JSON.stringify(view)).not.toContain("declined\",\"name");
    expect(view.pilots.every((p) => !Object.keys(p).includes("answer"))).toBe(true);
    expect(view.pilots.map((p) => p.accepted)).toEqual([true, false, false]);
    expect(view.cancelReason).toBe("declined");
  });

  it("plays out the order: a trip can pass through a pilot's hands on its way", () => {
    expect(holdingsAfter(3, record().steps, 0)).toEqual([0, 1, 2]);
    expect(holdingsAfter(3, record().steps, 1)).toEqual([1, 0, 2]);
    expect(holdingsAfter(3, record().steps, 2)).toEqual([1, 2, 0]);
    const view = suggestionForViewer(record({ status: "accepted" }), "u1", now)!;
    expect(view.steps[0]).toMatchObject({ pilotA: "Pilot 0", pilotB: "Pilot 1", yours: true, done: false });
    expect(view.steps[0].aGives.id).toBe("t0");
    expect(view.steps[0].bGives.id).toBe("t1");
    // Pilot 1 is handed trip 0 at step one, and passes it to Pilot 2 at step two for trip 2.
    expect(view.steps[0].youHoldAfter?.id).toBe("t0");
    expect(view.steps[1].aGives.id).toBe("t0");
    expect(view.steps[1].bGives.id).toBe("t2");
    expect(view.steps[1].youHoldAfter?.id).toBe("t2");
    expect(view.you.take.id).toBe("t2");
  });

  it("lets only the two pilots in the next step mark it done, and only once everyone has accepted", () => {
    const open = record({ status: "accepted" });
    expect(suggestionForViewer(open, "u1", now)!.steps.map((s) => s.canMarkDone)).toEqual([true, false]);
    expect(suggestionForViewer(open, "u2", now)!.steps.map((s) => s.canMarkDone)).toEqual([false, false]);
    expect(suggestionForViewer(record({ status: "accepted", stepsDone: 1 }), "u2", now)!.steps.map((s) => s.canMarkDone)).toEqual([false, true]);
    expect(suggestionForViewer(record(), "u1", now)!.steps.map((s) => s.canMarkDone)).toEqual([false, false]);
  });

  it("warns on a chain until real-time trading starts with the August 2027 bid period (25.L.1.a), and not on a straight swap", () => {
    expect(suggestionForViewer(record(), "u0", now)!.slowChainWarning).toBe(true);
    expect(suggestionForViewer(record({ bidPackMeta: { base: "MEM", aircraft: "MD11", seat: "FO", month: "JUL27" } }), "u0", now)!.slowChainWarning).toBe(true);
    expect(suggestionForViewer(record({ bidPackMeta: { base: "MEM", aircraft: "MD11", seat: "FO", month: "AUG27" } }), "u0", now)!.slowChainWarning).toBe(false);
    const swap = record({ steps: [{ a: 0, b: 1 }], members: [member(0), member(1)] });
    expect(suggestionForViewer(swap, "u0", now)!.slowChainWarning).toBe(false);
  });
});

describe("when a trade stands", () => {
  it("expires at its deadline if it hasn't begun", () => {
    const late = Date.parse("2026-12-06T00:00:00Z");
    expect(viewStatus(record(), late)).toBe("expired");
    expect(viewStatus(record({ status: "accepted" }), late)).toBe("expired");
  });

  it("stays open once it's begun, however late, since pilots are partway through", () => {
    expect(viewStatus(record({ status: "accepted", stepsDone: 1 }), Date.parse("2026-12-06T00:00:00Z"))).toBe("accepted");
  });

  it("is off if a pilot on it has gone", () => {
    expect(viewStatus(record({ members: [member(0), member(2)] }), now)).toBe("cancelled");
    expect(suggestionForViewer(record({ members: [member(0), member(2)] }), "u0", now)!.cancelReason).toBe("changed");
  });
});

describe("a trade's signature", () => {
  it("is the same whichever pilot it's listed from", () => {
    const a = { pilotId: "a", give: { id: "t1", startDayIndex: 1 } };
    const b = { pilotId: "b", give: { id: "t2", startDayIndex: 2 } };
    const c = { pilotId: "c", give: { id: "t3", startDayIndex: 3 } };
    expect(tradeSignature("p", [a, b, c])).toBe(tradeSignature("p", [b, c, a]));
    expect(tradeSignature("p", [a, b])).not.toBe(tradeSignature("p", [a, c]));
    expect(tradeSignature("p", [a, b])).not.toBe(tradeSignature("q", [a, b]));
  });
});
