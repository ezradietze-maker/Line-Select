import { describe, expect, it } from "vitest";
import { checkAskQuery, cityGradesOf, runAskQuery } from "@/lib/ask-pack-run";
import type { PilotModel } from "@/types/pilot-model";
import { ASK_QUERY_SCHEMA, cleanAskQuery, type AskQuery } from "@/lib/brain/ask-pack";
import { METRICS, METRICS_BY_ID } from "@/lib/metrics/catalog";
import { measure, prepareMetrics } from "@/lib/metrics/compute";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

const pack = SAMPLE_BID_PACK;
const pm = prepareMetrics(pack);

describe("ask your pack", () => {
  it("keeps only the params each measure takes", () => {
    const q = cleanAskQuery({
      conditions: [{ metric: "layoversInCities", op: "atLeast", value: 1, params: { cities: ["HNL"], n: 3 }, label: "Honolulu" }],
      sort: { metric: "daysOff", direction: "desc", params: { cities: ["HNL"] } },
      summary: "Lines with Honolulu",
      cannotAnswer: null,
    } as AskQuery);
    expect(q.cannotAnswer).toBeNull();
    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0].params).toEqual({ cities: ["HNL"] });
    expect(q.sort).toEqual({ metric: "daysOff", direction: "desc", params: undefined });
    expect(cleanAskQuery({ ...q, cannotAnswer: "Pay rates aren't in the pack." }).conditions).toEqual([]);
  });

  it("gives the model only the measures the app has to name", () => {
    const ids = METRICS.filter((m) => !m.retired).map((m) => m.id);
    const props = ASK_QUERY_SCHEMA.properties;
    expect(props.conditions.items.properties.metric.enum).toEqual(ids);
    expect(props.sort.anyOf[1].properties!.metric.enum).toEqual(ids);
    for (const id of ids) expect(METRICS_BY_ID.has(id)).toBe(true);
  });

  // The reviewer's case (Nov 2026): "layoversInCity" for the only condition, dropped, and every line shown under
  // "Lines with a Honolulu layover". A list never claims a condition it didn't check.
  it("says which condition it couldn't check instead of listing lines without it", () => {
    const honolulu = { op: "atLeast" as const, value: 1, params: { cities: ["HNL"] }, label: "Honolulu layovers" };
    const base = { sort: null, summary: "Lines with a Honolulu layover", cannotAnswer: null };
    const unknown = cleanAskQuery({ ...base, conditions: [{ metric: "layoversInCity", ...honolulu }] });
    expect(unknown.conditions).toEqual([]);
    expect(unknown.cannotAnswer).toContain('"Honolulu layovers"');

    // One of two dropped: neither is kept, and the one left out is named.
    const half = cleanAskQuery({
      ...base,
      conditions: [
        { metric: "daysOff", op: "atLeast", value: 15, label: "at least 15 days off" },
        { metric: "weekendsWorkedCount", op: "equals", value: 0, label: "no weekends worked" },
      ],
    });
    expect(half.conditions).toEqual([]);
    expect(half.cannotAnswer).toContain('"no weekends worked"');
    expect(half.cannotAnswer).not.toContain("15 days off");

    // A city measure left with no city counts nothing — "no Honolulu" would keep every line.
    for (const params of [undefined, { cities: [] }, { regions: ["hawaii"] }]) {
      const q = cleanAskQuery({ ...base, conditions: [{ metric: "layoversInCities", op: "equals", value: 0, params, label: "no Honolulu" } as AskQuery["conditions"][number]] });
      expect(q.cannotAnswer).toContain('"no Honolulu"');
    }

    // A sort on a measure the app doesn't have: the order isn't the one asked for.
    expect(cleanAskQuery({ ...base, conditions: [], sort: { metric: "bestLine", direction: "desc" } }).cannotAnswer).toContain("the order asked for");

    // Past six conditions, the rest weren't checked.
    const many = Array.from({ length: 7 }, (_, i) => ({ metric: "daysOff", op: "atLeast" as const, value: i, label: `at least ${i} days off` }));
    expect(cleanAskQuery({ ...base, conditions: many }).cannotAnswer).toContain('"at least 6 days off"');

    // The model's own reason wins over this one.
    expect(cleanAskQuery({ ...base, conditions: [{ metric: "nope", ...honolulu }], cannotAnswer: "Pay rates aren't in the pack." }).cannotAnswer).toBe("Pay rates aren't in the pack.");
  });

  it("keeps the lines that meet every condition, with their figures, in the pilot's order", () => {
    const daysOff = (id: string) => measure("daysOff", pack.lines.find((l) => l.id === id)!, pm);
    const most = Math.max(...pack.lines.map((l) => daysOff(l.id) ?? 0));
    const query: AskQuery = { conditions: [{ metric: "daysOff", op: "atLeast", value: most, label: "the most days off" }], sort: null, summary: "", cannotAnswer: null };
    const ranked = [...pack.lines].reverse().map((l) => l.id);
    const result = runAskQuery(query, pack, pm, {}, ranked);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.values[0] === most)).toBe(true);
    expect(result.map((r) => r.rank)).toEqual([...result.map((r) => r.rank)].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it("sorts by the asked-for measure when there's no number to meet", () => {
    const result = runAskQuery({ conditions: [], sort: { metric: "daysOff", direction: "desc" }, summary: "", cannotAnswer: null }, pack, pm);
    expect(result).toHaveLength(pack.lines.length);
    for (let i = 1; i < result.length; i++) expect(result[i - 1].sortValue! >= result[i].sortValue!).toBe(true);
  });
});

