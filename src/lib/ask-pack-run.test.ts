import { describe, expect, it } from "vitest";
import { runAskQuery } from "@/lib/ask-pack-run";
import { cleanAskQuery, type AskQuery } from "@/lib/brain/ask-pack";
import { measure, prepareMetrics } from "@/lib/metrics/compute";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

const pack = SAMPLE_BID_PACK;
const pm = prepareMetrics(pack);

describe("ask your pack", () => {
  it("keeps only the measures and params the app has", () => {
    const q = cleanAskQuery({
      conditions: [
        { metric: "layoversInCities", op: "atLeast", value: 1, params: { cities: ["HNL"], n: 3 }, label: "Honolulu" },
        { metric: "madeUpMeasure", op: "atMost", value: 2, label: "nonsense" },
      ],
      sort: { metric: "nope", direction: "desc" },
      summary: "Lines with Honolulu",
      cannotAnswer: null,
    } as AskQuery);
    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0].params).toEqual({ cities: ["HNL"] });
    expect(q.sort).toBeNull();
    expect(cleanAskQuery({ ...q, cannotAnswer: "Pay rates aren't in the pack." }).conditions).toEqual([]);
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
