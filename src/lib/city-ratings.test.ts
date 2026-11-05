import { describe, expect, it } from "vitest";
import { bidMonthOf, cityMarks, cityScoreInMonth, cityScoresFromRatings, citySeasonsFromRatings, describeCityRatings, effectiveCityScore, packCityFacts, rateCity, rateCitySeason, sentimentFromRating } from "@/lib/city-ratings";
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

describe("cityMarks", () => {
  it("keeps like apart from love, and dislike apart from avoid", () => {
    const marks = cityMarks({ HNL: { score: 2 }, DFW: { score: 1 }, EWR: { score: -1 }, CAN: { score: -2 } }, {});
    expect(marks).toEqual({ HNL: "love", DFW: "like", EWR: "dislike", CAN: "avoid" });
  });

  it("lets an older favorite/avoid mark stand only where the pilot gave no grade", () => {
    expect(cityMarks({ DFW: { score: 1 } }, { DFW: "love", SYD: "love" })).toEqual({ DFW: "like", SYD: "love" });
  });
});

describe("grades that change with the season", () => {
  // The ex-pilot: "an Anchorage layover in the summer is great; in the winter, less great"; Honolulu a little less June–August.
  const ratings = {
    ANC: { score: 1 as const, seasons: { summer: 2 as const, winter: -1 as const } },
    HNL: { score: 2 as const, seasons: { months: { months: [6, 7, 8], score: 1 as const } } },
    MSP: { score: 0 as const, seasons: { winter: -1 as const } },
  };

  it("grades each month, and marks the calendar with the bid month's grade", () => {
    expect(cityScoreInMonth("ANC", ratings, {}, 7)).toBe(2);
    expect(cityScoreInMonth("ANC", ratings, {}, 1)).toBe(-1);
    expect(cityScoreInMonth("ANC", ratings, {}, 10)).toBe(1);
    expect(cityMarks(ratings, {}, 1)).toEqual({ ANC: "dislike", HNL: "love", MSP: "dislike" });
    expect(cityMarks(ratings, {}, 7)).toEqual({ ANC: "love", HNL: "like" });
    expect(cityMarks(ratings, {})).toEqual({ ANC: "like", HNL: "love" });
    expect(bidMonthOf({ bidPeriodStart: "2026-09-28", bidPeriodDays: 28 })).toBe(10);
  });

  it("speaks the brain's scale, and tells it the months", () => {
    expect(citySeasonsFromRatings(ratings)).toEqual({ ANC: { summer: 1, winter: -0.5 }, HNL: { months: [{ months: [6, 7, 8], score: 0.5 }] }, MSP: { winter: -0.5 } });
    expect(describeCityRatings({ ANC: ratings.ANC })).toBe("ANC: Like; Love in summer (Jun–Aug), Dislike in winter (Nov–Apr)");
  });

  it("keeps a city neutral most of the year only while it has a season, and clears one season at a time", () => {
    let r = rateCitySeason("MSP", "winter", { score: -1 }, {}, {});
    expect(r).toEqual({ MSP: { score: 0, seasons: { winter: -1 } } });
    r = rateCitySeason("MSP", "winter", undefined, r, {});
    expect(r).toEqual({});
    // Unless they said something about it.
    expect(rateCitySeason("MSP", "winter", undefined, { MSP: { score: 0, note: "neutral, except in the dead of winter", seasons: { winter: -1 } } }, {})).toEqual({ MSP: { score: 0, note: "neutral, except in the dead of winter" } });
    r = rateCitySeason("ANC", "winter", undefined, ratings, {});
    expect(r.ANC).toEqual({ score: 1, seasons: { summer: 2 } });
    r = rateCitySeason("HNL", "months", undefined, ratings, {});
    expect(r.HNL).toEqual({ score: 2 });
    // Rated neutral with a season still on: kept.
    expect(rateCity("ANC", 0, ratings, {}).ratings.ANC).toMatchObject({ score: 0, seasons: { summer: 2, winter: -1 } });
  });
});
