import { describe, expect, it } from "vitest";
import { parsePilotModel } from "@/lib/brain/build-model";

const blankParams = { cities: [], cityScores: [], regions: [], dates: [], weekdays: [], n: -1, minHours: -1, maxHours: -1, frontBufferHours: -1, backRestHours: -1 };
const blankShape = { enoughAt: -1, fineAt: -1, worstAt: -1, ideal: -1, tolerance: -1, min: -1, max: -1, costEach: -1 };
const crit = (over: Record<string, unknown>) => ({
  id: "x", label: "x", metric: "creditHours", params: blankParams, shape: { ...blankShape, kind: "more" }, tier: "medium", points: 10, confidence: 0.8,
  evidence: [{ quote: "q", turn: 0 }], hardLimit: { op: "none", value: 0 }, reasoning: "r", ...over,
});
const raw = (criteria: unknown[]) =>
  ({
    synopsis: "s",
    home: { airports: ["san", "LAX", "nope"], commuter: "yes", commuteBufferHours: -1, frontBufferHours: 12, backRestHours: -1, backupFlights: 2 },
    criteria,
    threads: [{ id: "t", topic: "t", why: "w", priority: 1.4, status: "open", criteria: ["pay", "gone"] }],
    notMeasurable: [],
  }) as unknown as Parameters<typeof parsePilotModel>[0];

describe("parsePilotModel", () => {
  it("turns points into weights relative to the top priority, and -1 into 'not given'", () => {
    const { model } = parsePilotModel(raw([crit({ id: "pay", points: 40 }), crit({ id: "cities", metric: "layoversInCities", params: { ...blankParams, cities: ["hnl", "SYD", "bad1"] }, points: 10 })]));
    expect(model.criteria.map((c) => [c.id, c.weight])).toEqual([["pay", 1], ["cities", 0.25]]);
    expect(model.criteria[0].shape).toEqual({ kind: "more" });
    expect(model.criteria[1].params).toEqual({ cities: ["HNL", "SYD"] });
    expect(model.home).toEqual({ airports: ["SAN", "LAX"], commuter: true, frontBufferHours: 12, backupFlights: 2 });
  });

  it("counts a commuter's trips and commutes in departures, whatever the reading bound them to", () => {
    const { model } = parsePilotModel(raw([crit({ id: "trips", metric: "tripCount" }), crit({ id: "memphis", metric: "baseCommutesNeeded" })]));
    expect(model.criteria.map((c) => [c.id, c.metric])).toEqual([["trips", "homeDepartures"], ["memphis", "departureCommutes"]]);
  });

  it("drops what can't be measured instead of guessing", () => {
    const { model, dropped } = parsePilotModel(
      raw([
        crit({ id: "pay" }),
        crit({ id: "ghost", metric: "noSuchMetric" }),
        crit({ id: "noCities", metric: "layoverHoursInCities" }),
        crit({ id: "noDates", metric: "requestedDatesWorked" }),
        crit({ id: "badTarget", shape: { ...blankShape, kind: "target" } }),
      ])
    );
    expect(model.criteria.map((c) => c.id)).toEqual(["pay"]);
    expect(dropped).toHaveLength(4);
    // Threads keep only criteria that survived; priorities are clamped.
    expect(model.threads[0]).toMatchObject({ criteria: ["pay"], priority: 1, timesAsked: 0 });
  });

  it("reads graded city feelings, clamped, and drops a city measure without them", () => {
    const { model, dropped } = parsePilotModel(
      raw([
        crit({ id: "cities", metric: "layoverValue", params: { ...blankParams, cityScores: [{ city: "hnl", score: 1.4 }, { city: "CAN", score: -1 }, { city: "bad1", score: 0.5 }] } }),
        crit({ id: "empty", metric: "layoverValue" }),
      ])
    );
    expect(model.criteria.map((c) => c.params)).toEqual([{ cityScores: { HNL: 1, CAN: -1 } }]);
    expect(dropped).toEqual(["empty: layoverValue needs cityScores"]);
  });

  it("keeps dealbreakers and dates", () => {
    const { model } = parsePilotModel(
      raw([crit({ id: "wedding", metric: "requestedDatesWorked", params: { ...blankParams, dates: ["2026-10-12", "2026-10-10", "10/11"] }, shape: { ...blankShape, kind: "less", fineAt: 0 }, hardLimit: { op: "max", value: 0 } })])
    );
    expect(model.criteria[0]).toMatchObject({ params: { dates: ["2026-10-10", "2026-10-12"] }, shape: { kind: "less", fineAt: 0 }, hardLimit: { op: "max", value: 0 } });
  });
});

