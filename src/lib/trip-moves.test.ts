import { describe, expect, it } from "vitest";
import { withModel } from "@/lib/brain/profile-model";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { scoreTripsV2 } from "@/lib/scoring-v2/trip-score";
import { placeTrips, rankShifts, standingTripChoices, tripChoicesHere, tripMoveChoice, tripMovesHere, tripRelocationChoices, withoutTripMove } from "@/lib/trip-moves";
import type { RankedTrip } from "@/lib/trip-rankings";
import type { BidPack } from "@/types/bidpack";
import type { Criterion, PilotModel, TripChoice } from "@/types/pilot-model";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

const ranked = (...keys: string[]) => keys.map((key) => ({ key }) as RankedTrip);
const keys = (trips: RankedTrip[]) => trips.map((t) => t.key);
const pack = { id: "pack-nov", base: "MEM", aircraft: "777", seat: "CA", month: "2026-11" } as unknown as BidPack;

describe("placeTrips: the pilot's moves kept on top of the ranking", () => {
  it("replays moves on the ranking they were made on as exactly the order the pilot left", () => {
    // d up past c, then up past b (a d b c e); a down past d, then down past b.
    const moves = [tripMoveChoice("d", "c", "m1", pack.id), tripMoveChoice("d", "b", "m2", pack.id), tripMoveChoice("d", "a", "m3", pack.id), tripMoveChoice("b", "a", "m4", pack.id)];
    const { trips, placed } = placeTrips(ranked("a", "b", "c", "d", "e"), moves);
    expect(keys(trips)).toEqual(["d", "b", "a", "c", "e"]);
    expect([...placed].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves a move alone once the ranking agrees with it, and the latest move wins", () => {
    expect(keys(placeTrips(ranked("x", "y"), [tripMoveChoice("x", "y", "m1", pack.id)]).trips)).toEqual(["x", "y"]);
    const both = [tripMoveChoice("y", "x", "m1", pack.id), tripMoveChoice("x", "y", "m2", pack.id)];
    expect(keys(placeTrips(ranked("x", "y"), both).trips)).toEqual(["x", "y"]);
  });

  it("moves a trip straight to a place, past every trip between, as one move", () => {
    const order = ["a", "b", "c", "d", "e"];
    const up = tripRelocationChoices(order, 3, 0, "m1", pack.id);
    expect(up.map((c) => `${c.preferred}>${c.other}`)).toEqual(["d>a", "d>b", "d>c"]);
    expect(keys(placeTrips(ranked(...order), up).trips)).toEqual(["d", "a", "b", "c", "e"]);
    // Put under a trip, that trip stays above it; it isn't marked as moved.
    const under = tripRelocationChoices(order, 4, 1, "m3", pack.id);
    expect(under.map((c) => `${c.preferred}>${c.other}${c.kept ? " kept" : ""}`)).toEqual(["e>b", "e>c", "e>d", "a>e kept"]);
    const placedUnder = placeTrips(ranked(...order), under);
    expect(keys(placedUnder.trips)).toEqual(["a", "e", "b", "c", "d"]);
    expect(placedUnder.placed.has("a")).toBe(false);
    const down = tripRelocationChoices(order, 1, 3, "m2", pack.id);
    expect(down.map((c) => `${c.preferred}>${c.other}${c.kept ? " kept" : ""}`)).toEqual(["c>b", "d>b", "b>e kept"]);
    expect(keys(placeTrips(ranked(...order), down).trips)).toEqual(["a", "c", "d", "b", "e"]);
    expect(withoutTripMove([...up, ...down], "m1")).toEqual(down);
    // One place is just a move: nothing kept.
    expect(tripRelocationChoices(order, 2, 1, "m4", pack.id).map((c) => `${c.preferred}>${c.other}`)).toEqual(["c>b"]);
  });

  it("skips a move on a trip the list doesn't have", () => {
    expect(keys(placeTrips(ranked("a", "b"), [tripMoveChoice("z", "a", "m1", pack.id)]).trips)).toEqual(["a", "b"]);
  });
});

describe("rankShifts: what a refit did to the list", () => {
  it("counts trips that went up and down, leaves out the moved ones, and finds the biggest climb", () => {
    const shift = rankShifts(["a", "b", "c", "d", "e"], ["d", "a", "e", "b", "c"], new Set(["d"]));
    // a, b and c each went down a place; e climbed two.
    expect(shift.up).toBe(1);
    expect(shift.down).toBe(3);
    expect(shift.climb).toEqual({ key: "e", from: 5, to: 3 });
    expect(rankShifts(["a", "b"], ["a", "b"], new Set())).toEqual({ up: 0, down: 0, climb: null });
  });
});

describe("trip choices from moves", () => {
  const interview: TripChoice = { preferred: "a", other: "b", strength: "strongly" };

  it("lets a move be the latest word on its two trips, and leaves every other choice counting", () => {
    const flip = tripMoveChoice("b", "a", "m1", pack.id);
    const other: TripChoice = { preferred: "c", other: "d", strength: "slightly" };
    expect(standingTripChoices([interview, other, flip])).toEqual([other, flip]);
    // Without a move on them, the interview's choices count as they always have, repeats and all.
    expect(standingTripChoices([interview, interview, other])).toEqual([interview, interview, other]);
    // Undone, the move gives the interview's pick back.
    expect(standingTripChoices(withoutTripMove([interview, flip], "m1"))).toEqual([interview]);
  });

  it("counts moves on their own pack only", () => {
    const here = tripMoveChoice("a", "c", "m1", pack.id);
    const lastMonth = tripMoveChoice("a", "c", "m0", "pack-oct");
    expect(tripChoicesHere([interview, lastMonth, here], pack)).toEqual([interview, here]);
    expect(tripMovesHere([interview, lastMonth, here], pack)).toEqual([here]);
  });
});

describe("a move refits the pilot's trip weights through the profile", () => {
  const crit = (id: string, metric: string, weight: number, kind: "more" | "less"): Criterion => ({ id, metric, shape: { kind }, tier: "medium", weight, confidence: 1, label: id, evidence: [], status: "settled" });
  // On the sample pack, trip A (short credit, short time away) scores a little under trip C (good credit, long away).
  const model: PilotModel = { version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria: [crit("credit", "creditHours", 1, "more"), crit("tafb", "tafbHours", 0.9, "less")] };
  const profile = { weights: DEFAULT_WEIGHTS, pilotModel: model, brainInterview: { exchanges: [], choices: [], reviewedModel: model } } as unknown as PreferenceProfile;
  const gap = (m: PilotModel) => {
    const s = scoreTripsV2(SAMPLE_BID_PACK, m);
    return s.get("sample-A@12")!.uncapped - s.get("sample-C@12")!.uncapped;
  };

  it("learns from a move on this pack and keeps it, and ignores one made on another pack", () => {
    expect(gap(model)).toBeLessThan(0);
    const move = tripMoveChoice("sample-A@12", "sample-C@12", "m1", SAMPLE_BID_PACK.id);
    const moved = withModel(profile, SAMPLE_BID_PACK, { tripChoices: [move] }).profile;
    expect(moved.brainInterview?.tripChoices).toEqual([move]);
    expect(gap(moved.pilotModel!)).toBeGreaterThan(0);
    const elsewhere = withModel(profile, SAMPLE_BID_PACK, { tripChoices: [{ ...move, packId: "another-pack" }] }).profile;
    expect(elsewhere.pilotModel?.tripWeights).toBeUndefined();
  });
});
