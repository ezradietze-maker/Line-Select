import { describe, expect, it } from "vitest";
import { cityScoresFromRatings, describeCityRatings, effectiveCityScore, packCityFacts, rateCity, sentimentFromRating } from "@/lib/city-ratings";
import type { BidPack } from "@/types/bidpack";

describe("city ratings", () => {
  it("keeps the old favorite/avoid marks in step with the grades", () => {
    expect([2, 1, 0, -1, -2].map(sentimentFromRating)).toEqual(["love", "love", null, "avoid", "avoid"]);
    const a = rateCity("CAN", -1, {}, {});
    expect(a).toEqual({ ratings: { CAN: { score: -1 } }, sentiments: { CAN: "avoid" } });
    const b = rateCity("CAN", 0, a.ratings, a.sentiments);
    expect(b).toEqual({ ratings: {}, sentiments: {} });
  });

  it("reads an earlier mark as a grade until the pilot gives one", () => {
    expect(effectiveCityScore("HNL", {}, { HNL: "love" })).toBe(2);
    expect(effectiveCityScore("HNL", { HNL: { score: 1 } }, { HNL: "love" })).toBe(1);
    expect(effectiveCityScore("SYD", {}, {})).toBe(0);
  });

  it("speaks the brain's scale and language", () => {
    const r = { HNL: { score: 2 as const, reasons: ["food" as const, "friends" as const], note: "old squadron buddy lives there" }, CAN: { score: -2 as const, reasons: ["hassle" as const] } };
    expect(cityScoresFromRatings(r)).toEqual({ HNL: 1, CAN: -1 });
    expect(describeCityRatings(r)).toBe('HNL: Love (food nearby, friends there) — "old squadron buddy lives there"\nCAN: Avoid (hassle (customs, systems))');
  });

  it("describes each city from the pack's own trips, counting a shared trip once", () => {
    const layover = (city: string, hours: number, hotel: string) => ({ city, hours, hotelName: hotel, transportToHotel: null, transportFromHotel: null, startMinutes: 0, endMinutes: 0 });
    const trip = (id: string, lays: [string, number, string][], standbyAt?: string) => ({
      id, pairingNumber: id, startDayIndex: 0,
      schedule: [
        ...lays.map(([c, h, ho]) => ({ legs: [], layover: layover(c, h, ho) })),
        ...(standbyAt ? [{ legs: [{ isStandby: true, depAirport: standbyAt }], layover: null }] : []),
      ],
    });
    const t1 = trip("1", [["HNL", 30, "Hilton"], ["CAN", 24, "Langham"]]);
    const t2 = trip("2", [["HNL", 48, "Hilton"]], "KIX");
    const pack = { lines: [{ id: "a", trips: [t1, t2] }, { id: "b", trips: [t1] }] } as unknown as BidPack;
    const facts = packCityFacts(pack);
    expect(facts.map((f) => f.code)).toEqual(["HNL", "CAN"]);
    expect(facts[0]).toMatchObject({ trips: 2, lines: 2, medianHours: 48, minHours: 30, maxHours: 48, hotel: "Hilton" });
    expect(facts[1]).toMatchObject({ trips: 1, lines: 2 });
  });
});
