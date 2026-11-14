import { compactBidPack, restoreBidPack } from "@/lib/bidpack-storage";
import { apiFetch, shownAccount } from "@/lib/shown-account";
import type { BidPack } from "@/types/bidpack";

/**
 * The browser's side of `/api/bid-pack`: a signed-in pilot's pack, gzipped in the compact format, kept on the server
 * so a new device or a cleared browser can get it back. Nothing here throws; a failure just means the pack stays on
 * this device only, as before. Each call names the account it's for (`apiFetch`): the one on screen when it's made.
 */

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** Saves the pack to the pilot's account. Returns whether it was kept. */
export async function saveServerBidPack(pack: BidPack, userId: string | null | undefined = shownAccount()): Promise<boolean> {
  if (pack.id.startsWith("sample") || typeof CompressionStream === "undefined") return false;
  try {
    const body = await gzip(JSON.stringify(compactBidPack(pack)));
    const res = await apiFetch("/api/bid-pack", { method: "PUT", headers: { "Content-Type": "application/gzip" }, body: body as BodyInit, credentials: "same-origin" }, userId);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The pack saved to the pilot's account; "none" only when the server said the account holds none. Anything else (no
 * signal, a server error, a session that lapsed, a browser that can't unzip it) is "unreachable": never a reason to
 * save a pack over the account's.
 */
export type ServerBidPackLoad = { kind: "found"; pack: BidPack } | { kind: "none" } | { kind: "unreachable" };

export async function fetchServerBidPack(userId: string | null | undefined = shownAccount()): Promise<ServerBidPackLoad> {
  try {
    const res = await apiFetch("/api/bid-pack", { credentials: "same-origin", cache: "no-store" }, userId);
    if (res.status === 204) return { kind: "none" };
    // Asked first even where the browser can't unzip a pack (Safari before 16.4): "none" needs no unzipping, and a
    // guest who signs up there still has their upload taken over.
    if (res.status !== 200 || typeof DecompressionStream === "undefined") return { kind: "unreachable" };
    return { kind: "found", pack: restoreBidPack(JSON.parse(await gunzip(await res.arrayBuffer()))) };
  } catch {
    return { kind: "unreachable" };
  }
}

/** Which pack the account holds and when it was saved (ms) — null when there's none or it can't be asked. */
export async function fetchServerBidPackMeta(userId: string | null | undefined = shownAccount()): Promise<{ packId: string; savedAt: number } | null> {
  try {
    const res = await apiFetch("/api/bid-pack?meta", { credentials: "same-origin", cache: "no-store" }, userId);
    if (res.status !== 200) return null;
    const data = (await res.json()) as { packId?: unknown; savedAt?: unknown };
    const savedAt = typeof data.savedAt === "string" ? Date.parse(data.savedAt) : NaN;
    return typeof data.packId === "string" && Number.isFinite(savedAt) ? { packId: data.packId, savedAt } : null;
  } catch {
    return null;
  }
}

export async function clearServerBidPack(userId: string | null | undefined = shownAccount()): Promise<void> {
  try {
    await apiFetch("/api/bid-pack", { method: "DELETE", credentials: "same-origin" }, userId);
  } catch {
    // A stale copy on the server is replaced by the next pack the pilot uploads.
  }
}
