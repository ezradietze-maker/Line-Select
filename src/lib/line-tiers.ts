import { choicesFromDrag } from "@/lib/brain/profile-model";
import type { LineChoice } from "@/types/pilot-model";

/**
 * Tiers: the pilot's own groups for sorting a month's lines, Best down to Not bid. A line has no tier until the pilot
 * gives it one, and looks as it always has until then. The bid order is tiers in order, with the lines that have no tier
 * in their usual ranked order after the tiers the pilot moved lines up into and before the ones they moved lines down
 * into, so nothing moves until they move it. Not bid is left out of what gets bid.
 *
 * Inside a tier, lines keep the order they come in: score, with the pilot's own swaps (`line-placements.ts`) applied.
 * Per bid pack and local to the device, like placements: line ids from another pack mean nothing here.
 */

export const NOT_BID_ID = "not-bid";
/** How many tiers a pilot can add to the five they start with. */
export const MAX_ADDED_TIERS = 10;
const STARTING_TIER_COUNT = 5;

export interface Tier {
  id: string;
  name: string;
  /** Below the lines with no tier: the ones the pilot moved down. */
  below?: boolean;
}

export const DEFAULT_TIERS: Tier[] = [
  { id: "best", name: "Best" },
  { id: "better", name: "Better" },
  { id: "good", name: "Good" },
  { id: "backup", name: "Backup", below: true },
  { id: NOT_BID_ID, name: "Not bid", below: true },
];

export interface TierState {
  tiers: Tier[];
  /** Line id to tier id. A line missing here has no tier. */
  assigned: Record<string, string>;
  /** Lines parked in the scratch area: out of the list while the pilot sorts, still in the bid where they'd rank. */
  setAside: string[];
  /** Line id to the tier move that last taught the brain about it, so the line's next move replaces what it said. */
  taught: Record<string, string>;
}

export const EMPTY_TIERS: TierState = { tiers: DEFAULT_TIERS, assigned: {}, setAside: [], taught: {} };

export function hasTiers(s: TierState): boolean {
  return Object.keys(s.assigned).length > 0 || s.setAside.length > 0;
}

export function notBidIds(s: TierState): Set<string> {
  return new Set(Object.keys(s.assigned).filter((id) => s.assigned[id] === NOT_BID_ID));
}

/**
 * A list in tier order. With no tiers in use it's the same list, so a pilot who never touches them sees exactly what
 * they saw before. Lines set aside hold the place of a line with no tier.
 */
export function applyTiers<T>(list: T[], s: TierState, idOf: (item: T) => string): T[] {
  if (Object.keys(s.assigned).length === 0) return list;
  const byTier = new Map<string, T[]>(s.tiers.map((t) => [t.id, []]));
  const none: T[] = [];
  for (const item of list) {
    const bucket = byTier.get(s.assigned[idOf(item)]);
    (bucket ?? none).push(item);
  }
  return [...s.tiers.filter((t) => !t.below).flatMap((t) => byTier.get(t.id)!), ...none, ...s.tiers.filter((t) => t.below).flatMap((t) => byTier.get(t.id)!)];
}

export const NO_TIER_HEADING = "No tier";

export interface TierHeading {
  name: string;
  count: number;
}

/** Which listed lines start a group, and the group's name and size; empty when no tiers are in use. */
export function tierHeadings(ids: string[], s: TierState): Map<string, TierHeading> {
  const out = new Map<string, TierHeading>();
  if (Object.keys(s.assigned).length === 0) return out;
  const nameOf = new Map(s.tiers.map((t) => [t.id, t.name]));
  const group = (id: string) => (nameOf.has(s.assigned[id]) ? s.assigned[id] : "");
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(group(id), (counts.get(group(id)) ?? 0) + 1);
  ids.forEach((id, i) => {
    const g = group(id);
    if (i > 0 && group(ids[i - 1]) === g) return;
    out.set(id, { name: g ? nameOf.get(g)! : NO_TIER_HEADING, count: counts.get(g)! });
  });
  return out;
}

/** Puts lines in a tier, or takes them out of any (`tierId` null). A line set aside comes back to the list. */
export function moveToTier(s: TierState, lineIds: string[], tierId: string | null): TierState {
  const assigned = { ...s.assigned };
  for (const id of lineIds) {
    if (tierId === null) delete assigned[id];
    else assigned[id] = tierId;
  }
  return { ...s, assigned, setAside: s.setAside.filter((id) => !lineIds.includes(id)) };
}

