import { CHART, changedInside, contractNode } from "./index";
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
 * `bidMonth` is the bid period being asked about, "2026-12", defaulting to this month. A chart row covers its own piece
 * and what's under it. When only parts of a piece have rows, the answer lists each part: a heading like 25.E has
 * changes in three phases.
 */
export function applicabilityOf(id: string, bidMonth: string, chart: ChartRow[] = CHART): Applicability {
  if (!contractNode(id)) return { kind: "unlisted" };
  const covering = chart.filter((r) => r.refs.some((ref) => isUnder(id, ref)));
  if (covering.length) {
    // The nearest row wins: 25.S.2 and 25.S.2.a can differ.
    const depth = (r: ChartRow) => Math.max(...r.refs.filter((ref) => isUnder(id, ref)).map((ref) => ref.length));
    const row = covering.reduce((a, b) => (depth(b) > depth(a) ? b : a));
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
  return changedInside(id) ? { kind: "unlisted" } : { kind: "unchanged" };
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
