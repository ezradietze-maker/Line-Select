import { describe, expect, it } from "vitest";
import { closeTimeWords, deviceZoneName, formatTimeLeft, urgencyFor } from "@/components/results/BidCountdown";

const H = 3_600_000;

describe("bid countdown", () => {
  it("colors by how close the deadline is", () => {
    expect(urgencyFor(5 * 24 * H)).toBe("calm");
    expect(urgencyFor(48 * H)).toBe("soon");
    expect(urgencyFor(20 * H)).toBe("today");
    expect(urgencyFor(2 * H)).toBe("imminent");
    expect(urgencyFor(0)).toBe("closed");
  });

  it("reads in days far out, and as a ticking clock inside two days", () => {
    expect(formatTimeLeft(3 * 24 * H + 4 * H + 22 * 60_000)).toEqual({ main: "3d 04h 22m", seconds: null });
    expect(formatTimeLeft(30 * H + 5 * 60_000 + 9_000)).toEqual({ main: "30:05", seconds: "09" });
  });
});

describe("the close time, with its zone", () => {
  const opts = (timeZone: string) => ({ timeZone, locale: "en-US" });

  it("names the zone the time is shown in, so a pilot away from Memphis doesn't read it as the pack's CT", () => {
    // The pack's "1200 CT" on Nov 20, 2026, on a device in Los Angeles and in Memphis.
    expect(closeTimeWords("2026-11-20T18:00:00.000Z", opts("America/Los_Angeles"))).toBe("Fri, Nov 20, 10:00 AM PST");
    expect(closeTimeWords("2026-11-20T18:00:00.000Z", opts("America/Chicago"))).toBe("Fri, Nov 20, 12:00 PM CST");
  });

  it("follows the clock change: 1200 CT after the March change is 1200 CDT", () => {
    expect(closeTimeWords("2027-03-15T17:00:00.000Z", opts("America/Chicago"))).toBe("Mon, Mar 15, 12:00 PM CDT");
    expect(deviceZoneName(new Date("2027-03-15T17:00:00.000Z"), opts("America/New_York"))).toBe("EDT");
    expect(deviceZoneName(new Date("2027-03-01T17:00:00.000Z"), opts("America/New_York"))).toBe("EST");
  });

  it("names no zone for a time that can't be read", () => {
    expect(deviceZoneName(new Date("not a date"))).toBeNull();
  });
});
