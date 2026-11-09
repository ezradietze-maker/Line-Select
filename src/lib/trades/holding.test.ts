import { describe, expect, it } from "vitest";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { heldLine, heldTripsOfLine, pilotsForMatching, readHolding, tradeLocksFor, tripInstances, type MatchingRow } from "@/lib/trades/holding";
import type { BidPack, Line } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";
import type { PreferenceProfile } from "@/types/preferences";
import type { TradeHolding } from "@/types/trade";

// The sample pack's trips with real dates, as an uploaded pack's have, under an uploaded pack's id.
const lines: Line[] = SAMPLE_BID_PACK.lines.map((l, li) => ({ ...l, trips: l.trips.map((t, ti) => ({ ...t, id: `${t.id}-${li}-${ti}`, startDayIndex: ti * 7 + 1 })) }));
const pack: BidPack = { ...SAMPLE_BID_PACK, id: "uploaded-mem-b777-cap-sample", bidPeriodStart: "2026-09-28", bidPeriodDays: 28, lines };
const line = lines.find((l) => l.trips.length >= 2)!;
const other = lines.find((l) => l !== line && l.trips.length >= 1)!;
const meta = { base: pack.base, aircraft: pack.aircraft, seat: pack.seat, month: pack.month };
const holding = (over: Partial<TradeHolding> = {}): TradeHolding => ({ packId: pack.id, bidPackMeta: meta, lineNumber: line.lineNumber, trips: heldTripsOfLine(line), confirmedAt: "2026-11-08T00:00:00Z", ...over });
const model = { version: 2, criteria: [] } as unknown as PilotModel;
const profile = { pilotModel: model, seniorityNumber: 120 } as unknown as PreferenceProfile;
const row = (over: Partial<MatchingRow> = {}): MatchingRow => ({ userId: "u1", holding: holding(), settings: { suggestMe: true, emailMatches: false }, profile, ...over });

describe("reading a holding from a browser", () => {
  const body = () => ({ packId: pack.id, bidPackMeta: meta, lineNumber: "1001", trips: [{ id: "t", startDayIndex: 3, lock: null }] });

  it("accepts a good one", () => {
    expect(readHolding(body())).toEqual(body());
    expect(readHolding({ ...body(), lineNumber: null, trips: [{ id: "t", startDayIndex: 3, lock: "VLT" }] })?.trips[0].lock).toBe("VLT");
  });

  it("refuses the sample pack, which isn't anyone's to trade", () => {
    expect(readHolding({ ...body(), packId: "sample-bidpack" })).toBeNull();
  });

  it.each([
    ["no trips", { trips: [] }],
    ["too many trips", { trips: Array.from({ length: 41 }, () => ({ id: "t", startDayIndex: 3, lock: null })) }],
    ["a trip with no date", { trips: [{ id: "t", startDayIndex: null, lock: null }] }],
    ["an unknown reason", { trips: [{ id: "t", startDayIndex: 3, lock: "because" }] }],
    ["no base", { bidPackMeta: { ...meta, base: "" } }],
  ])("refuses %s", (_name, over) => {
    expect(readHolding({ ...body(), ...over })).toBeNull();
  });
});

describe("the month a holding describes", () => {
  it("is the awarded line itself, while nothing has changed", () => {
    const held = heldLine(pack, holding(), "h")!;
    expect(held.totalCreditHours).toBeCloseTo(line.totalCreditHours);
    expect(held.trips.map((t) => t.id)).toEqual(line.trips.map((t) => t.id));
  });

  it("moves with a trip traded away and a trip taken on", () => {
    const [keep, gone] = heldTripsOfLine(line);
    const taken = other.trips[0];
    const held = heldLine(pack, holding({ trips: [keep, { id: taken.id, startDayIndex: taken.startDayIndex!, lock: null }] }), "h")!;
    const goneTrip = line.trips.find((t) => t.id === gone.id)!;
    expect(held.totalCreditHours).toBeCloseTo(line.totalCreditHours - goneTrip.creditHours + taken.creditHours);
    expect(held.trips.map((t) => t.id)).toContain(taken.id);
    expect(held.trips.map((t) => t.id)).not.toContain(gone.id);
  });

  it("can be built from trips alone, with no line to start from", () => {
    const taken = other.trips[0];
    const held = heldLine(pack, holding({ lineNumber: null, trips: [{ id: taken.id, startDayIndex: taken.startDayIndex!, lock: null }] }), "h")!;
    expect(held.totalCreditHours).toBeCloseTo(taken.creditHours);
    expect(held.daysOff).toBe(pack.bidPeriodDays - taken.days);
  });

  it("is unknown when the pack doesn't have one of the trips, rather than treating those days as free", () => {
    expect(heldLine(pack, holding({ trips: [{ id: "not-in-this-pack", startDayIndex: 2, lock: null }] }), "h")).toBeNull();
  });
});

describe("who can appear on a suggested trade", () => {
  it("includes a pilot who has confirmed what they hold", () => {
    const [p] = pilotsForMatching(pack, [row()]);
    expect(p).toMatchObject({ pilotId: "u1", model, seniority: 120 });
  });

  it("never includes a pilot who hasn't confirmed", () => {
    expect(pilotsForMatching(pack, [row({ holding: null })])).toEqual([]);
  });

  it("leaves out a pilot who turned suggestions off", () => {
    expect(pilotsForMatching(pack, [row({ settings: { suggestMe: false, emailMatches: false } })])).toEqual([]);
  });

  it("leaves out a pilot with no finished interview, since there's nothing to judge a trade by", () => {
    expect(pilotsForMatching(pack, [row({ profile: null })])).toEqual([]);
    expect(pilotsForMatching(pack, [row({ profile: {} as PreferenceProfile })])).toEqual([]);
  });

  it("leaves out a holding from another bid pack", () => {
    expect(pilotsForMatching(pack, [row({ holding: holding({ packId: "uploaded-ind-b767-fo-oct26" }) })])).toEqual([]);
  });

  it("keeps locked trips out of the matching", () => {
    const trips = heldTripsOfLine(line);
    trips[0].lock = "VLT";
    const [p] = pilotsForMatching(pack, [row({ holding: holding({ trips }) })]);
    expect(p.locked?.has(`${trips[0].id}@${trips[0].startDayIndex}`)).toBe(true);
    expect(p.locked?.size).toBe(1);
  });
});

describe("the choices a pilot gets", () => {
  it("adds PMU to the reasons a trip can't be traded from the December 2026 bid period (25.L.1.h)", () => {
    expect(tradeLocksFor({ month: "NOV26" }).map((l) => l.lock)).not.toContain("PMU");
    expect(tradeLocksFor({ month: "DEC26" }).map((l) => l.lock)).toContain("PMU");
    expect(tradeLocksFor({ month: "NOV26" }).map((l) => l.lock)).toContain("VLT");
  });

  it("offers each trip on each date once, in date order", () => {
    const list = tripInstances(pack);
    expect(new Set(list.map((t) => `${t.id}@${t.startDayIndex}`)).size).toBe(list.length);
    expect(list.map((t) => t.startDayIndex)).toEqual([...list.map((t) => t.startDayIndex!)].sort((a, b) => a - b));
  });
});