/** The lines a move would really change: one already there says nothing new, and keeps what it has taught. */
export function linesThatWouldMove(s: TierState, lineIds: string[], tierId: string | null): string[] {
  return lineIds.filter((id) => (s.assigned[id] ?? null) !== tierId || s.setAside.includes(id));
}

export function setAsideLines(s: TierState, lineIds: string[]): TierState {
  const assigned = { ...s.assigned };
  for (const id of lineIds) delete assigned[id];
  return { ...s, assigned, setAside: [...s.setAside.filter((id) => !lineIds.includes(id)), ...lineIds] };
}

export function bringBack(s: TierState, lineIds: string[]): TierState {
  return { ...s, setAside: s.setAside.filter((id) => !lineIds.includes(id)) };
}

/** Two lines trade tiers: a drag from one tier onto a line in another. */
export function swapTiers(s: TierState, a: string, b: string): TierState {
  const assigned = { ...s.assigned };
  const [ta, tb] = [assigned[a], assigned[b]];
  if (tb) assigned[a] = tb;
  else delete assigned[a];
  if (ta) assigned[b] = ta;
  else delete assigned[b];
  return { ...s, assigned };
}

export function renameTier(s: TierState, tierId: string, name: string): TierState {
  const clean = name.trim().slice(0, 30);
  if (!clean) return s;
  return { ...s, tiers: s.tiers.map((t) => (t.id === tierId ? { ...t, name: clean } : t)) };
}

export function canAddTier(s: TierState): boolean {
  return s.tiers.length < STARTING_TIER_COUNT + MAX_ADDED_TIERS;
}

/** A new tier goes last among the ones above the lines with no tier. */
export function addTier(s: TierState, name: string, id: string): TierState {
  const clean = name.trim().slice(0, 30);
  if (!clean || !canAddTier(s)) return s;
  const firstBelow = s.tiers.findIndex((t) => t.below);
  const at = firstBelow === -1 ? s.tiers.length : firstBelow;
  return { ...s, tiers: [...s.tiers.slice(0, at), { id, name: clean }, ...s.tiers.slice(at)] };
}

/** Only a tier the pilot added can go; its lines then have no tier. */
export function removeTier(s: TierState, tierId: string): TierState {
  if (DEFAULT_TIERS.some((t) => t.id === tierId)) return s;
  return { ...s, tiers: s.tiers.filter((t) => t.id !== tierId), assigned: Object.fromEntries(Object.entries(s.assigned).filter(([, t]) => t !== tierId)) };
}

export function clearTiers(s: TierState): TierState {
  return { ...s, assigned: {}, setAside: [], taught: {} };
}

/** Tiers narrowed to lines still in the pack. */
export function pruneTiers(s: TierState, validLineIds: Set<string>): TierState {
  return {
    ...s,
    assigned: Object.fromEntries(Object.entries(s.assigned).filter(([id]) => validLineIds.has(id))),
    setAside: s.setAside.filter((id) => validLineIds.has(id)),
    taught: Object.fromEntries(Object.entries(s.taught).filter(([id]) => validLineIds.has(id))),
  };
}

/** The most pairs one moved line adds, and the most moved lines one bulk move teaches about: enough to read the move, without filling the profile. */
export const MAX_PAIRS_PER_LINE = 20;
export const MAX_LINES_TAUGHT = 25;

function evenly<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]);
}

export interface TierLesson {
  lineId: string;
  /** The move's id on its choices, so undoing it takes back what the brain learned from it. */
  moveId: string;
  choices: LineChoice[];
}

/**
 * What a move says, in the learner's own swap format. A line moved up beats the lines it passes, and one moved down
 * loses to them; the lines it comes to rest beside come first, and the learner rides half its evidence on the first
 * pair (`swapPairWeights`). Each line moved is its own choice, so it counts as one swap's worth however far it went, and
 * the learner's own "does no harm on close calls" reading applies to it as to any swap.
 *
 * Only a real statement about order teaches: a line taken out of its tier or set aside says nothing about what it's
 * better than.
 */
