import { describe, expect, it } from "vitest";
import { alreadyTraded, offersFreedByTrade, sameTrip } from "@/lib/trades/offer-trips";
import type { TradeOffer, TripSnapshot } from "@/types/trade";

const meta = { base: "MEM", aircraft: "MD11", seat: "CAP", month: "NOV26" };
const trip = (pairingNumber: string, startDayIndex?: number, lineNumber = "1001"): TripSnapshot => ({
  lineNumber,
  pairingNumber,
  days: 3,
  layoverCities: ["ANC"],
  international: false,
  reportTime: "early",
  creditHours: 15,
  tafbHours: 60,
  landings: 4,
  deadheadLegs: 0,
  ...(startDayIndex !== undefined && { tripId: `p${pairingNumber}`, startDayIndex, date: null }),
});
let n = 0;
const offer = (offeringUserId: string, offeredTrip: TripSnapshot, over: Partial<TradeOffer> = {}): TradeOffer => ({
  id: `o${++n}`,
  bidPackMeta: meta,
  offeringUserId,
  offeringDisplayName: offeringUserId,
  offeredTrip,
  wantedPairingNumber: null,
  note: null,
  status: "open",
  createdAt: "2026-11-01T00:00:00Z",
  responderUserId: null,
  responderDisplayName: null,
  responderTrip: null,
  respondedAt: null,
  resolvedAt: null,
  ...over,
});
const proposal = (by: string, t: TripSnapshot): Partial<TradeOffer> => ({ status: "pending", responderUserId: by, responderDisplayName: by, responderTrip: t, respondedAt: "2026-11-02T00:00:00Z" });

describe("which trip an offer means", () => {
  it("tells one pairing's days apart", () => {
    expect(sameTrip(trip("13", 2), trip("13", 2))).toBe(true);
    expect(sameTrip(trip("13", 2), trip("13", 9))).toBe(false);
  });

  it("takes an offer posted without a date to mean that pairing from that line", () => {
    expect(sameTrip(trip("13"), trip("13", 9))).toBe(true);
    expect(sameTrip(trip("13"), trip("13", 9, "1002"))).toBe(false);
    expect(sameTrip({ ...trip("13"), pairingNumber: null }, { ...trip("13"), pairingNumber: null })).toBe(false);
  });
});

describe("after a trade is agreed", () => {
  const accepted = offer("a", trip("13", 2), { ...proposal("b", trip("27", 6)), status: "accepted" });

  it("withdraws both pilots' other offers of the traded trips, open or pending", () => {
    const again = offer("a", trip("13", 2));
    const pendingAgain = offer("b", trip("27", 6), proposal("c", trip("40", 1)));
    const otherDay = offer("a", trip("13", 9));
    const someoneElses = offer("c", trip("13", 2));
    const { withdraw, reopen } = offersFreedByTrade(accepted, [again, pendingAgain, otherDay, someoneElses]);
    expect(withdraw).toEqual([again.id, pendingAgain.id]);
    expect(reopen).toEqual([]);
  });

  it("takes either pilot's proposal of a traded trip off another pilot's offer, which opens again", () => {
    const aProposed = offer("c", trip("40", 1), proposal("a", trip("13", 2)));
    const bProposed = offer("a", trip("50", 3), proposal("b", trip("27", 6)));
    const otherTrip = offer("c", trip("41", 1), proposal("b", trip("28", 6)));
    expect(offersFreedByTrade(accepted, [aProposed, bProposed, otherTrip])).toEqual({ withdraw: [], reopen: [aProposed.id, bProposed.id] });
  });

  it("leaves finished offers, and other months, alone", () => {
    const done = offer("a", trip("13", 2), { status: "declined" });
    const otherMonth = offer("a", trip("13", 2), { bidPackMeta: { ...meta, month: "DEC26" } });
    expect(offersFreedByTrade(accepted, [accepted, done, otherMonth])).toEqual({ withdraw: [], reopen: [] });
  });
});

describe("a trip already traded", () => {
  const accepted = offer("a", trip("13", 2), { ...proposal("b", trip("27", 6)), status: "accepted" });

  it("is spoken for, for either pilot who gave one away in an agreed trade", () => {
    expect(alreadyTraded([accepted], meta, "a", trip("13", 2))).toBe(true);
    expect(alreadyTraded([accepted], meta, "b", trip("27", 6))).toBe(true);
    // Not the trip each received, another day of the pairing, or someone else's.
    expect(alreadyTraded([accepted], meta, "a", trip("27", 6))).toBe(false);
    expect(alreadyTraded([accepted], meta, "a", trip("13", 9))).toBe(false);
    expect(alreadyTraded([accepted], meta, "c", trip("13", 2))).toBe(false);
  });

  it("only counts trades agreed in the same seat's month", () => {
    const pending = offer("a", trip("13", 2), proposal("b", trip("27", 6)));
    const otherMonth = { ...accepted, bidPackMeta: { ...meta, month: "DEC26" } };
    expect(alreadyTraded([pending, otherMonth], meta, "a", trip("13", 2))).toBe(false);
  });
});
