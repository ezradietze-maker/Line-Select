import { describe, expect, it } from "vitest";
import { answerNeed, backupsOf, hubsFor, secondHubsFor, type ScheduledFlight } from "@/lib/flights/itineraries";
import type { TravelNeed } from "@/lib/flights/needs";

const H = 3_600_000;
const t0 = Date.UTC(2026, 9, 20, 0);
const f = (n: string, from: string, to: string, depH: number, arrH: number): ScheduledFlight => ({ n, from, to, dep: t0 + depH * H, arr: t0 + arrH * H });
const boards: Record<string, ScheduledFlight[]> = {
  SAN: [
    f("AS 1", "SAN", "SEA", 13, 16),
    f("DL 2", "SAN", "SEA", 15, 18),
    f("AS 3", "SAN", "PDX", 14, 16.5),
    f("UA 4", "SAN", "ANC", 16, 21),
    f("AS 5", "SAN", "SEA", 20, 23),
    f("WN 6", "SAN", "OAK", 13, 14.5),
  ],
  SEA: [f("AS 10", "SEA", "ANC", 16.5, 20), f("AS 11", "SEA", "ANC", 19.5, 23), f("AS 12", "SEA", "ANC", 23.5, 27)],
  PDX: [f("AS 20", "PDX", "ANC", 17, 20.5)],
};
const need: TravelNeed = {
  id: "t:toBase",
  tripId: "t",
  kind: "toBase",
  from: ["SAN"],
  to: ["ANC"],
  arriveBy: t0 + 23.5 * H,
  departAfter: t0,
  departBefore: t0 + 23.5 * H,
};
const look = (a: string) => boards[a];

describe("counting real ways to make a trip", () => {
  it("counts each first flight that gets there in time, nonstop or with a real connection", () => {
    const a = answerNeed(need, look)!;
    // AS 1 and DL 2 both connect onto AS 11 in Seattle — one way in, not two; UA 4 is nonstop. AS 3's Portland connection
    // is under the minimum connecting time (lands 16:30, AS 20 leaves 17:00), and AS 5 only connects to a flight that
    // lands too late.
    expect(a.options).toBe(2);
    expect(backupsOf(a)).toBe(1);
    expect(a.lastDeparture).toBe(t0 + 16 * H);
    expect(a.best?.map((x) => x.n)).toEqual(["UA 4"]);
  });

  it("looks through the on-the-way hubs nearest the destination, never the destination itself", () => {
    expect(hubsFor(need, look)).toEqual(["SEA", "PDX"]);
  });

  it("goes home on the first arrival, and knows when it can't tell", () => {
    const home: TravelNeed = {
      id: "t:homeFromBase",
      tripId: "t",
      kind: "homeFromBase",
      from: ["SEA"],
      to: ["ANC"],
      departAfter: t0 + 19 * H,
      departBefore: t0 + 43 * H,
    };
    expect(answerNeed(home, look)).toMatchObject({
      options: 2,
      firstArrival: t0 + 23 * H,
      lastDeparture: null,
    });
    expect(answerNeed({ ...need, from: ["LAX"] }, look)).toBeNull();
  });

  it("rides FedEx flights on the jumpseat, with time to get across to the FedEx ramp", () => {
    // WN 6 lands in Oakland at 14:30; FedEx 31 leaves for Anchorage at 16:30 (just enough), FedEx 33 at 16:00 (not enough —
    // an airline-to-airline connection would have made it).
    const fedex = { OAK: [{ ...f("FX 31", "OAK", "ANC", 16.5, 21.5), jumpseat: true as const }, { ...f("FX 33", "OAK", "ANC", 16, 21), jumpseat: true as const }] };
    const withFedex = (a: string) => (a === "OAK" ? fedex.OAK : a === "SAN" ? [...boards.SAN, { ...f("FX 5", "SAN", "ANC", 12, 17), jumpseat: true as const }] : boards[a]);
    const a = answerNeed(need, withFedex)!;
    expect(a.options).toBe(4); // UA 4, AS 11 via Seattle, FX 5 nonstop, WN 6 → FX 31
    expect(a.jumpseatWays).toBe(2);
    // A FedEx gateway is looked through on top of the airline hubs, never instead of one.
    expect(hubsFor(need, withFedex, 1)).toEqual(["SEA"]);
    expect(hubsFor({ ...need, to: ["ANC"] }, (x) => (x === "SAN" ? [...boards.SAN, { ...f("FX 7", "SAN", "OAK", 9, 10.5), jumpseat: true as const }] : boards[x]), 1)).toEqual(["SEA", "OAK"]);
  });

  it("counts every flight into the destination a feeder reaches, not just the quickest one", () => {
    // AS 1 lands in Seattle at 16:00 and can make both AS 13 (18:00) and AS 11 (19:30): two ways in, though one feeder.
    const only = { SAN: [f("AS 1", "SAN", "SEA", 13, 16)], SEA: [f("AS 13", "SEA", "ANC", 18, 21.5), f("AS 11", "SEA", "ANC", 19.5, 23)] };
    expect(answerNeed(need, (a) => only[a as keyof typeof only])!.options).toBe(2);
  });

  it("adds the drive from an airline airport standing in for a FedEx-only field", () => {
    // Mirabel has no airline flights; Montréal-Trudeau stands in, an hour's drive away. Arrival deadline 20:00.
    const mirabel: TravelNeed = { id: "m", tripId: "m", kind: "deviateOut", from: ["SAN"], to: ["YMX", "YUL"], arriveBy: t0 + 20 * H, departAfter: t0, departBefore: t0 + 20 * H, groundMs: { YUL: 1 * H } };
    const b = (x: string) => (x === "SAN" ? [f("AC 1", "SAN", "YUL", 10, 18.5), f("AC 3", "SAN", "YUL", 11, 19.5)] : []);
    // AC 1 lands 18:30 (+1h drive = 19:30, in time); AC 3 lands 19:30 (+1h = 20:30, late).
    expect(answerNeed(mirabel, b)).toMatchObject({ options: 1, lastDeparture: t0 + 10 * H });
  });

  it("finds routes with two connections when one connection doesn't make it", () => {
    const far: TravelNeed = { id: "k", tripId: "k", kind: "deviateOut", from: ["COS"], to: ["KIX"], arriveBy: t0 + 40 * H, departAfter: t0, departBefore: t0 + 40 * H };
    const net: Record<string, ScheduledFlight[]> = {
      COS: [f("UA 1", "COS", "DEN", 6, 7)],
      DEN: [f("UA 2", "DEN", "LAX", 8.5, 10.5), f("UA 9", "DEN", "MIA", 8.5, 12)],
      LAX: [f("JL 61", "LAX", "KIX", 12, 25)],
      MIA: [f("XX 1", "MIA", "KIX", 13.5, 28)],
    };
    const look = (x: string) => net[x];
    expect(answerNeed(far, look)!.options).toBe(0);
    // Through Los Angeles; Miami is too far out of the way to count.
    const two = answerNeed(far, look, 2)!;
    expect(two.options).toBe(1);
    expect(two.best?.map((x) => x.n)).toEqual(["UA 1", "UA 2", "JL 61"]);
    expect(secondHubsFor(far, look, ["DEN"])).toEqual(["LAX"]);
    // Two-stop routes only ever add ways.
    expect(answerNeed(need, (a) => boards[a], 2)!.options).toBeGreaterThanOrEqual(answerNeed(need, (a) => boards[a])!.options);
  });
});

