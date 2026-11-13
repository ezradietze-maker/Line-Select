import { CHART, changedInside, contractNode, findNode, versionText } from "./index";
import type { Applicability, ChartRow } from "./types";

/**
 * Which bid periods a piece of the contract applies to. CBA 2026 Implementation LOA, Appendix A: "The date listed for
 * each phase is a date beyond which the Company would be in violation of the Agreement if it has not implemented and
 * automated the change", and "Yellow highlighted items will be implemented at DOS (Phase 1) but applied manually until
 * automation is complete." The 2015 wording applies until a change's phase starts.
 */
export const PHASE_STARTS: Record<1 | 2 | 3 | 4, { label: string; month: string }> = {
  1: { label: "June 29, 2026", month: "2026-06" },
  2: { label: "the December 2026 bid period", month: "2026-12" },
  3: { label: "the August 2027 bid period", month: "2027-08" },
  4: { label: "the October 2027 bid period", month: "2027-10" },
};

const isUnder = (id: string, ref: string) => id === ref || id.startsWith(`${ref}.`);

/**
 * Changes the chart doesn't list but that only work once a change it dates later is in: they take that change's date,
 * not the Agreement's general effective date. In the contract's words:
 */
const FOLLOWS: Record<string, string> = {
  // "A trip trade between pilots will be processed as provided in Section 25.L.1.a." (2015: "…may be processed when
  // received, notwithstanding Section 25.L.1.a."), and beside it, 25.L.9.a.ii: "Upon implementation of 25.L.1.a., …".
  "25.L.9.a.iii": "25.L.1.a",
  // "Submissions for a trip pick-up will be processed as provided in Section 25.L.1.a." (2015: "…notwithstanding…").
  "25.L.10.c": "25.L.1.a",
  // "Following the three additional bid periods, any remaining balance shall then be reduced by 50%…": the three
  // additional bid periods are 8.C.2.a.ii's ("…that balance shall remain intact for three additional bid periods").
  "8.C.2.a.iii": "8.C.2.a.ii",
};

/**
 * Changes the chart doesn't list that sit beside one it dates later and may be part of it, too loosely tied to say:
 * these say the chart doesn't date them rather than claim the general effective date.
 */
const UNDATED = new Set([
  // Conflict Processing Window "not less than 5 hours" (2015: 24), timed off the Conflict Input Window that 25.E.2
  // reworks in Phase 2.
  "25.E.3",
  // Hotel meetings now cover "hotels with a 'hotel of concern' designation", and complaints are measured against "the
  // Joint Hotel Criteria List": both beside 5.B.3.a and b, Phase 2.
  "5.B.3.c",
  "5.B.3.d.i",
  // Rest after 8 ABH "may be operationally reduced to 11 hours" (2015: 12), beside 12.C.6.b.i, Phase 2.
  "12.C.6.b.ii",
  // Critical period pay "applies to duty periods scheduled to domestic parameters" (2015: "all trips"), beside 4.GG.2,
  // Phase 4.
  "4.GG.1",
  // "An expense report shall be submitted if:" and its list, rewritten beside 8.C.5.b (Phase 2) and 8.C.5.c (Phase 3).
  "8.C.5.a",
]);

/** References the 2026 wording only renumbers: 5.E.6 now points at 5.B.3.d.ii, which 2015 called 5.B.4.b.ii. */
const RENUMBERED_ONLY = new Set(["5.E.6"]);

const REF = /\b\d{1,2}\.[A-Z]{1,2}(?:\.(?:\([a-z0-9]+\)|[a-z0-9]+))*(?:\([a-z0-9]+\))*/g;

/** The chart row nearest a piece, if any row covers it. */
function chartRow(id: string, chart: ChartRow[]): ChartRow | null {
  const covering = chart.filter((r) => r.refs.some((ref) => isUnder(id, ref)));
  if (!covering.length) return null;
  // The nearest row wins: 25.S.2 and 25.S.2.a can differ.
  const depth = (r: ChartRow) => Math.max(...r.refs.filter((ref) => isUnder(id, ref)).map((ref) => ref.length));
  return covering.reduce((a, b) => (depth(b) > depth(a) ? b : a));
}

