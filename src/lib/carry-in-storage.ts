import { NO_ELECTIONS, type CarryInItem, type CarryInTrip, type PhaseInElections } from "@/lib/phase-in";
import type { TypedVacation } from "@/lib/my-vacation";
import { GOAL_KINDS, type GoalAim } from "@/lib/vacation-goal";
import type { VacationChoice, VacationPlacement } from "@/lib/vacation-lines";
import type { BidPack } from "@/types/bidpack";
import type { LoggedMonth } from "@/types/logbook";

/** What the pilot told us they carry into this pack's month, and how they're answering the bid's phase-in questions. Kept per pack on this device. */
export interface CarryInState {
  items: CarryInItem[];
  elections: PhaseInElections;
  /** What the pilot wants done with each vacation, by its id; "use" when it isn't here. */
  vacationChoices?: Record<string, VacationChoice>;
  /** Vacations the pilot typed: where the pack can't say (not on its list, no schedule), or in place of it (`preferTyped`). */
  typedVacations?: TypedVacation[];
  /** The pilot said the pack's vacation isn't right: theirs is the one they typed. */
  preferTyped?: boolean;
  /** What they want from their vacation, as typed and as read (`lib/vacation-goal.ts`): every line's vacation slides for it. */
  vacationGoal?: { text: string; aims: GoalAim[] };
  /** Lines where the pilot placed the vacation themselves, by line id: kept over the goal. */
  vacationOverrides?: Record<string, VacationPlacement>;
  /** The pilot's switch: lines are ranked with their vacation where it's placed (on), or where the pack has it (off, the default). */
  slidesRank?: boolean;
  /**
   * Each moved line's placement as My Rankings last placed it (goal and the pilot's own), for screens that rank without
   * working every placement out again (`rankingAsShown`): Strategies and the Logbook rank the list the pilot bids.
   */
  appliedPlacements?: Record<string, VacationPlacement>;
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

/** A stored goal, only as the app writes it: its text and aims of known kinds. */
function readGoal(raw: unknown): CarryInState["vacationGoal"] | null {
  const g = raw as { text?: unknown; aims?: unknown } | null;
  if (!g || typeof g.text !== "string" || !Array.isArray(g.aims)) return null;
  const aims = g.aims.filter((a): a is GoalAim => !!a && typeof a === "object" && (GOAL_KINDS as readonly string[]).includes((a as { kind?: string }).kind ?? ""));
  return aims.length ? { text: g.text.slice(0, 300), aims } : null;
}

/** Whole days out from the vacation, as an expansion is counted (`expansionReach` looks 60 days at most). */
const expandDays = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 60;

/**
 * Stored placements, whole days by vacation id, each within a slide's reach, and any expansion (CBA 2026 7.E.3): read
 * back without it, Strategies and the Logbook ranked an expanded line as only slid, not the line My Rankings showed.
 */
function readOverrides(raw: unknown): CarryInState["vacationOverrides"] | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, VacationPlacement> = {};
  for (const [line, p] of Object.entries(raw as Record<string, { offsets?: Record<string, unknown>; expand?: Record<string, unknown>; waiveFrontBuffer?: unknown }>)) {
    if (!p || typeof p.offsets !== "object" || !p.offsets) continue;
    const offsets = Object.fromEntries(Object.entries(p.offsets).filter(([, o]) => Number.isInteger(o) && Math.abs(o as number) <= 5)) as Record<string, number>;
    const expand = Object.fromEntries(
      Object.entries(p.expand && typeof p.expand === "object" ? p.expand : {}).flatMap(([id, e]) => {
        const { before, after } = (e ?? {}) as { before?: unknown; after?: unknown };
        return expandDays(before) && expandDays(after) ? [[id, { before, after }]] : [];
      })
    );
    out[line] = { offsets, ...(Object.keys(expand).length ? { expand } : {}), ...(p.waiveFrontBuffer === true ? { waiveFrontBuffer: true } : {}) };
  }
  return Object.keys(out).length ? out : null;
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
      ...(Array.isArray(stored.typedVacations)
        ? { typedVacations: stored.typedVacations.filter((t): t is TypedVacation => !!t && typeof t.firstDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.firstDay) && Number.isInteger(t.days) && t.days >= 1 && t.days <= 60) }
        : {}),
      ...(stored.preferTyped === true ? { preferTyped: true } : {}),
      ...(readGoal(stored.vacationGoal) ? { vacationGoal: readGoal(stored.vacationGoal)! } : {}),
      ...(readOverrides(stored.vacationOverrides) ? { vacationOverrides: readOverrides(stored.vacationOverrides)! } : {}),
      ...(stored.slidesRank === true ? { slidesRank: true } : {}),
      ...(readOverrides(stored.appliedPlacements) ? { appliedPlacements: readOverrides(stored.appliedPlacements)! } : {}),
      ...(stored.none === true && !items.length ? { none: true } : {}),
    };
  } catch {
    return NO_CARRY_IN;
  }
}

export function saveCarryIn(userId: string | null, packId: string, state: CarryInState): void {
  if (typeof window === "undefined") return;
  try {
    // Kept while it says anything: a typed vacation or a goal alone is worth keeping.
    const says = state.items.length || state.none || Object.keys(state.vacationChoices ?? {}).length || state.typedVacations?.length || state.preferTyped || state.vacationGoal || Object.keys(state.vacationOverrides ?? {}).length || state.slidesRank;
    if (says) window.localStorage.setItem(key(userId, packId), JSON.stringify(state));
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