// Round 15 (Nov 2026): run as the model wrote them, "hnl", "HNL airport" and "Hawaii" each found no line, and "time in
// cities you like" read 0 on every line because nothing passed the pilot's grades. The pack check matches or says so.
describe("ask your pack, checked against the pack", () => {
  const ask = (params: AskQuery["conditions"][number]["params"], metric = "layoversInCities", value = 1): AskQuery =>
    cleanAskQuery({ conditions: [{ metric, op: "atLeast", value, params, label: "Honolulu layovers" }], sort: null, summary: "Lines with a Honolulu layover", cannotAnswer: null });
  const lines = (q: AskQuery, grades: Parameters<typeof checkAskQuery>[3] = null) => {
    const c = checkAskQuery(q, pack, pm, grades);
    return c.cannotAnswer ? c.cannotAnswer : runAskQuery(c, pack, pm, grades ?? {}).map((r) => r.line.id);
  };

  it("reads a city in any case or form as the pack's code", () => {
    const hnl = lines(ask({ cities: ["HNL"] }));
    expect(Array.isArray(hnl) && hnl.length).toBeGreaterThan(0);
    for (const cities of [["hnl"], ["HNL airport"], ["Honolulu"], [" honolulu "]]) expect(lines(ask({ cities }))).toEqual(hnl);
    expect(checkAskQuery(ask({ cities: ["hnl"] }), pack, pm, null).conditions[0].params).toEqual({ cities: ["HNL"] });
  });

  // Round 16: a city's name read as the code its first word spells. On a pack laying over in San Diego and San Juan,
  // "San Juan" and "San Antonio" both counted the San Diego layovers.
  it("reads a city's name as that city, never as a code its words happen to spell", () => {
    const sanAndSju = JSON.parse(JSON.stringify(pack).replaceAll('"LAX"', '"SAN"').replaceAll('"CDG"', '"SJU"')) as typeof pack;
    const spm = prepareMetrics(sanAndSju);
    const cityOf = (city: string) => {
      const q = checkAskQuery(ask({ cities: [city] }), sanAndSju, spm, null);
      return q.cannotAnswer ?? q.conditions[0].params?.cities;
    };
    expect(cityOf("San Juan")).toEqual(["SJU"]);
    expect(cityOf("San Diego")).toEqual(["SAN"]);
    expect(cityOf("San Antonio")).toBe('This pack\'s trips don\'t go to "San Antonio".');
    // A code with its own city's words, or an airport's, still reads as the code.
    for (const city of ["SAN airport", "SAN (San Diego)", "sju San Juan intl"]) expect(cityOf(city)).toEqual([city.slice(0, 3).toUpperCase()]);
  });

  it("names a city the pack's trips don't go to, rather than counting it as none", () => {
    expect(lines(ask({ cities: ["ZZZ"] }))).toBe('This pack\'s trips don\'t go to "ZZZ".');
    // "No ZZZ layovers" would otherwise keep every line.
    expect(lines(ask({ cities: ["HNL", "Atlantis"] }, "layoversInCities", 0))).toContain('"Atlantis"');
  });

  it("reads a region by any common name, and names one the pack has no layovers in", () => {
    const share = (regions: string[]) => ask({ regions } as never, "layoverShareInRegions", 0.01);
    const hawaii = lines(share(["hawaii"]));
    expect(Array.isArray(hawaii) && hawaii.length).toBeGreaterThan(0);
    for (const r of ["Hawaii", "HAWAII", "Hawaiian"]) expect(lines(share([r]))).toEqual(hawaii);
    expect(lines(share(["Europe"]))).toEqual(lines(share(["europe"])));
    expect(lines(share(["Asia"]))).toBe('This pack has no layovers in "Asia".');
    expect(lines(share(["Mars"]))).toBe('This pack has no layovers in "Mars".');
  });

  it("counts city grades from the pilot's own, and asks for them when there are none", () => {
    for (const metric of ["layoverValue", "fullDaysInLikedCities", "standbyDaysByCity"]) {
      expect(lines(ask(undefined, metric))).toMatch(/rate the cities first/);
      expect(checkAskQuery({ conditions: [], sort: { metric, direction: "desc" }, summary: "", cannotAnswer: null }, pack, pm, null).cannotAnswer).toMatch(/rate the cities first/);
    }
    const grades = { cityScores: { HNL: 1, CDG: 1, LAX: -1 } };
    const liked = lines(ask(undefined, "layoverValue"), grades);
    expect(Array.isArray(liked) && liked.length).toBeGreaterThan(0);
    const sorted = runAskQuery(checkAskQuery({ conditions: [], sort: { metric: "layoverValue", direction: "desc" }, summary: "", cannotAnswer: null }, pack, pm, grades), pack, pm, grades);
    expect(new Set(sorted.map((r) => r.sortValue)).size).toBeGreaterThan(1);
  });

  it("finds the grades where the ranking does: the model's city-graded priority, else the city screen", () => {
    const citySeasons = { HNL: { winter: 1 } };
    const model = { criteria: [{ id: "c", metric: "layoverValue", params: { cityScores: { HNL: 0.5 }, citySeasons } }] } as unknown as PilotModel;
    expect(cityGradesOf(model, undefined)).toMatchObject({ cityScores: { HNL: 0.5 }, citySeasons });
    expect(cityGradesOf(null, { CDG: { score: 2 } } as never)).toMatchObject({ cityScores: { CDG: 1 } });
    expect(cityGradesOf({ criteria: [] } as unknown as PilotModel, {})).toBeNull();
  });
});
