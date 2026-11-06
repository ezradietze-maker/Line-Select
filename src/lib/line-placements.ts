/**
 * Where the pilot put lines by hand on their ranked list. Dropping one line on another swaps the two, and that's the
 * pilot's own word on the order: it stays, whatever the brain makes of it. The brain still learns from the swap (see
 * `choicesFromDrag`), but even when it can't explain the move, the order the pilot sees and bids is theirs.
 * Per bid pack and local to the device, like stars and hidden lines: line ids from another pack mean nothing here.
 */
export interface Placement {
  /** Also tags the line choices this swap added, so undoing it takes back what the brain learned from it too. */
  id: string;
  /**
   * The lines from the dropped one to the one it was dropped on, in the order the pilot left them. Kept as an order
   * rather than as "swap these two", so a brain that has since learned the swap doesn't get it swapped back.
   */
  order: string[];
}

/**
 * A list in the pilot's order: each placement, oldest first, puts its lines back in the pilot's order in the places
 * those lines hold now. Where the brain ranks the group can move; the order within it can't.
 */
export function applyPlacements<T>(list: T[], placements: Placement[], idOf: (item: T) => string): T[] {
  if (placements.length === 0) return list;
  const out = [...list];
  const indexOf = new Map(out.map((x, i) => [idOf(x), i]));
  for (const p of placements) {
    const present = p.order.filter((id) => indexOf.has(id));
    if (present.length < 2) continue;
    const slots = present.map((id) => indexOf.get(id)!).sort((a, b) => a - b);
    const items = present.map((id) => out[indexOf.get(id)!]);
    slots.forEach((slot, k) => {
      out[slot] = items[k];
      indexOf.set(present[k], slot);
    });
  }
  return out;
}

/** A drag from `fromIndex` onto `toIndex` in the list as shown: the two lines trade places, the ones between stay put. */
export function placementFromDrag(ids: string[], fromIndex: number, toIndex: number, id: string): Placement | null {
  if (fromIndex === toIndex || !ids[fromIndex] || !ids[toIndex]) return null;
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  const order = ids.slice(lo, hi + 1);
  [order[0], order[order.length - 1]] = [order[order.length - 1], order[0]];
  return { id, order };
}

/** Placements with their lines narrowed to the ones still in the pack (none left that orders fewer than two). */
export function prunePlacements(placements: Placement[], validLineIds: Set<string>): Placement[] {
  return placements
    .map((p) => ({ ...p, order: p.order.filter((id) => validLineIds.has(id)) }))
    .filter((p) => p.order.length >= 2);
}

function placementsKey(userId: string | null, bidPackId: string): string {
  return `line-select:line-placements:${userId ?? "guest"}:${bidPackId}:v1`;
}

export function loadPlacements(userId: string | null, bidPackId: string): Placement[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(placementsKey(userId, bidPackId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Placement => !!p && typeof p.id === "string" && Array.isArray(p.order) && p.order.every((x: unknown) => typeof x === "string")
    );
  } catch {
    return [];
  }
}

export function savePlacements(userId: string | null, bidPackId: string, placements: Placement[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(placementsKey(userId, bidPackId), JSON.stringify(placements));
  } catch {
    // storage unavailable — placements just won't persist this session
  }
}
