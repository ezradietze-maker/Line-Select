import { NO_ELECTIONS, type CarryInItem, type CarryInTrip, type PhaseInElections } from "@/lib/phase-in";
import type { VacationChoice } from "@/lib/vacation-lines";
import type { BidPack } from "@/types/bidpack";
import type { LoggedMonth } from "@/types/logbook";

/** What the pilot told us they carry into this pack's month, and how they're answering the bid's phase-in questions. Kept per pack on this device. */
export interface CarryInState {
  items: CarryInItem[];
  elections: PhaseInElections;
  /** What the pilot wants done with each vacation, by its id; "use" when it isn't here. */
  vacationChoices?: Record<string, VacationChoice>;
  /**
   * The pilot said nothing carries in from last month. Without it an empty list is only "not told": Open time and View/Add
   * read the two alike, but a trade can't hand on a trip in the month's first days until it's known (`carryInToSend`).
   */
  none?: boolean;
}

export const NO_CARRY_IN: CarryInState = { items: [], elections: NO_ELECTIONS };

function key(userId: string | null, packId: string): string {
  return `line-select:carry-in:${userId ?? "guest"}:${packId}:v1`;
}

function isItem(x: unknown): x is CarryInItem {
  const i = x as CarryInItem | null;
  if (!i || typeof i.id !== "string" || typeof i.label !== "string") return false;
  if (i.kind === "trip") return typeof i.report === "string" && typeof i.release === "string" && typeof i.international === "boolean";
  return i.kind === "rdays" && typeof i.firstDay === "string" && typeof i.days === "number" && typeof i.rp === "string";
}

export function loadCarryIn(userId: string | null, packId: string): CarryInState {
  if (typeof window === "undefined") return NO_CARRY_IN;
  try {
    const stored = JSON.parse(window.localStorage.getItem(key(userId, packId)) ?? "null") as Partial<CarryInState> | null;
    if (!stored || !Array.isArray(stored.items)) return NO_CARRY_IN;
    const items = stored.items.filter(isItem);
    return {
      items,
      elections: { ...NO_ELECTIONS, ...stored.elections },
      ...(stored.vacationChoices ? { vacationChoices: stored.vacationChoices } : {}),
      ...(stored.none === true && !items.length ? { none: true } : {}),
    };
  } catch {
    return NO_CARRY_IN;
  }
}

export function saveCarryIn(userId: string | null, packId: string, state: CarryInState): void {
  if (typeof window === "undefined") return;
  try {
    if (state.items.length || state.none || Object.keys(state.vacationChoices ?? {}).length) window.localStorage.setItem(key(userId, packId), JSON.stringify(state));
    else window.localStorage.removeItem(key(userId, packId));
  } catch {
    // Storage unavailable: it lasts as long as the page.
  }
}

/** What a trade has to fit around, as sent with what the pilot holds: what they carry in, none, or undefined while they haven't said. */
export function carryInToSend(state: Pick<CarryInState, "items" | "none">): CarryInItem[] | undefined {
  if (state.items.length) return state.items;
  return state.none ? [] : undefined;
}

/**
 * Whether what was sent with what a pilot holds is still what this device has them carrying in (`carryInToSend`), by
 * what the checks read: the times, not the label the server trims. A change on Your rankings reaches the trades only
 * when they confirm again.
 */
export function sameCarryIn(sent: readonly CarryInItem[] | undefined, here: readonly CarryInItem[] | undefined): boolean {
  if (sent === undefined || here === undefined) return sent === here;
  const named = (items: readonly CarryInItem[]) =>
    items
      .map((c) => (c.kind === "trip" ? `trip|${Date.parse(c.report)}|${Date.parse(c.release)}|${c.international}` : `rdays|${c.firstDay}|${c.days}|${c.rp}`))
      .sort()
      .join(",");
  return named(sent) === named(here);
}

/** Trips logged last month that are still flying when this pack's month starts: the Logbook kept them for this. */
export function carryInFromLogbook(logbook: LoggedMonth[] | undefined, pack: Pick<BidPack, "bidPeriodStart" | "month">): CarryInTrip[] {
  if (!pack.bidPeriodStart) return [];
  const start = Date.parse(pack.bidPeriodStart);
  return (logbook ?? [])
    .filter((m) => m.month !== pack.month)
    .flatMap((m) => m.carryOut ?? [])
    // A day either side of the first: the date is the base's, the release an instant.
    .filter((t) => Date.parse(t.release) > start - 86_400_000 && Date.parse(t.report) < start + 86_400_000)
    .map((t, i) => ({ kind: "trip", id: `log-${i}-${t.report}`, ...t }));
}
