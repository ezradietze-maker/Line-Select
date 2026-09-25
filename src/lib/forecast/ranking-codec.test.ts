import { describe, expect, it } from "vitest";
import { decodeRanking, encodeRanking, widthFor } from "@/lib/forecast/ranking-codec";

describe("ranking codec", () => {
  it("round-trips a ranking, in order", () => {
    const ranking = [282, 0, 17, 140, 36, 1295];
    expect(decodeRanking(encodeRanking(ranking, 1296), 1296)).toEqual(ranking);
  });

  it("uses two characters a line for a normal pack and three for a huge one", () => {
    expect(widthFor(283)).toBe(2);
    expect(widthFor(2000)).toBe(3);
    expect(encodeRanking([1500], 2000)).toHaveLength(3);
  });

  it("stays small enough for every pilot in a seat to fit one record", () => {
    const ranking = Array.from({ length: 283 }, (_, i) => i);
    expect(encodeRanking(ranking, 283).length).toBe(566);
  });

  it("drops anything that isn't a valid line index rather than returning garbage", () => {
    expect(decodeRanking("zz00", 283)).toEqual([0]); // "zz" is 1295, beyond a 283-line pack
  });
});
