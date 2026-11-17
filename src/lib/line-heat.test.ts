import { describe, expect, it } from "vitest";
import { avoidedPhrases } from "@/lib/brain/pilot-words";
import { COLD_BELOW, heatModelOf, HOT_AT, lineHeat, sharePercents, tripHeatsOf, type HeatPiece } from "@/lib/line-heat";
import { buildLineTimeline } from "@/lib/line-timeline";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { Line } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const pack = SAMPLE_BID_PACK;
const days = pack.bidPeriodDays;
const lines = pack.lines.filter((l) => !l.estimated);

const criterion = (id: string, metric: string, shape: Criterion["shape"], extra: Partial<Criterion> = {}): Criterion => ({
  id,
  metric,
  shape,
  tier: "high",
  weight: 0.7,
  confidence: 1,
  label: id,
  evidence: [],
  status: "settled",
  ...extra,
});
const model = (criteria: Criterion[], home: PilotModel["home"] = null): PilotModel => ({ version: 2, home, threads: [], notMeasurable: [], synopsis: "", criteria });

const heatOf = (line: Line, m: PilotModel | null, grades: Parameters<typeof heatModelOf>[2] = null) => lineHeat(line, pack, heatModelOf(pack, m, grades));
const allPieces = (m: PilotModel | null) => lines.flatMap((l) => heatOf(l, m).pieces);
const factor = (p: HeatPiece, id: string) => p.factors.find((f) => f.id === id);

describe("sharePercents", () => {
  it("always adds up to 100", () => {
    expect(sharePercents({ hot: 1 / 3, mild: 1 / 3, cold: 1 / 3 })).toEqual({ hot: 34, mild: 33, cold: 33 });
    expect(sharePercents({ hot: 0.785, mild: 0.125, cold: 0.09 })).toEqual({ hot: 79, mild: 12, cold: 9 });
    expect(sharePercents({ hot: 1, mild: 0, cold: 0 })).toEqual({ hot: 100, mild: 0, cold: 0 });
    expect(sharePercents({ hot: 0, mild: 0, cold: 0 })).toEqual({ hot: 0, mild: 0, cold: 0 });
    for (const line of lines) {
      const p = sharePercents(heatOf(line, null).share);
      expect(p.hot + p.mild + p.cold, line.lineNumber).toBe(100);
    }
  });
});

