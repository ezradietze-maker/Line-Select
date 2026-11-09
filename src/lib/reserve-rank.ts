import { DateTime } from "luxon";
import type { BidPack, ReserveLine } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * The pack's numbered reserve lines in this pilot's order, so a pilot who may land on reserve bids the one they'd
 * rather have instead of taking what "any reserve line" leaves them. No model call: a reserve line is only its type and
 * which days it stands, so it's read against what the pilot's model already says about days at home.
 *
 * What a type means is the contract's: RP-24 is a 24-hour reserve period with at least 24 hours' notice of any
 * assignment, RP-A a 12-hour period from the start of the day and RP-B a 12-hour period from 12 hours after it
 * (CBA 2026 25.M.2.a, 25.M.3.a.v; unchanged across the 2026 phases until R-3 lines arrive with the August 2027 bid
 * period, 25.D.3.e). A commuter is the one pilot that tells us which to prefer: the notice is what lets them travel in.
 */

export interface RankedReserveLine {
  lineNumber: string;
  reserveType: ReserveLine["reserveType"];
  /** Days it stands in the bid period. Null on a pack saved before these were read. */
  rDays: number | null;
  daysOff: number | null;
  /** Longest run of days off inside the bid period. */
  longestOff: number | null;
  /** Saturdays and Sundays off in the bid period. */
  weekendDaysOff: number | null;
  /** Days it stands past the bid period's end. */
  carryOverDays: number;
  /** Dates the pilot said they need that this line stands. */
  neededDatesOnCall: string[];
  reason: string;
}

export const RESERVE_TYPE_LABEL: Record<NonNullable<ReserveLine["reserveType"]>, string> = {
  "24hr": "R-24",
  a: "RA",
  b: "RB",
};

/** Which reserve-line fact each of the model's measures speaks to. Anything else in the model is about flying a reserve line doesn't show. */
const FEATURE_OF: Record<string, keyof Features> = {
  daysOff: "daysOff",
  realBreakNights: "daysOff",
  nightsHome: "daysOff",
  shortHomeGaps: "longestOff",
  longestDaysOffBlock: "longestOff",
  longestHomeStretch: "longestOff",
  weekendDaysOff: "weekendDaysOff",
};

interface Features {
  daysOff: number;
  longestOff: number;
  weekendDaysOff: number;
}

/** For a pilot whose model says nothing about days at home: what a reserve month is mostly judged by. */
const BASE_WEIGHT: Features = { daysOff: 1, longestOff: 0.6, weekendDaysOff: 0.3 };
/** A date they need outweighs every other reason, short of two lines that both stand it. */
const NEEDED_DATE_COST = 5;
/** The notice a commuter needs to get to the domicile is worth about as much as the whole of the rest. */
const COMMUTER_R24_BONUS = 1;

function readLine(r: ReserveLine, pack: Pick<BidPack, "bidPeriodDays" | "bidPeriodStart">, neededDates: Set<string>) {
  const start = pack.bidPeriodStart ? DateTime.fromISO(pack.bidPeriodStart, { zone: "utc" }) : null;
  const dateOf = (offset: number) => (start ? start.plus({ days: offset }) : null);
  if (!r.days) return null;
  const inPeriod = new Set(r.days.filter((d) => d < pack.bidPeriodDays));
  let longestOff = 0;
  let run = 0;
  let weekendDaysOff = 0;
  for (let d = 0; d < pack.bidPeriodDays; d++) {
    if (inPeriod.has(d)) {
      run = 0;
      continue;
    }
    longestOff = Math.max(longestOff, ++run);
    const date = dateOf(d);
    if (date && date.weekday >= 6) weekendDaysOff++;
  }
  return {
    rDays: inPeriod.size,
    features: { daysOff: pack.bidPeriodDays - inPeriod.size, longestOff, weekendDaysOff } as Features,
    carryOverDays: r.days.length - inPeriod.size,
    neededDatesOnCall: r.days.flatMap((d) => {
      const iso = dateOf(d)?.toISODate();
      return iso && neededDates.has(iso) ? [iso] : [];
    }),
  };
}

