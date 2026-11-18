import { minBidPeriodGuarantee } from "@/lib/pay/trip-guarantee";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * Total CH: what a line pays, as the pilot will fly it, rather than the credit the pack prints. The pack's CR. is the
 * line before anything happens to it; the pilot is paid:
 *  - the line's credit this bid month, raised to the minimum bid period guarantee when it's under it (CBA 2026 4.B,
 *    4.A.1: "such pilot's BLG shall be increased to the minimum bid period guarantee");
 *  - less the trips a carry-in drops (4.I.1.a: "the value of such trip(s) … shall be deducted from the pilot's new bid
 *    period BLG/RLG"), which the pilot may make up in View/Add (25.F.5) but isn't paid for unless they do;
 *  - with the trips a vacation takes off still paid, from the vacation bank (7.G.1: "The SCH value of the removed
 *    trip(s) shall be deducted from the pilot's vacation credit hour bank");
 *  - plus the C/O, paid in the next bid month (4.G).
 *
 * Block override (4.FF: "If a trip's OSC exceeds SCH, a pilot shall earn block override CH equal to OSC minus SCH") is
 * worked out but not counted (`BLOCK_OVERRIDE_ON`): the contract defines OSC in Section 2, which the published 2026 text
 * we have doesn't carry, and the pack doesn't print it. The reading other tools use, up to 2 CH for each duty over 8
 * block hours, waits on the ex-pilot. Nothing here is an official number.
 */

/** Off until the ex-pilot confirms how OSC is worked out (see above). */
export const BLOCK_OVERRIDE_ON = false;

/** The reading of OSC other tools use: each duty's block over 8 hours, up to 2 hours of it, on top of the trip's credit. */
const OVERRIDE_FROM_BLOCK = 8;
const OVERRIDE_MAX_PER_DUTY = 2;

export type TotalPartId = "printed" | "buyUp" | "carryIn" | "carryOver" | "blockOverride";

export interface TotalPart {
  id: TotalPartId;
  label: string;
  /** CH this adds to the line, negative for what it takes off. */
  ch: number;
  /** Where the contract says so. */
  section: string;
}

export interface LineTotal {
  /** Every CH the line pays, this month and next: the parts added up. */
  total: number;
  /** This bid month's share of it, without the C/O. */
  thisMonth: number;
  /** The parts that make it, in the order a pilot adds them; only the ones that change something after "printed". */
  parts: TotalPart[];
  /** Of the line's credit, what a vacation takes off and the bank pays instead (included in the total). */
  fromVacationBank: number;
  /** Block override as other tools reckon it, shown when it would add something, counted only when `BLOCK_OVERRIDE_ON`. */
  blockOverrideEstimate: number;
}

/** CH to the whole minute, as credit is counted (4.F.2). */
const toMinute = (n: number) => Math.round(n * 60) / 60;

/** The block override other tools reckon for a line's trips (see `BLOCK_OVERRIDE_ON`). */
export function blockOverrideEstimate(line: Pick<Line, "trips">): number {
  let ch = 0;
  for (const trip of line.trips)
    for (const duty of trip.schedule) {
      const block = duty.totals?.blockHours ?? duty.legs.reduce((s, l) => s + (!l.isDeadhead && !l.isStandby && l.blockHours ? l.blockHours : 0), 0);
      ch += Math.min(Math.max(block - OVERRIDE_FROM_BLOCK, 0), OVERRIDE_MAX_PER_DUTY);
    }
  return toMinute(ch);
}

/**
 * A line's Total CH. `carried`: the line after the pilot's carry-in, before their vacation (`flySchedule`'s `lines`),
 * when one changed it; `vacationBank`: what their vacation takes off this line, which the bank pays (`VacationLine`'s
 * `chargedCH`).
 */
export function lineTotal(
  pack: Pick<BidPack, "bidPeriodDays">,
  printed: Line,
  carried?: Pick<Line, "totalCreditHours" | "carryOverCreditHours" | "trips"> | null,
  vacationBank = 0
): LineTotal {
  const asFlown = carried ?? printed;
  const printedCO = printed.carryOverCreditHours ?? 0;
  const floor = minBidPeriodGuarantee(pack.bidPeriodDays);
  const buyUp = floor ? Math.max(0, floor.ch - printed.totalCreditHours) : 0;
  const carryIn = asFlown.totalCreditHours - printed.totalCreditHours;
  const carryOver = asFlown.carryOverCreditHours ?? 0;
  const override = blockOverrideEstimate(asFlown);
  const parts: TotalPart[] = [
    { id: "printed", label: "Credit this month, as the pack prints it", ch: toMinute(printed.totalCreditHours), section: "4.B" },
    { id: "buyUp", label: floor ? `Raised to the ${floor.ch}:00 minimum guarantee` : "Raised to the minimum guarantee", ch: toMinute(buyUp), section: floor ? floor.section : "4.A.1" },
    // What the carry-in drops, this month's and any C/O alike, so the C/O below is the line's own.
    { id: "carryIn", label: "Off for your carry-in (make it up in View/Add)", ch: toMinute(carryIn + (carryOver - printedCO)), section: "4.I.1.a, 25.F.5" },
    { id: "carryOver", label: "C/O, paid next month", ch: toMinute(printedCO), section: "4.G" },
    { id: "blockOverride", label: "Block override", ch: BLOCK_OVERRIDE_ON ? override : 0, section: "4.FF" },
  ];
  const thisMonth = toMinute(asFlown.totalCreditHours + buyUp + (BLOCK_OVERRIDE_ON ? override : 0));
  return {
    total: toMinute(thisMonth + carryOver),
    thisMonth,
    parts: parts.filter((p) => p.id === "printed" || p.ch !== 0),
    fromVacationBank: toMinute(Math.max(0, vacationBank)),
    blockOverrideEstimate: override,
  };
}

/** Total CH differs from what the pack prints (CR. plus C/O): the only time a line needs it said. */
export function totalDiffers(line: Pick<Line, "totalCreditHours" | "carryOverCreditHours">, total: LineTotal): boolean {
  return Math.abs(total.total - toMinute(line.totalCreditHours + (line.carryOverCreditHours ?? 0))) >= 1 / 60;
}

// ---------------------------------------------------------------- pay only

/**
 * The pack's average BLG for regular lines: what a pay-only pilot awarded a secondary line is paid (CBA 2026 25.C.7.a:
 * "shall be compensated the average bid period BLG for regular lines for the pilot's crew position"). Each line's BLG as
 * 4.B builds it: its credit this month, raised to the minimum.
 */
export function averageBlg(pack: Pick<BidPack, "bidPeriodDays" | "lines">): number | null {
  if (!pack.lines.length) return null;
  const floor = minBidPeriodGuarantee(pack.bidPeriodDays)?.ch ?? 0;
  return toMinute(pack.lines.reduce((a, l) => a + Math.max(l.totalCreditHours, floor), 0) / pack.lines.length);
}

export interface PayOnlyOrder {
  /** Line ids, most pay first. */
  order: string[];
  /** How many of them pay more than a secondary line would (the pack's average BLG): "any secondary line" goes after these. */
  aboveAverage: number;
  /** How many pay at least a reserve line's RLG: reserve goes after these. Null when the pack prints no RLG. */
  aboveReserve: number | null;
  averageBlg: number | null;
  rlg: number | null;
}

/**
 * A bid for pay only (25.C.7: a pilot "projected to be unavailable for line flying … for an entire bid period … shall bid
 * a line for pay only"): the lines in order of Total CH, and where a secondary line and a reserve line would pay as much.
 * A pay-only secondary pays the average BLG (25.C.7.a); a reserve line pays its RLG (4.C). So the lines paying more than
 * the average come first, then any secondary line, then the lines down to the RLG, then reserve, then the rest.
 */
export function payOnlyOrder(pack: Pick<BidPack, "bidPeriodDays" | "lines" | "info">, totals: Map<string, LineTotal>): PayOnlyOrder {
  const pay = (l: Line) => totals.get(l.id)?.total ?? l.totalCreditHours + (l.carryOverCreditHours ?? 0);
  const lines = [...pack.lines].sort((a, b) => pay(b) - pay(a) || Number(a.lineNumber) - Number(b.lineNumber) || a.lineNumber.localeCompare(b.lineNumber));
  const avg = averageBlg(pack);
  const rlg = pack.info?.rlgHours ?? null;
  return {
    order: lines.map((l) => l.id),
    aboveAverage: avg === null ? 0 : lines.filter((l) => pay(l) > avg).length,
    aboveReserve: rlg === null ? null : lines.filter((l) => pay(l) >= rlg).length,
    averageBlg: avg,
    rlg,
  };
}