describe("line heat", () => {
  it("rates every piece of every line, hot to cold, and the month's shares add up", () => {
    for (const line of lines) {
      const h = heatOf(line, null);
      expect(h.pieces.length, line.lineNumber).toBeGreaterThan(0);
      for (const p of h.pieces) {
        expect(p.heat).toBeGreaterThanOrEqual(0);
        expect(p.heat).toBeLessThanOrEqual(1);
        expect(p.factors.length).toBeGreaterThan(0);
        for (const f of p.factors) expect(f.weight).toBeGreaterThan(0);
      }
      expect(h.share.hot + h.share.mild + h.share.cold).toBeCloseTo(1, 6);
    }
    // The sample pack has both kinds: a map all one colour would say nothing.
    const heats = allPieces(null).map((p) => p.heat);
    expect(heats.some((x) => x >= HOT_AT)).toBe(true);
    expect(heats.some((x) => x < COLD_BELOW)).toBe(true);
  });

  it("puts each duty and layover where the Timeline draws it", () => {
    for (const line of lines) {
      const t = buildLineTimeline(line, pack, days);
      const h = heatOf(line, null);
      expect(h.pieces.filter((p) => p.kind === "duty").map((p) => [p.start, p.end])).toEqual(t.duties.map((d) => [d.start, d.end]));
      expect(h.pieces.filter((p) => p.kind === "layover").map((p) => [p.start, p.end])).toEqual(t.stays.map((s) => [s.start, s.end]));
      for (const p of h.pieces) expect(t.trips.some((x) => x.index === p.trip)).toBe(true);
      expect([...h.trips.keys()].sort()).toEqual(t.trips.map((x) => x.index).sort());
    }
  });

  it("splits the heat by trip, each piece under its own duty period, each trip's share adding up to 100", () => {
    for (const line of lines) {
      const h = heatOf(line, null);
      const trips = tripHeatsOf(h);
      expect([...trips.keys()].sort()).toEqual([...h.trips.keys()].sort());
      for (const p of h.pieces) expect((p.kind === "duty" ? trips.get(p.trip)!.duty : trips.get(p.trip)!.layover).get(p.duty)).toBe(p);
      for (const t of trips.values()) {
        const pct = sharePercents(t.share);
        expect(pct.hot + pct.mild + pct.cold).toBe(100);
      }
    }
  });

  it("rates nothing on a line with no real schedule, and says no share for it", () => {
    const estimated = { ...lines[0], estimated: true };
    const h = heatOf(estimated, null);
    expect(h.pieces).toEqual([]);
    expect(sharePercents(h.share)).toEqual({ hot: 0, mild: 0, cold: 0 });
    expect(heatOf({ ...lines[0], trips: [] }, null).pieces).toEqual([]);
  });

  it("says every reason in the pack's words or the ex-pilot's", () => {
    const pilot = model(
      [
        criterion("intl", "internationalLayoverShare", { kind: "less" }),
        criterion("sb", "hotelStandbyDays", { kind: "more" }),
        criterion("we", "weekendDaysOff", { kind: "more" }),
        criterion("wd", "weekdaysOff", { kind: "more" }, { params: { weekdays: [3] } }),
      ],
      { airports: ["DEN"], commuter: true }
    );
    const texts = new Set([...allPieces(null), ...allPieces(pilot)].flatMap((p) => p.factors.map((f) => f.text)));
    for (const text of texts) expect(avoidedPhrases(text), text).toEqual([]);
  });

  it("leaves out what only the pilot can call good or bad until they say", () => {
    const ids = new Set(allPieces(null).flatMap((p) => p.factors.map((f) => f.id)));
    for (const id of ["international", "standby", "commuteIn", "commuteHome", "dates", "weekdays"]) expect(ids.has(id as never), id).toBe(false);
  });

  it("follows the pilot's own numbers: three legs too many turns every three-leg duty cold", () => {
    const pilot = model([criterion("legs", "dutiesWithManyLegs", { kind: "less" }, { params: { n: 3 } })]);
    const duties = (m: PilotModel | null) => allPieces(m).filter((p) => p.kind === "duty" && (factor(p, "legs")?.text ?? "").startsWith("3 legs"));
    const before = duties(null);
    const after = duties(pilot);
    if (!before.length) return;
    for (const p of after) expect(factor(p, "legs")!.heat).toBe(0);
    const mean = (ps: HeatPiece[]) => ps.reduce((a, p) => a + p.heat, 0) / ps.length;
    expect(mean(after)).toBeLessThan(mean(before));
  });

  it("holds a piece that breaks a dealbreaker at the cold end", () => {
    const pilot = model([criterion("max", "maxDutyHours", { kind: "less" }, { tier: "must", hardLimit: { op: "max", value: 10 } })]);
    const long = allPieces(pilot).filter((p) => p.kind === "duty" && factor(p, "dutyHours")?.dealbreaker);
    for (const p of long) expect(p.heat).toBeLessThanOrEqual(0.05);
    const short = allPieces(pilot).filter((p) => p.kind === "duty" && factor(p, "dutyHours") && !factor(p, "dutyHours")!.dealbreaker);
    expect(short.length).toBeGreaterThan(0);
  });

  it("warms a layover in a city they love and cools one in a city they avoid", () => {
    const layover = allPieces(null).find((p) => p.kind === "layover" && !factor(p, "atDomicile"));
    expect(layover).toBeDefined();
    const city = factor(layover!, "layoverLength")!.text.split(" in ")[1];
    const find = (grade: number) => {
      for (const line of lines) {
        const p = heatOf(line, null, { cityScores: { [city]: grade } }).pieces.find((x) => x.kind === "layover" && x.start === layover!.start);
        if (p) return p;
      }
      return null;
    };
    const loved = find(1)!;
    const avoided = find(-1)!;
    expect(factor(loved, "city")!.text).toBe(`${city}, a city you love`);
    expect(factor(avoided, "city")!.text).toBe(`${city}, a city you avoid`);
    expect(loved.heat).toBeGreaterThan(avoided.heat);
  });

  it("counts a commuter's commutes, and a dealbreaker date worked", () => {
    const commuter = model([criterion("c", "departureCommutes", { kind: "less" })], { airports: ["DEN"], commuter: true });
    expect(allPieces(commuter).some((p) => factor(p, "commuteIn"))).toBe(true);
    const line = lines[0];
    const duty = heatOf(line, null).pieces.find((p) => p.kind === "duty")!;
    const date = new Date(Date.parse(`${pack.bidPeriodStart}T00:00:00Z`) + Math.floor(duty.start / 1440) * 86_400_000).toISOString().slice(0, 10);
    const needsOff = model([criterion("d", "requestedDatesWorked", { kind: "less" }, { tier: "must", params: { dates: [date] }, hardLimit: { op: "max", value: 0 } })]);
    const worked = heatOf(line, needsOff).pieces.find((p) => p.start === duty.start)!;
    expect(factor(worked, "dates")).toMatchObject({ heat: 0, dealbreaker: true });
    expect(worked.heat).toBeLessThanOrEqual(0.05);
  });
});
