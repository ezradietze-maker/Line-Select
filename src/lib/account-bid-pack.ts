import { fetchServerBidPack, fetchServerBidPackMeta } from "@/lib/bidpack-server";
import { bidPackSavedAt, clearBidPack, loadBidPack, saveBidPack } from "@/lib/bidpack-storage";
import { isPackId, legacyPackIdFor, moveKeptUnderOldId, packIdFor } from "@/lib/pack-id";
import type { BidPack } from "@/types/bidpack";

/**
 * A pilot's pack, and whether the browser refused to keep it on this device (`bidPackSaveFailed`). `noneOnAccount` is
 * true only when the server answered that the account holds no pack: a fetch that failed leaves it false, so a guest's
 * pack is never saved over one the account does hold.
 */
export interface AccountPack {
  pack: BidPack | null;
  saveFailed: boolean;
  noneOnAccount: boolean;
}

/** A signed-in pilot with no pack on this device gets the one saved to their account, kept here too from then on. */
async function packFromAccount(userId: string): Promise<AccountPack> {
  const fetched = await fetchServerBidPack();
  if (fetched.kind !== "found") return { pack: null, saveFailed: false, noneOnAccount: fetched.kind === "none" };
  const { pack } = fetched;
  // Saved to the account before ids named the aircraft: what this device kept under the older id follows it.
  if (pack.id === packIdFor(pack)) moveKeptUnderOldId(legacyPackIdFor(pack), pack.id, userId);
  if (await saveBidPack(userId, pack)) return { pack, saveFailed: false, noneOnAccount: false };
  // Refused: a guest's pack left on the device goes, and it's tried again. Gzipped, the two nearly always fit side by
  // side, and the guest's upload stays for signing out or "Continue as guest" without parsing it again.
  clearBidPack(null);
  return { pack, saveFailed: !(await saveBidPack(userId, pack)), noneOnAccount: false };
}

/**
 * A signed-in pilot's pack: this device's copy, unless the account holds a different one saved after it — a new
 * month uploaded on the laptop reaches the phone still holding last month's. Without a connection, the device's copy.
 */
export async function accountBidPack(userId: string): Promise<AccountPack> {
  const local = await loadBidPack(userId);
  if (!local) return packFromAccount(userId);
  const kept = { pack: local, saveFailed: false, noneOnAccount: false };
  const server = await fetchServerBidPackMeta();
  if (!server || isPackId(server.packId, local)) return kept;
  const localAt = bidPackSavedAt(userId);
  if (localAt > 0) {
    if (server.savedAt <= localAt) return kept;
    const fromAccount = await packFromAccount(userId);
    return fromAccount.pack ? fromAccount : kept;
  }
  // A copy saved before the device kept a time beside it: a newer month only, never by guessing which was saved
  // last — this device's own upload may never have reached the account. Kept either way, it's stamped from now on.
  const fetched = await fetchServerBidPack();
  const remote = fetched.kind === "found" ? fetched.pack : null;
  const keep = remote && remote.bidPeriodStart && local.bidPeriodStart && remote.bidPeriodStart > local.bidPeriodStart ? remote : local;
  return { pack: keep, saveFailed: !(await saveBidPack(userId, keep)), noneOnAccount: false };
}
