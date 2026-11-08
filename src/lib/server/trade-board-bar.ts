import { packIdFor } from "@/lib/pack-id";
import { countRecentPilotsWithPack } from "@/lib/server/db";
import type { BidPack } from "@/types/bidpack";

/**
 * When a seat's Trade Board opens. A board with two pilots on it only ever looks dead and invites nothing, so it stays
 * hidden until a seat has real numbers. Agreed with the owner: signed-in pilots with a real pack for that base,
 * aircraft and seat in the last 45 days.
 */
export const TRADE_BOARD_MIN_PILOTS = 15;
export const TRADE_BOARD_ACTIVE_DAYS = 45;

/** Where a seat's uploaded pack ids start: `uploaded-mem-md11-cap-`. */
export function seatPackPrefix(seat: Pick<BidPack, "base" | "aircraft" | "seat">): string {
  return packIdFor({ ...seat, month: "" });
}

export async function tradeBoardIsOpen(seat: Pick<BidPack, "base" | "aircraft" | "seat">, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - TRADE_BOARD_ACTIVE_DAYS * 24 * 60 * 60 * 1000);
  return (await countRecentPilotsWithPack(seatPackPrefix(seat), since)) >= TRADE_BOARD_MIN_PILOTS;
}
