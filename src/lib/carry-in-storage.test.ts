import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_ELECTIONS } from "@/lib/phase-in";
import { carryInFromLogbook, carryInToSend, loadCarryIn, saveCarryIn } from "@/lib/carry-in-storage";
import type { LoggedMonth } from "@/types/logbook";

const logged = (month: string, report: string, release: string): LoggedMonth => ({
  id: month,
  base: "MEM",
  aircraft: "B767",
  seat: "CAP",
  month,
  outcome: "line",
  loggedAt: "2026-10-01T00:00:00Z",
  carryOut: [{ label: "Trip 99", report, release, international: true, creditHours: 22, duties: [] }],
});

describe("carryInFromLogbook", () => {
  const pack = { month: "DEC26", bidPeriodStart: "2026-11-30" };
  it("offers a logged trip that's flying when the new month starts", () => {
    const [trip] = carryInFromLogbook([logged("NOV26", "2026-11-28T14:00:00Z", "2026-12-01T02:00:00Z")], pack);
    expect(trip).toMatchObject({ kind: "trip", label: "Trip 99", international: true });
  });
  it("leaves out a trip from another month, and this month's own entry", () => {
    expect(carryInFromLogbook([logged("OCT26", "2026-10-20T14:00:00Z", "2026-10-23T02:00:00Z")], pack)).toEqual([]);
    expect(carryInFromLogbook([logged("DEC26", "2026-11-28T14:00:00Z", "2026-12-01T02:00:00Z")], pack)).toEqual([]);
  });
  it("is empty without a logbook or the pack's dates", () => {
    expect(carryInFromLogbook(undefined, pack)).toEqual([]);
    expect(carryInFromLogbook([logged("NOV26", "2026-11-28T14:00:00Z", "2026-12-01T02:00:00Z")], { month: "DEC26", bidPeriodStart: null })).toEqual([]);
  });
});

describe("saying nothing carries in", () => {
  afterEach(() => vi.unstubAllGlobals());
  const trip = { kind: "trip" as const, id: "c", label: "Trip 213", report: "2026-11-28T14:00:00Z", release: "2026-12-01T02:00:00Z", international: false };

  it("is sent as none, while an empty list nobody filled in isn't sent at all", () => {
    expect(carryInToSend({ items: [], none: true })).toEqual([]);
    expect(carryInToSend({ items: [] })).toBeUndefined();
    expect(carryInToSend({ items: [trip], none: true })).toEqual([trip]);
  });

  it("is kept on this device though there's nothing in the list", () => {
    const kept = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) } });
    saveCarryIn("u1", "p", { items: [], elections: NO_ELECTIONS, none: true });
    expect(loadCarryIn("u1", "p").none).toBe(true);
    saveCarryIn("u1", "p", { items: [], elections: NO_ELECTIONS });
    expect(loadCarryIn("u1", "p").none).toBeUndefined();
  });
});
