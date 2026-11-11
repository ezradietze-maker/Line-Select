import { gunzipSync } from "node:zlib";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { getBidPackRecord, setBidPackFingerprint } from "@/lib/server/db";
import { tradePackFingerprint } from "@/lib/server/pack-fingerprint";
import type { BidPack } from "@/types/bidpack";

/** A pack as kept on an account: the browser's compact pack, gzipped. */
export const unpackRecord = (data: Buffer): BidPack => restoreBidPack(JSON.parse(gunzipSync(data).toString("utf8")));

/**
 * The fingerprint of the pack on this pilot's account, if it's this pack; null if it isn't. Worked out once, and kept,
 * for a pack saved before fingerprints were.
 */
export async function accountPackFingerprint(userId: string, packId: string): Promise<string | null> {
  const record = await getBidPackRecord(userId);
  if (!record || record.packId !== packId) return null;
  if (record.fingerprint) return record.fingerprint;
  let fingerprint: string;
  try {
    fingerprint = tradePackFingerprint(unpackRecord(record.data));
  } catch {
    // A pack that can't be read is no copy to match on: left out, rather than stopping the seat's matching.
    return null;
  }
  await setBidPackFingerprint(userId, packId, fingerprint);
  return fingerprint;
}

/**
 * The pack a group is matched on: the one most of its pilots confirmed what they hold on, a tie going to the one
 * confirmed on most recently. A pack someone edited, or one read wrongly, can't stand in for everyone else's.
 */
export function groupFingerprint(holdings: readonly { fingerprint: string | null; confirmedAt: string }[]): string | null {
  const tally = new Map<string, { n: number; latest: string }>();
  for (const h of holdings) {
    if (!h.fingerprint) continue;
    const t = tally.get(h.fingerprint) ?? { n: 0, latest: "" };
    tally.set(h.fingerprint, { n: t.n + 1, latest: h.confirmedAt > t.latest ? h.confirmedAt : t.latest });
  }
  let best: [string, { n: number; latest: string }] | null = null;
  for (const entry of tally) if (!best || entry[1].n > best[1].n || (entry[1].n === best[1].n && entry[1].latest > best[1].latest)) best = entry;
  return best?.[0] ?? null;
}
