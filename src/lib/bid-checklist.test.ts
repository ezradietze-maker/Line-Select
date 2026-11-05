import { describe, expect, it } from "vitest";
import { bidChecklist, upcomingReminders, withBidEntered } from "@/lib/bid-checklist";
import { buildDeadlineReminderIcs } from "@/lib/ics-export";
import type { PreferenceProfile } from "@/types/preferences";

const pack = { id: "p1", base: "MEM", aircraft: "MD11", seat: "CAP" as const, month: "OCT26" };
const profile = { discoveredFacts: [] } as unknown as PreferenceProfile;
const done = (p: PreferenceProfile) => Object.fromEntries(bidChecklist(p, pack).map((i) => [i.id, i.done]));

describe("the bid checklist", () => {
  it("ticks what the app can see, and leaves entering the bid to the pilot", () => {
    expect(done(profile)).toEqual({ pack: true, interview: false, entered: false, award: false });
    const interviewed = { ...profile, pilotModel: { criteria: [] } } as unknown as PreferenceProfile;
    expect(done(interviewed).interview).toBe(true);
    const entered = withBidEntered(interviewed, "p1", true, new Date("2026-10-20T12:00:00Z"));
    expect(entered.bidChecklist?.p1.enteredAt).toBe("2026-10-20T12:00:00.000Z");
    expect(done(entered).entered).toBe(true);
    expect(done(withBidEntered(entered, "p1", false)).entered).toBe(false);
  });

  it("counts the award as logged when the logbook has this pack's month, from this pack or typed in", () => {
    const logged = { ...profile, logbook: [{ id: "a", base: "MEM", aircraft: "MD11", seat: "CAP", month: "OCT26", outcome: "line", loggedAt: "x" }] } as unknown as PreferenceProfile;
    expect(done(logged).award).toBe(true);
    expect(bidChecklist(logged, { ...pack, month: "NOV26" }).find((i) => i.id === "award")?.done).toBe(false);
  });
});

describe("bid deadline reminders", () => {
  const deadline = "2026-10-22T23:00:00.000Z";
  const at = Date.parse(deadline);

  it("schedules the day-before and hour-before reminders still to come", () => {
    expect(upcomingReminders(deadline, at - 3 * 86_400_000).map((r) => r.text)).toEqual(["Bid closes tomorrow", "Bid closes in an hour"]);
    expect(upcomingReminders(deadline, at - 5 * 3_600_000).map((r) => r.text)).toEqual(["Bid closes in an hour"]);
    expect(upcomingReminders(deadline, at)).toEqual([]);
    // Too far off for a browser timer: none yet (the calendar file covers it).
    expect(upcomingReminders(deadline, at - 40 * 86_400_000)).toEqual([]);
  });

  it("writes a calendar event with alarms a day and an hour before", () => {
    const ics = buildDeadlineReminderIcs(deadline, "MEM MD11 CAP OCT26", at - 86_400_000 * 5);
    expect(ics).toContain("DTSTART:20261022T230000Z");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics).toContain("TRIGGER:-PT1H");
    expect(ics).toContain("SUMMARY:Bid closes — MEM MD11 CAP OCT26");
  });
});
