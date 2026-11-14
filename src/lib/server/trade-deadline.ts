import { packIdFor } from "@/lib/pack-id";
import { getBidPackRecord } from "@/lib/server/db";
import { unpackRecord } from "@/lib/server/trade-pack";
import { tradeDeadlineHours } from "@/lib/trades/legality";
import { pastTradeDeadline } from "@/lib/trades/offer-trips";
import type { BidPack, Seat } from "@/types/bidpack";
import type { BidPackMetaSnapshot, TripSnapshot } from "@/types/trade";

/** Said when a trip on the board is past its deadline (`pastTradeDeadline`). */
export function tooLateToTrade(meta: Pick<BidPackMetaSnapshot, "month">): string {
  const hours = tradeDeadlineHours(meta);
  return `Too late to trade that trip. Trades are due ${hours} hour${hours === 1 ? "" : "s"} before show.`;
}

/**
 * Whether any of these trips on the board is past its trade deadline (`pastTradeDeadline`). The show is read from the
 * pack on the first of `pilots`' accounts that is this seat's month; without one, from the day each trip starts.
 */
export async function pastBoardDeadline(meta: BidPackMetaSnapshot, trips: readonly TripSnapshot[], pilots: readonly string[], now = Date.now()): Promise<boolean> {
  const packId = packIdFor({ ...meta, seat: meta.seat as Seat });
  let pack: BidPack | null = null;
  for (const pilot of pilots) {
    const record = await getBidPackRecord(pilot);
    if (record?.packId !== packId) continue;
    try {
      pack = unpackRecord(record.data);
      break;
    } catch {
      // A pack that can't be read says nothing: the next pilot's, or the trips' days.
    }
  }
  return trips.some((t) => pastTradeDeadline(pack, meta, t, now));
}
