import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.hoisted(() => vi.fn<(prefix: string, since: Date) => Promise<number>>(async () => 0));
vi.mock("@/lib/server/db", () => ({ countRecentPilotsWithPack: count }));

const { seatPackPrefix, TRADE_BOARD_ACTIVE_DAYS, TRADE_BOARD_MIN_PILOTS, tradeBoardIsOpen } = await import("./trade-board-bar");
const seat = { base: "MEM", aircraft: "MD11", seat: "CAP" as const };

beforeEach(() => count.mockClear());

describe("when a seat's Trade Board opens", () => {
  it("holds to the bar: 15 pilots in 45 days", () => {
    expect(TRADE_BOARD_MIN_PILOTS).toBe(15);
    expect(TRADE_BOARD_ACTIVE_DAYS).toBe(45);
  });

  it("opens at the bar and not before", async () => {
    count.mockResolvedValue(14);
    expect(await tradeBoardIsOpen(seat)).toBe(false);
    count.mockResolvedValue(15);
    expect(await tradeBoardIsOpen(seat)).toBe(true);
  });

  it("counts only this seat, and only recent pilots", async () => {
    const now = new Date("2026-11-08T00:00:00Z");
    await tradeBoardIsOpen(seat, now);
    const [prefix, since] = count.mock.calls[0];
    expect(prefix).toBe("uploaded-mem-md11-cap-");
    expect(since.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(seatPackPrefix({ ...seat, seat: "FO" })).toBe("uploaded-mem-md11-fo-");
  });
});
