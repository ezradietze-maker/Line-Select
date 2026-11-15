import { describe, expect, it } from "vitest";
import { computeInboxSections, inboxNoticeKey, unseenCount } from "@/lib/inbox";
import type { TradeOffer } from "@/types/trade";

const trip = { lineNumber: "1", pairingNumber: "13", days: 3, layoverCities: ["ANC"], international: false, reportTime: "early" as const, creditHours: 15, tafbHours: 60, landings: 4, deadheadLegs: 0 };
const offer = (over: Partial<TradeOffer> = {}): TradeOffer => ({
  id: "o1",
  bidPackMeta: { base: "MEM", aircraft: "MD11", seat: "CAP", month: "NOV26" },
  offeringUserId: "me",
  offeringDisplayName: "Me",
  offeredTrip: trip,
  wantedPairingNumber: null,
  note: null,
  status: "open",
  createdAt: "2026-11-01T00:00:00.000Z",
  responderUserId: null,
  responderDisplayName: null,
  responderTrip: null,
  respondedAt: null,
  resolvedAt: null,
  ...over,
});

describe("the Inbox badge", () => {
  it("counts a new proposal on an offer whose last one was seen and then taken off", () => {
    const first = offer({ status: "pending", responderUserId: "another-pilot", responderDisplayName: "B", responderTrip: trip, respondedAt: "2026-11-02T10:00:00.000Z" });
    const seen = new Set(computeInboxSections([first], "me").needsResponse.map(inboxNoticeKey));
    expect(unseenCount([first], seen)).toBe(0);
    // B's trip was traded elsewhere, so the offer opened again, and C proposed on it: the same offer, a new proposal.
    const second = { ...first, responderDisplayName: "C", respondedAt: "2026-11-03T09:00:00.000Z" };
    expect(unseenCount(computeInboxSections([second], "me").needsResponse, seen)).toBe(1);
  });

  it("leaves off offers past their trade deadline, as the board does", () => {
    // Pairing 13 starts Nov 5 in Memphis; 2 hours before the day starts there (06:00Z) the deadline has passed.
    const dated = { ...trip, tripId: "p13", startDayIndex: 4, date: "2026-11-05" };
    const later = { ...trip, pairingNumber: "27", tripId: "p27", startDayIndex: 20, date: "2026-11-21" };
    const proposal = offer({ offeredTrip: dated, status: "pending", responderUserId: "another-pilot", responderDisplayName: "B", responderTrip: later, respondedAt: "2026-11-02T10:00:00.000Z" });
    const proposedLate = offer({ id: "o2", offeredTrip: later, status: "pending", responderUserId: "another-pilot", responderDisplayName: "B", responderTrip: dated, respondedAt: "2026-11-02T10:00:00.000Z" });
    const asking = offer({ id: "o3", offeringUserId: "another-pilot", offeredTrip: dated, wantedPairingNumber: "27" });
    const mine = offer({ id: "o4", offeredTrip: later });
    const offers = [proposal, proposedLate, asking, mine];
    const before = { pack: null, now: Date.UTC(2026, 10, 4, 12) };
    const after = { pack: null, now: Date.UTC(2026, 10, 5, 12) };
    expect(computeInboxSections(offers, "me", before).needsResponse.map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(computeInboxSections(offers, "me", before).directInterest.map((o) => o.id)).toEqual(["o3"]);
    expect(computeInboxSections(offers, "me", after).needsResponse).toEqual([]);
    expect(computeInboxSections(offers, "me", after).directInterest).toEqual([]);
  });

  it("knows an open offer asking for a pilot's pairing by the offer alone", () => {
    expect(inboxNoticeKey(offer({ offeringUserId: "another-pilot", wantedPairingNumber: "13" }))).toBe("o1");
  });
});