/**
 * The later-phase piece an unlisted change waits on: one named in FOLLOWS, or one its 2026 wording newly refers to
 * that the chart dates after June 29, 2026 ("…except as provided in Section 25.L.1.a. above", added beside a Phase 3
 * row). Null when it waits on none.
 */
function waitsOn(id: string, chart: ChartRow[]): { section: string; row: ChartRow } | null {
  for (const at of [id, ...ancestorIds(id)]) {
    const named = FOLLOWS[at];
    const row = named ? chartRow(named, chart) : null;
    if (named && row) return { section: named, row };
  }
  const node = contractNode(id);
  if (!node || RENUMBERED_ONLY.has(id)) return null;
  const before = new Set((versionText(node, "2015").match(REF) ?? []).map((r) => findNode(r)?.id));
  let latest: { section: string; row: ChartRow } | null = null;
  for (const ref of node.text.match(REF) ?? []) {
    const target = findNode(ref)?.id;
    if (!target || before.has(target)) continue;
    const row = chartRow(target, chart);
    if (row && row.phase > 1 && !row.manualUntilPhase && (!latest || row.phase > latest.row.phase)) latest = { section: target, row };
  }
  return latest;
}

const ancestorIds = (id: string) => {
  const out: string[] = [];
  for (let n = contractNode(id); n?.parent; n = contractNode(n.parent)) out.push(n.parent);
  return out;
};

/**
 * `bidMonth` is the bid period being asked about, "2026-12", defaulting to this month. A chart row covers its own piece
 * and what's under it. When only parts of a piece have rows, the answer lists each part: a heading like 25.E has
 * changes in three phases.
 */
export function applicabilityOf(id: string, bidMonth: string, chart: ChartRow[] = CHART): Applicability {
  if (!contractNode(id)) return { kind: "undated" };
  const row = chartRow(id, chart);
  if (row) {
    if (!changedInside(id) && !row.refs.includes(id)) return { kind: "unchanged" };
    const start = PHASE_STARTS[row.phase];
    return {
      kind: "scheduled",
      phase: row.phase,
      startsLabel: start.label,
      inForce: row.manualUntilPhase || bidMonth >= start.month,
      manual: row.manualUntilPhase,
      ...(row.notes ? { note: row.notes } : {}),
    };
  }
  const inside = chart.filter((r) => r.refs.some((ref) => ref.startsWith(`${id}.`)));
  if (inside.length) {
    const phases = ([1, 2, 3, 4] as const).flatMap((phase) => {
      const refs = inside.filter((r) => r.phase === phase).flatMap((r) => r.refs.filter((ref) => ref.startsWith(`${id}.`)));
      return refs.length ? [{ phase, startsLabel: PHASE_STARTS[phase].label, refs }] : [];
    });
    return { kind: "mixed", phases };
  }
  if (!changedInside(id)) return { kind: "unchanged" };
  if ([id, ...ancestorIds(id)].some((at) => UNDATED.has(at))) return { kind: "undated" };
  const waits = waitsOn(id, chart);
  if (waits) {
    const start = PHASE_STARTS[waits.row.phase];
    return {
      kind: "scheduled",
      phase: waits.row.phase,
      startsLabel: start.label,
      inForce: bidMonth >= start.month,
      manual: false,
      note: `Not on the chart itself: it waits on Section ${waits.section}`,
    };
  }
  return { kind: "unlisted" };
}

/**
 * The bid month flying now, with no pack to say. A bid period starts on the Monday on or just before its month's first
 * day (the DEC26 period on Nov 30, NOV26 on Oct 26), so the last days of a month can be next month's period: by the
 * calendar month, Phase 2's rules read "not in force yet" on Nov 30, the first day they applied. Memphis time.
 */
export function currentBidMonth(now: Date = new Date()): string {
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const today = day(now.getTime());
  const [y, m] = today.split("-").map(Number);
  const next = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  // The Monday on or before the 1st: back (weekday + 6) % 7 days.
  const nextStart = new Date(next.getTime() - ((next.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
  return today >= nextStart ? next.toISOString().slice(0, 7) : today.slice(0, 7);
}
