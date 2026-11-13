import { describe, expect, it } from "vitest";
import { runAskQuery } from "@/lib/ask-pack-run";
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
