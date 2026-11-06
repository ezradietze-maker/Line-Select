import { compactBidPack, restoreBidPack } from "@/lib/bidpack-storage";
import type { BidPack } from "@/types/bidpack";

/**
 * The browser's side of `/api/bid-pack`: a signed-in pilot's pack, gzipped in the compact format, kept on the server
 * so a new device or a cleared browser can get it back. Nothing here throws; a failure just means the pack stays on
 * this device only, as before.
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
export async function saveServerBidPack(pack: BidPack): Promise<boolean> {
  if (pack.id.startsWith("sample") || typeof CompressionStream === "undefined") return false;
  try {
    const body = await gzip(JSON.stringify(compactBidPack(pack)));
    const res = await fetch("/api/bid-pack", { method: "PUT", headers: { "Content-Type": "application/gzip" }, body: body as BodyInit, credentials: "same-origin" });
    return res.ok;
  } catch {
    return false;
  }
}

/** The pack saved to the pilot's account, or null when there's none or it can't be fetched. */
export async function fetchServerBidPack(): Promise<BidPack | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const res = await fetch("/api/bid-pack", { credentials: "same-origin", cache: "no-store" });
    if (res.status !== 200) return null;
    return restoreBidPack(JSON.parse(await gunzip(await res.arrayBuffer())));
  } catch {
    return null;
  }
}

export async function clearServerBidPack(): Promise<void> {
  try {
    await fetch("/api/bid-pack", { method: "DELETE", credentials: "same-origin" });
  } catch {
    // A stale copy on the server is replaced by the next pack the pilot uploads.
  }
}