export function lessonsFromMove(
  before: string[],
  after: string[],
  moved: string[],
  numberOf: (lineId: string) => string | undefined,
  moveId: string,
  packId?: string
): TierLesson[] {
  const was = new Map(before.map((id, i) => [id, i]));
  const movedSet = new Set(moved);
  const out: TierLesson[] = [];
  evenly(moved, MAX_LINES_TAUGHT).forEach((lineId, k) => {
    const from = was.get(lineId);
    const to = after.indexOf(lineId);
    const number = numberOf(lineId);
    if (from === undefined || to === -1 || from === to || !number) return;
    const up = to < from;
    // The lines between where it was and where it landed, nearest its new place first. The others moved in the same
    // gesture were put together, and say nothing about each other.
    const passed = (up ? after.slice(to + 1) : after.slice(0, to).reverse()).filter((id) => !movedSet.has(id) && (up ? was.get(id)! < from : was.get(id)! > from));
    const pairs = evenly(passed, MAX_PAIRS_PER_LINE).flatMap((id) => {
      const other = numberOf(id);
      return other ? [up ? { favored: number, overtaken: other } : { favored: other, overtaken: number }] : [];
    });
    if (pairs.length === 0) return;
    const id = `${moveId}.${k}`;
    out.push({ lineId, moveId: id, choices: choicesFromDrag(pairs, id, packId) });
  });
  return out;
}

export interface TierHistory {
  past: TierState[];
  future: TierState[];
}

export const EMPTY_HISTORY: TierHistory = { past: [], future: [] };
const HISTORY_LIMIT = 100;

export function pushHistory(h: TierHistory, current: TierState): TierHistory {
  return { past: [...h.past, current].slice(-HISTORY_LIMIT), future: [] };
}

export function undoTiers(h: TierHistory, current: TierState): { state: TierState; history: TierHistory } | null {
  const state = h.past[h.past.length - 1];
  return state ? { state, history: { past: h.past.slice(0, -1), future: [current, ...h.future] } } : null;
}

export function redoTiers(h: TierHistory, current: TierState): { state: TierState; history: TierHistory } | null {
  const state = h.future[0];
  return state ? { state, history: { past: [...h.past, current], future: h.future.slice(1) } } : null;
}

/** Which tier moves' lessons stop counting and which start, going from one state to another. */
export function lessonChanges(from: TierState, to: TierState): { retract: string[]; add: string[] } {
  const before = new Set(Object.values(from.taught));
  const after = new Set(Object.values(to.taught));
  return { retract: [...before].filter((m) => !after.has(m)), add: [...after].filter((m) => !before.has(m)) };
}

function tiersKey(userId: string | null, bidPackId: string): string {
  return `line-select:line-tiers:${userId ?? "guest"}:${bidPackId}:v1`;
}

const isStringRecord = (x: unknown): x is Record<string, string> => !!x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every((v) => typeof v === "string");

export function loadTiers(userId: string | null, bidPackId: string): TierState {
  if (typeof window === "undefined") return EMPTY_TIERS;
  try {
    const raw = window.localStorage.getItem(tiersKey(userId, bidPackId));
    const p = raw ? (JSON.parse(raw) as Partial<TierState>) : null;
    if (!p || typeof p !== "object") return EMPTY_TIERS;
    const tiers = Array.isArray(p.tiers) && p.tiers.every((t) => t && typeof t.id === "string" && typeof t.name === "string") && p.tiers.some((t) => t.id === NOT_BID_ID) ? p.tiers : DEFAULT_TIERS;
    const known = new Set(tiers.map((t) => t.id));
    const assigned = isStringRecord(p.assigned) ? Object.fromEntries(Object.entries(p.assigned).filter(([, t]) => known.has(t))) : {};
    return {
      tiers,
      assigned,
      setAside: Array.isArray(p.setAside) ? p.setAside.filter((x): x is string => typeof x === "string") : [],
      taught: isStringRecord(p.taught) ? p.taught : {},
    };
  } catch {
    return EMPTY_TIERS;
  }
}

export function saveTiers(userId: string | null, bidPackId: string, s: TierState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(tiersKey(userId, bidPackId), JSON.stringify(s));
  } catch {
    // storage unavailable — tiers just won't persist this session
  }
}
