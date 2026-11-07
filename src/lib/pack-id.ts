import type { BidPack } from "@/types/bidpack";

type PackMeta = Pick<BidPack, "base" | "aircraft" | "seat" | "month">;

/**
 * An uploaded pack's id: base, aircraft, seat and month. Without the aircraft (as ids were made until Nov 2026), every
 * fleet's pack at a base came out the same — a pilot who uploaded the wrong fleet's pack and then the right one found
 * their stars, swaps and interview draft carried onto the other fleet's lines.
 */
export function packIdFor(meta: PackMeta): string {
  return `uploaded-${meta.base}-${meta.aircraft}-${meta.seat}-${meta.month}`.toLowerCase();
}

/** The id the same pack carried before ids named the aircraft. */
export function legacyPackIdFor(meta: Pick<BidPack, "base" | "seat" | "month">): string {
  return `uploaded-${meta.base}-${meta.seat}-${meta.month}`.toLowerCase();
}

/** Whether `id` names this pack: its own id, or the older one it had before — still in saved profiles and drafts. */
export function isPackId(id: string | null | undefined, pack: Pick<BidPack, "id" | "base" | "aircraft" | "seat" | "month">): boolean {
  if (!id) return false;
  return id === pack.id || (pack.id === packIdFor(pack) && id === legacyPackIdFor(pack));
}

/** A stored pack under its current id — one saved with the older id gets the new one. */
export function withCurrentPackId(pack: BidPack): BidPack {
  return pack.aircraft && pack.id === legacyPackIdFor(pack) ? { ...pack, id: packIdFor(pack) } : pack;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * What this device kept under a pack's older id — starred lines, swaps, the interview draft, the bid deadline, the
 * pending profile — moved to its new one, once, when the pack is first loaded under it. The older id was shared by
 * every fleet at the base, but each pilot (or the guest) on a device holds one pack: what they kept under it is that
 * pack's. Only their own keys move, and those that belong to no one in particular; another pilot's, or the guest's,
 * wait for their own pack to load — it may be another fleet's.
 */
export function moveKeptUnderOldId(oldId: string, newId: string, userId: string | null): void {
  if (typeof window === "undefined" || oldId === newId) return;
  const owner = userId ?? "guest";
  const someoneElses = (key: string) => (owner !== "guest" && key.includes(":guest:")) || [...key.matchAll(UUID)].some((m) => m[0] !== owner);
  try {
    const store = window.localStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => !!k && k.startsWith("line-select:"));
    const quoted = JSON.stringify(oldId);
    for (const key of keys) {
      // The packs themselves are saved by their callers.
      if (key.startsWith("line-select:bidpack:") || someoneElses(key)) continue;
      const value = store.getItem(key);
      if (value === null) continue;
      // Keys that name the pack (`…:<id>:v1`, `…:<id>`), and values that name it ("bidPackId": "<id>").
      const named = key.includes(`:${oldId}:`) || key.endsWith(`:${oldId}`);
      const movedValue = value.includes(quoted) ? value.split(quoted).join(JSON.stringify(newId)) : value;
      if (named) {
        const newKey = key.split(`:${oldId}`).join(`:${newId}`);
        if (store.getItem(newKey) === null) store.setItem(newKey, movedValue);
        store.removeItem(key);
      } else if (movedValue !== value) {
        store.setItem(key, movedValue);
      }
    }
  } catch {
    // Storage unavailable or full: the pack still loads; what was kept under the old id just isn't found.
  }
}
