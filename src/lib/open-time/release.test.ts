import { describe, expect, it } from "vitest";
import { openTimePublishedAt } from "@/lib/open-time/engine";
import type { BidPack } from "@/types/bidpack";

describe("when the pack says open time is released", () => {
  const pack = (seat: "CAP" | "FO") =>
    ({
      month: "OCT26",
      base: "MEM",
      seat,
      bidCalendar: [
        { date: "2026-09-03", text: "OCT26 Bid Opens 1700 CT", time: "17:00", zone: "CT" },
        // As real covers print it: neither the month nor "Open Time", and both seats' times in one cell.
        { date: "2026-09-24", text: "OT Release CAP 2000 LBT F/O 2200 LBT", time: "20:00", zone: "LBT" },
      ],
    }) as unknown as BidPack;

  it("reads the cell real covers print, at each seat's own time", () => {
    expect(new Date(openTimePublishedAt(pack("CAP"))!).toISOString()).toBe("2026-09-25T01:00:00.000Z");
    expect(new Date(openTimePublishedAt(pack("FO"))!).toISOString()).toBe("2026-09-25T03:00:00.000Z");
  });
});
