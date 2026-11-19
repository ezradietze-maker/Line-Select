import { baseClock } from "@/lib/line-timeline";
import { baseDayStartMinutes, zoneOf } from "@/lib/phase-in";
import { tripReportUtc } from "@/lib/trip-anchor";
import type { LineVacationOptions } from "@/lib/vacation-engine";
import { vacationId, type ChosenVacation, type VacationLine } from "@/lib/vacation-lines";
import { slideChecks, vacationSpan } from "@/lib/vacation-slide";
import type { BidPack } from "@/types/bidpack";

/**
 * What a line's pictures draw for the pilot's vacation: each vacation where it falls on this line, where the pack had
 * it (when it's slid), how far it can slide each way (the hashes either side), and the trips it takes off. In minutes
 * on the base's clock from the bid month's first midnight — the Timeline's and Heat Map's own measure — and as day
 * columns (`firstDay`, `lastDay`) for the pack view and the month calendar, base day to base day as the pack prints them.
 */
export interface VacationMarkPiece {
  id: string;
  start: number;
  end: number;
  /** Where the pack's vacation schedule has it; the same as `start`/`end` unless it's slid. */
  awardedStart: number;
  awardedEnd: number;
  /** Day columns it covers (0 the bid month's first day), and as awarded. */
  firstDay: number;
  lastDay: number;
  awardedFirstDay: number;
  awardedLastDay: number;
  days: number;
  /** Whole days it can slide on this line, each way (CBA 2026 7.E.2.a: up to 5). */
  earlier: number;
  later: number;
}

export interface LineVacationMark {
  pieces: VacationMarkPiece[];
  /** The report minute of each trip (or day of a run) the vacation takes off, to fade where it's drawn. */
  removedStarts: number[];
  /** The grid day each of those trips starts on (`Trip.startDayIndex`), to mark it in the line's trip list. */
  removedDays: number[];
}

/** The day column a minute falls in, base day to base day (a day starts at 0130 at a US base, CBA 2026 25.A.2). */
export const dayColumn = (minute: number, dayStart: number) => Math.floor((minute - dayStart) / 1440);

/**
 * The line's vacation as its pictures draw it, from what the ranking flew (`VacationLine`, its `spans` where this line
 * has each vacation) and how far each can slide here (`reach`, from the line's legal placements; until they're worked
 * out, the slides legal on every line). Null when the vacation isn't on this line's month.
 */
export function lineVacationMark(pack: BidPack, vl: VacationLine | undefined, vacations: ChosenVacation[], reach?: LineVacationOptions["reach"]): LineVacationMark | null {
  const clock = baseClock(pack);
  if (!clock || !vl || vl.unchecked || !vl.spans.length) return null;
  const minute = (ms: number) => clock.at(new Date(ms).toISOString());
  const dayStart = baseDayStartMinutes(zoneOf(pack));
  const active = vacations.filter((v) => v.choice !== "not-taking");
  const pieces = vl.spans.flatMap((span, i): VacationMarkPiece[] => {
    const chosen = active[i];
    if (!chosen) return [];
    const id = vacationId(chosen.vacation);
    const awarded = vacationSpan(chosen.vacation);
    const own = reach?.find((r) => r.id === id);
    const legal = own ? null : slideChecks(chosen.vacation, pack).filter((c) => c.legal && !c.carryoverOnly).map((c) => c.offset);
    const [start, end, awardedStart, awardedEnd] = [minute(span.start), minute(span.end), minute(awarded.start), minute(awarded.end)];
    return [
      {
        id,
        start,
        end,
        awardedStart,
        awardedEnd,
        firstDay: dayColumn(start, dayStart),
        lastDay: dayColumn(end - 1, dayStart),
        awardedFirstDay: dayColumn(awardedStart, dayStart),
        awardedLastDay: dayColumn(awardedEnd - 1, dayStart),
        days: chosen.vacation.days,
        earlier: own ? own.earlier : Math.max(0, -Math.min(0, ...legal!)),
        later: own ? own.later : Math.max(0, ...legal!),
      },
    ];
  });
  if (!pieces.length) return null;
  const removedStarts = vl.removed.flatMap((r) => {
    const report = tripReportUtc(pack, r.trip);
    return report === null ? [] : [minute(report)];
  });
  const removedDays = vl.removed.flatMap((r) => (r.trip.startDayIndex === null ? [] : [r.trip.startDayIndex]));
  return { pieces, removedStarts, removedDays };
}

/**
 * Where a piece's hashes run, in minutes, each side: from where it could slide to, to where it is now. A slid vacation
 * reaches its legal slides measured from where it was awarded, so the hashes are from the awarded place's reach, not
 * moved with it.
 */
export function reachSpans(p: VacationMarkPiece): { before: [number, number] | null; after: [number, number] | null } {
  const offset = Math.round((p.start - p.awardedStart) / 1440);
  const toEarliest = p.earlier + offset;
  const toLatest = p.later - offset;
  return {
    before: toEarliest > 0 ? [p.start - toEarliest * 1440, p.start] : null,
    after: toLatest > 0 ? [p.end, p.end + toLatest * 1440] : null,
  };
}