describe("applyCityRatings", () => {
  it("lets the pilot's own grades win over the brain's reading, and adds a location criterion when there was none", async () => {
    const { applyCityRatings } = await import("@/lib/brain/city-ratings");
    const { model } = parsePilotModel(raw([crit({ id: "lv", metric: "layoverValue", params: { ...blankParams, cityScores: [{ city: "CAN", score: -1 }, { city: "KIX", score: 0.3 }] } })]));
    const rated = applyCityRatings(model, { CAN: { score: -1 }, HNL: { score: 2 } });
    expect(rated.criteria[0].params?.cityScores).toEqual({ CAN: -0.5, KIX: 0.3, HNL: 1 });

    const { model: bare } = parsePilotModel(raw([crit({ id: "pay" })]));
    expect(applyCityRatings(bare, { HNL: { score: 2 }, SYD: { score: 1 } }).criteria.map((c) => c.metric)).toEqual(["creditHours", "layoverValue"]);
    expect(applyCityRatings(bare, {})).toBe(bare);
  });

  it("puts grades that change with the season on the city measures: the screen's own, else the ones read from their words", async () => {
    const { applyCityRatings } = await import("@/lib/brain/city-ratings");
    const { model } = parsePilotModel(raw([crit({ id: "lv", metric: "layoverValue", params: { ...blankParams, cityScores: [{ city: "ANC", score: 0.5 }, { city: "HNL", score: 1 }] } })]));
    const spoken = {
      ...model,
      facts: {
        values: {},
        citySeasons: [
          { city: "ANC", season: "winter" as const, months: [], change: -1 },
          { city: "HNL", season: "months" as const, months: [6, 7, 8], change: -0.5 },
        ],
        evidence: [],
      },
    };
    // From their words: a change from the city's usual grade, in grades of 0.5.
    expect(applyCityRatings(spoken, {}).criteria[0].params?.citySeasons).toEqual({ ANC: { winter: 0 }, HNL: { months: [{ months: [6, 7, 8], score: 0.75 }] } });
    // Their grade on the screen moves what the change starts from; their seasons on the screen replace the words'.
    const rated = applyCityRatings(spoken, { ANC: { score: 2 }, HNL: { score: 2, seasons: { months: { months: [7], score: -1 } } } });
    expect(rated.criteria[0].params?.citySeasons).toEqual({ ANC: { winter: 0.5 }, HNL: { months: [{ months: [7], score: -0.5 }] } });
  });

  it("puts hotels graded apart, and places named for better hotels, on the city measures", async () => {
    const { applyCityRatings } = await import("@/lib/brain/city-ratings");
    const { model } = parsePilotModel(raw([crit({ id: "lv", metric: "layoverValue", params: { ...blankParams, cityScores: [{ city: "OAK", score: 0.2 }] } })]));
    const spoken = { ...model, facts: { values: {}, hotelAreas: [{ city: "OAK", places: ["Pleasanton", "Dublin"], change: 1 }], evidence: [] } };
    // From their words alone: a grade up from the city's.
    expect(applyCityRatings(spoken, {}).criteria[0].params).toMatchObject({ hotelAreas: [{ city: "OAK", places: ["Pleasanton", "Dublin"], score: 0.7 }] });
    // With their grades on the screen: the city's grade is theirs, and a hotel they graded is graded.
    const rated = applyCityRatings(spoken, { OAK: { score: 0, hotels: { "SONESTA OAKLAND EMERYVILLE": -1 } } });
    expect(rated.criteria[0].params).toMatchObject({ cityScores: { OAK: 0 }, hotelScores: { "OAK|SONESTA OAKLAND EMERYVILLE": -0.5 }, hotelAreas: [{ city: "OAK", score: 0.5 }] });
    // Taken off the screen and out of their words, they're gone, whatever a saved model still holds.
    const cleared = applyCityRatings({ ...rated, facts: undefined }, { OAK: { score: 1 } });
    expect(cleared.criteria[0].params).not.toHaveProperty("hotelScores");
    expect(cleared.criteria[0].params).not.toHaveProperty("hotelAreas");
  });
});
