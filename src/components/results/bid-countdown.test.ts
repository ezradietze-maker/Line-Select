import { describe, expect, it } from "vitest";
import { formatTimeLeft, urgencyFor } from "@/components/results/BidCountdown";

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
