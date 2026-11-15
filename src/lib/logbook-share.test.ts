import { describe, expect, it, vi } from "vitest";
import { checkInShare, withMonthDeleted, withoutShares } from "@/lib/logbook";
import type { PreferenceProfile } from "@/types/preferences";
import type { LoggedMonth } from "@/types/logbook";

const month: LoggedMonth = {
  id: "MEM-MD11-CAP-NOV26",
  base: "MEM",
  aircraft: "MD11",
  seat: "CAP",
  month: "NOV26",
  outcome: "line",
  lineNumber: "1033",
  creditHours: 78.4,
  daysOff: 15,
  tafbHours: 210.6,
  rankedAt: 3,
  seniorityRank: 412,
  seniorityTotalPilots: 1200,
  loggedAt: "2026-11-02T00:00:00Z",
  sharedAt: "2026-11-02T00:00:01Z",
  checkIn: { feel: "better", at: "2026-12-01T00:00:00Z" },
};

describe("sharing how a month flew", () => {
  it("keeps the pilot's answer about showing their number, and never assumes yes", () => {
    expect(checkInShare({ ...month, holderShown: true }, null)?.holderShown).toBe(true);
    expect(checkInShare(month, null)?.holderShown).toBe(false);
  });

  it("taking back a share leaves the month logged, without its share marks", () => {
    const profile = { logbook: [{ ...month, holderShown: true }, { ...month, id: "other", holderShown: true }] } as unknown as PreferenceProfile;
    const one = withoutShares(profile, month.id).logbook!;
    expect(one[0].sharedAt).toBeUndefined();
    expect(one[0].holderShown).toBeUndefined();
    expect(one[0].lineNumber).toBe("1033");
    expect(one[1].sharedAt).toBeDefined();
    expect(withoutShares(profile).logbook!.every((m) => m.sharedAt === undefined && m.holderShown === undefined)).toBe(true);
  });

  it("re-sends a shared month with its check-in and the brain that ranked it", () => {
    expect(checkInShare(month, { brainVersion: 24, notesUsed: false })).toMatchObject({
      month: "NOV26",
      lineNumber: "1033",
      totalCreditHours: 78,
      awardedChoice: 3,
      monthFeel: "better",
      brainVersion: 24,
      notesUsed: false,
    });
  });

  it("sends nothing for a month never shared, or not yet checked in", () => {
    expect(checkInShare({ ...month, sharedAt: undefined }, null)).toBeNull();
    expect(checkInShare({ ...month, checkIn: undefined }, null)).toBeNull();
  });

  it("deleting a shared month withdraws its share first: once the month is gone, only withdrawing every share could", async () => {
    const profile = { logbook: [month, { ...month, id: "other", month: "OCT26" }] } as unknown as PreferenceProfile;
    const withdraw = vi.fn(async () => ({ ok: true }));
    const r = await withMonthDeleted(profile, month.id, withdraw);
    expect(withdraw).toHaveBeenCalledWith({ base: "MEM", aircraft: "MD11", seat: "CAP", month: "NOV26" });
    expect(r.profile!.logbook!.map((m) => m.id)).toEqual(["other"]);
  });

  it("keeps a shared month while its share can't be withdrawn, and deletes a month never shared without asking the server", async () => {
    const profile = { logbook: [month, { ...month, id: "other", sharedAt: undefined }] } as unknown as PreferenceProfile;
    const refused = await withMonthDeleted(profile, month.id, async () => ({ ok: false, error: "Couldn't reach the server." }));
    expect(refused).toEqual({ error: "Couldn't reach the server." });
    const withdraw = vi.fn(async () => ({ ok: true }));
    const r = await withMonthDeleted(profile, "other", withdraw);
    expect(withdraw).not.toHaveBeenCalled();
    expect(r.profile!.logbook!.map((m) => m.id)).toEqual([month.id]);
  });
});
