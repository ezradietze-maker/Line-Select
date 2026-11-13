import { describe, expect, it } from "vitest";
import { agreedBoardSwaps, agreedBoardTrips, alreadyTraded, lockBoardTrades, offersFreedBy, offersFreedByTrade, sameTrip, withBoardSwaps } from "@/lib/trades/offer-trips";
import type { PilotHolding } from "@/lib/trades/match";
import type { BidPack, Line, Trip } from "@/types/bidpack";
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

describe("trips that moved in a step of a suggested trade", () => {
  it("withdraws the pilot's offers of them and takes their proposals made with them off, leaving the rest", () => {
    const mine = offer("u1", trip("13", 5));
    const other = offer("u1", trip("14", 9));
    const proposedOn = offer("u3", trip("20", 7), { status: "pending", responderUserId: "u1", responderTrip: trip("13", 5) });
    const someoneElses = offer("u2", trip("13", 5));
    expect(offersFreedBy([{ pilot: "u1", trip: trip("13", 5) }], meta, [mine, other, proposedOn, someoneElses])).toEqual({ withdraw: [mine.id], reopen: [proposedOn.id] });
  });
});

describe("matching around the board's agreed trades", () => {
  const held = (pilotId: string, trips: { id: string; startDayIndex: number; pairingNumber: string }[]): PilotHolding =>
    ({ pilotId, model: {}, line: { lineNumber: "1001", trips } as unknown as Line }) as unknown as PilotHolding;

  it("locks each trip a pilot agreed to give away, for that pilot only", () => {
    const agreed = offer("u1", trip("13", 5), { status: "accepted", responderUserId: "u2", responderTrip: trip("20", 7) });
    const given = agreedBoardTrips([agreed, offer("u3", trip("30", 2))]);
    expect(given.map((g) => g.pilot)).toEqual(["u1", "u2"]);
    const [u1, u2, u3] = lockBoardTrades(
      [held("u1", [{ id: "p13", startDayIndex: 5, pairingNumber: "13" }, { id: "p14", startDayIndex: 9, pairingNumber: "14" }]), held("u2", [{ id: "p20", startDayIndex: 7, pairingNumber: "20" }]), held("u3", [{ id: "p13", startDayIndex: 5, pairingNumber: "13" }])],
      given
    );
    expect([...(u1.locked ?? [])]).toEqual(["p13@5"]);
    expect([...(u2.locked ?? [])]).toEqual(["p20@7"]);
    expect(u3.locked).toBeUndefined();
  });

  it("locks every day of the pairing when an older offer didn't say which", () => {
    const given = agreedBoardTrips([offer("u1", trip("13"), { status: "accepted" })]);
    const [u1] = lockBoardTrades([held("u1", [{ id: "a", startDayIndex: 5, pairingNumber: "13" }, { id: "b", startDayIndex: 12, pairingNumber: "13" }, { id: "c", startDayIndex: 20, pairingNumber: "14" }])], given);
    expect([...(u1.locked ?? [])].sort()).toEqual(["a@5", "b@12"]);
  });
});

describe("matching around what the board's agreed trades hand a pilot", () => {
  const t = (id: string, startDayIndex: number, pairingNumber = id) => ({ id, startDayIndex, pairingNumber }) as unknown as Trip;
  const held = (pilotId: string, trips: Trip[]): PilotHolding => ({ pilotId, model: {}, line: { lineNumber: "1001", trips } as unknown as Line }) as unknown as PilotHolding;
  const pack = { lines: [{ trips: [t("p13", 5, "13"), t("p20", 7, "20"), t("p30", 9, "30")] }] } as unknown as BidPack;
  const agreed = offer("u1", trip("13", 5), { status: "accepted", responderUserId: "u2", responderTrip: trip("20", 7) });

  it("names what each pilot takes, with what they give for it", () => {
    const [u2, u1] = agreedBoardSwaps([agreed, offer("u3", trip("30", 9))]);
    expect([u1.pilot, u1.give?.pairingNumber, u1.take.pairingNumber]).toEqual(["u1", "13", "20"]);
    expect([u2.pilot, u2.give?.pairingNumber, u2.take.pairingNumber]).toEqual(["u2", "20", "13"]);
  });

  it("keeps what they take beside what they hold, until what they hold no longer has what they gave", () => {
    const [u1, u2] = withBoardSwaps(pack, [held("u1", [t("p13", 5, "13"), t("p30", 9, "30")]), held("u2", [t("p13", 5, "13")])], agreedBoardSwaps([agreed]));
    expect([...u1.agreed!.gives]).toEqual(["p13@5"]);
    expect(u1.agreed!.takes.map((x) => x.id)).toEqual(["p20"]);
    // u2 holds trip 13 and not 20: it went through, and they've confirmed so.
    expect(u2.agreed).toBeUndefined();
  });

  it("leaves out a pilot taking a trip the pack can't place", () => {
    const old = offer("u1", trip("13", 5), { status: "accepted", responderUserId: "u2", responderTrip: trip("20") });
    expect(withBoardSwaps(pack, [held("u1", [t("p13", 5, "13")]), held("u3", [t("p30", 9, "30")])], agreedBoardSwaps([old])).map((p) => p.pilotId)).toEqual(["u3"]);
  });
});
