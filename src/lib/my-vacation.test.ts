import { describe, expect, it } from "vitest";
import { findMyVacation, inThisMonth, otherMonthsNote, typedVacations } from "@/lib/my-vacation";
import type { BidPack, SeniorityEntry } from "@/types/bidpack";

// An October 2026 Memphis pack: the bid period runs Sep 28 to Oct 25, base days from 0130 CDT (0630Z), as the pack's own
// vacation schedule prints them.
const oct = { from: "2026-10-19T06:30:00Z", to: "2026-10-26T06:29:00Z", days: 7 };
const december = { from: "2026-12-07T07:30:00Z", to: "2026-12-14T07:29:00Z", days: 7 };
const list: SeniorityEntry[] = [
  { bidNumber: 1, seniority: 1180, vacations: [oct, december] },
  { bidNumber: 2, seniority: 1243 },
  { bidNumber: 3, seniority: 1301, vacations: [december] },
];
const pack = (over: Partial<BidPack> = {}): BidPack =>
  ({ id: "oct-md11", month: "OCT26", base: "MEM", aircraft: "MD11", seat: "CAP", bidPeriodStart: "2026-09-28", bidPeriodDays: 28, lines: [], seniorityList: list, ...over }) as BidPack;

describe("findMyVacation", () => {
  it("finds the pilot's vacation on the pack's schedule by their seniority number, only this month's", () => {
    const v = findMyVacation(pack(), { seniorityNumber: 1180 }, null);
    expect(v).toMatchObject({ status: "found", vacations: [oct], seniorityNumber: 1180, packHasSchedule: true });
    expect(v.entry?.bidNumber).toBe(1);
  });

  it("says there's none this month for a pilot on the list whose vacation is another month", () => {
    expect(findMyVacation(pack(), { seniorityNumber: 1301 }, null)).toMatchObject({ status: "none", vacations: [] });
    expect(findMyVacation(pack(), { seniorityNumber: 1243 }, null)).toMatchObject({ status: "none", vacations: [] });
  });

  it("names a vacation the pack lists in another month, and why no line changes, rather than saying there's none", () => {
    const v = findMyVacation(pack(), { seniorityNumber: 1301 }, null);
    expect(otherMonthsNote(v.entry, pack())).toBe(
      "The pack's vacation schedule has your vacation Dec 7 to Dec 13 (7 days). That's after this bid month's lines end on Oct 25, and a slide of up to 5 days (CBA 2026 7.E.2.a) can't bring it onto any line here, so no line changes. It counts on the pack for the bid month it falls in."
    );
    expect(otherMonthsNote(findMyVacation(pack(), { seniorityNumber: 1243 }, null).entry, pack())).toBeNull();
  });

  it("says when the number isn't on this pack's list, rather than reading someone else's", () => {
    expect(findMyVacation(pack(), { seniorityNumber: 1250 }, null)).toMatchObject({ status: "not-listed", vacations: [] });
  });

  it("finds them by the number kept with the place saved on Strategies", () => {
    expect(findMyVacation(pack(), null, { rank: 1, totalPilots: 3, source: "typed", seniorityNumber: 1180 }).status).toBe("found");
  });

  it("trusts a place saved without a number only on the pack it was saved on: next month that bid number is another pilot", () => {
    expect(findMyVacation(pack(), null, { rank: 1, totalPilots: 3, packId: "oct-md11" }).status).toBe("found");
    expect(findMyVacation(pack(), null, { rank: 1, totalPilots: 3, packId: "sep-md11" }).status).toBe("no-number");
    expect(findMyVacation(pack(), null, { rank: 1, totalPilots: 3 }).status).toBe("no-number");
  });

  it("can't find a pilot from a share of the seat", () => {
    expect(findMyVacation(pack(), null, { rank: 20, totalPilots: 100, source: "band" }).status).toBe("band");
  });

  it("says when the pack prints no vacation schedule", () => {
    const bare = pack({ seniorityList: list.map((e) => ({ bidNumber: e.bidNumber, seniority: e.seniority })) });
    expect(findMyVacation(bare, { seniorityNumber: 1180 }, null)).toMatchObject({ status: "no-schedule", packHasSchedule: false });
    expect(findMyVacation(bare, null, null).status).toBe("no-schedule");
  });

  it("uses what the pilot typed where the pack can't say, and over the pack's only when they said it's not right", () => {
    const typed = [{ firstDay: "2026-10-05", days: 7 }];
    expect(findMyVacation(pack(), { seniorityNumber: 1250 }, null, { vacations: typed })).toMatchObject({ status: "typed" });
    expect(findMyVacation(pack(), { seniorityNumber: 1180 }, null, { vacations: typed }).status).toBe("found");
    const corrected = findMyVacation(pack(), { seniorityNumber: 1180 }, null, { vacations: typed, preferTyped: true });
    expect(corrected.status).toBe("typed");
    expect(corrected.vacations[0]).toEqual({ from: "2026-10-05T06:30:00.000Z", to: "2026-10-12T06:29:00.000Z", days: 7 });
  });
});

describe("which vacations this month can feel", () => {
  it("one in the month, and one just after it that a trip's buffer or a slide reaches; not one weeks away", () => {
    expect(inThisMonth(oct, pack())).toBe(true);
    expect(inThisMonth({ from: "2026-10-27T06:30:00Z", to: "2026-11-03T06:29:00Z", days: 7 }, pack())).toBe(true);
    expect(inThisMonth(december, pack())).toBe(false);
  });

  it("keeps a typed vacation only when it's this month's, base day to base day", () => {
    expect(typedVacations([{ firstDay: "2026-12-07", days: 7 }], pack())).toEqual([]);
    expect(typedVacations([{ firstDay: "2026-10-19", days: 7 }], pack())).toEqual([{ from: "2026-10-19T06:30:00.000Z", to: "2026-10-26T06:29:00.000Z", days: 7 }]);
  });
});