function weightsFrom(model: PilotModel | null | undefined): Features {
  const weights: Features = { daysOff: 0, longestOff: 0, weekendDaysOff: 0 };
  for (const c of model?.criteria ?? []) {
    const feature = FEATURE_OF[c.metric];
    if (feature) weights[feature] += c.weight;
  }
  return weights.daysOff + weights.longestOff + weights.weekendDaysOff > 0 ? weights : BASE_WEIGHT;
}

function reasonFor(line: RankedReserveLine, commuter: boolean): string {
  const parts: string[] = [];
  if (line.neededDatesOnCall.length) parts.push(`stands ${line.neededDatesOnCall.length === 1 ? "a date" : `${line.neededDatesOnCall.length} dates`} you need`);
  if (commuter && line.reserveType === "24hr") parts.push("24 hours' notice to get to the domicile");
  if (line.daysOff !== null) parts.push(`${line.daysOff} days off, ${line.longestOff} in a row`);
  if (line.weekendDaysOff !== null && line.daysOff !== null) parts.push(`${line.weekendDaysOff} weekend days off`);
  if (line.carryOverDays) parts.push(`${line.carryOverDays} day${line.carryOverDays === 1 ? "" : "s"} carry into next month`);
  return parts.join(" · ");
}

export function rankReserveLines(
  bidPack: Pick<BidPack, "reserveLines" | "bidPeriodDays" | "bidPeriodStart">,
  { model, isCommuter }: { model?: PilotModel | null; isCommuter?: boolean | null }
): RankedReserveLine[] {
  const lines = bidPack.reserveLines ?? [];
  const weights = weightsFrom(model);
  const neededDates = new Set((model?.criteria ?? []).flatMap((c) => (c.metric === "requestedDatesWorked" ? (c.params?.dates ?? []) : [])));
  const commuter = isCommuter === true;

  const read = lines.map((r) => ({ r, facts: readLine(r, bidPack, neededDates) }));
  const range = (pick: (f: Features) => number) => {
    const values = read.flatMap(({ facts }) => (facts ? [pick(facts.features)] : []));
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);
  };
  const scale = { daysOff: range((f) => f.daysOff), longestOff: range((f) => f.longestOff), weekendDaysOff: range((f) => f.weekendDaysOff) };
  const totalWeight = weights.daysOff + weights.longestOff + weights.weekendDaysOff;

  return read
    .map(({ r, facts }) => {
      const score =
        (facts
          ? (weights.daysOff * scale.daysOff(facts.features.daysOff) + weights.longestOff * scale.longestOff(facts.features.longestOff) + weights.weekendDaysOff * scale.weekendDaysOff(facts.features.weekendDaysOff)) / totalWeight -
            NEEDED_DATE_COST * facts.neededDatesOnCall.length
          : 0) + (commuter && r.reserveType === "24hr" ? COMMUTER_R24_BONUS : 0);
      const line: RankedReserveLine = {
        lineNumber: r.lineNumber,
        reserveType: r.reserveType,
        rDays: facts?.rDays ?? null,
        daysOff: facts?.features.daysOff ?? null,
        longestOff: facts?.features.longestOff ?? null,
        weekendDaysOff: bidPack.bidPeriodStart ? (facts?.features.weekendDaysOff ?? null) : null,
        carryOverDays: facts?.carryOverDays ?? 0,
        neededDatesOnCall: facts?.neededDatesOnCall ?? [],
        reason: "",
      };
      return { line: { ...line, reason: reasonFor(line, commuter) }, score };
    })
    .sort((a, b) => b.score - a.score || Number(a.line.lineNumber) - Number(b.line.lineNumber))
    .map((x) => x.line);
}
