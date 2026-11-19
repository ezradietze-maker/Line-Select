import { DateTime } from "luxon";
import { zoneOf } from "@/lib/phase-in";
import { monthReachEnd, periodSpan, typedVacation, vacationLabel, vacationsInReach } from "@/lib/vacation-slide";
import type { BidPack, SeniorityEntry, VacationPeriod } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";

/**
 * The pilot's vacation for this bid month, found once and read by every screen (My Rankings, Strategies, View/Add,
 * Open Time): from the pack's own vacation schedule by their seniority number, or as they typed it when the pack can't
 * say. Each screen used to find it its own way and two month filters disagreed, so a vacation could count on one
 * screen and not another.
 */

/**
 * Why the pack's vacation is or isn't known:
 *  - "found": on the pack's schedule, at the pilot's number, touching this month;
 *  - "none": at their number, but nothing touches this month;
 *  - "typed": as the pilot typed it (they're not on the list, the pack prints no schedule, or they corrected it);
 *  - "not-listed": their number isn't on this pack's list, so the schedule can't be read for them;
 *  - "band": they gave a share of the seat ("upper third"), not a pilot;
 *  - "no-number": no seniority number yet;
 *  - "no-schedule": the pack prints no vacation schedule (the sample, or a pack saved before we read it).
 */
export type VacationStatus = "found" | "none" | "typed" | "not-listed" | "band" | "no-number" | "no-schedule";

/** A vacation the pilot typed: its first base day ("2026-10-19") and how many days. */
export interface TypedVacation {
  firstDay: string;
  days: number;
}

export interface MyVacation {
  status: VacationStatus;
  /** Those touching this bid month, or able to slide into it. */
  vacations: VacationPeriod[];
  /** The pack prints a vacation schedule at all. */
  packHasSchedule: boolean;
  /** The pilot's entry on the pack's list, when we know it. */
  entry: SeniorityEntry | null;
  /** The number we looked them up by. */
  seniorityNumber: number | null;
}

/**
 * A vacation this month can feel: its days touch the month's trips, or a trip's buffer reaches it (CBA 2026 12.D.1.d,
 * 48 hours after a trip and 24 before; a trip running into next month can run into next month's vacation), or a legal
 * slide (7.E.2.a, up to 5 days) brings it in. The two filters every screen used, as one.
 */
export function inThisMonth(v: VacationPeriod, pack: BidPack): boolean {
  const reach = monthReachEnd(pack);
  if (reach === null || !pack.bidPeriodStart) return false;
  const touches = Date.parse(v.from) - 48 * 3_600_000 < reach && Date.parse(v.to) + 24 * 3_600_000 > Date.parse(`${pack.bidPeriodStart}T00:00:00Z`);
  return touches || vacationsInReach([v], pack).length > 0;
}

/**
 * For a pilot the pack lists with vacation, none of it this month ("none"): what the pack has for them, and why it
 * doesn't touch this month's lines. Without it, "no vacation for seniority #80" read as wrong to a pilot looking at #80's
 * Nov 9 vacation on the pack's own schedule. Null when the pack lists none for them.
 */
export function otherMonthsNote(entry: SeniorityEntry | null, pack: BidPack): string | null {
  const period = periodSpan(pack);
  const listed = entry?.vacations ?? [];
  if (!period || !listed.length) return null;
  const zone = zoneOf(pack);
  // Base days start at 0130: the month's last is the day before the first minute after it.
  const day = (ms: number, back = 0) => DateTime.fromMillis(ms, { zone }).minus({ days: back }).toFormat("LLL d");
  const after = listed.every((v) => Date.parse(v.from) >= period.end);
  const before = listed.every((v) => Date.parse(v.to) < period.start);
  const when = after
    ? `after this bid month's lines end on ${day(period.end, 1)}`
    : before
      ? `before this bid month starts on ${day(period.start)}`
      : "outside this bid month";
  const yours = listed.map((v) => vacationLabel(v, zone)).join(" and ");
  return `The pack's vacation schedule has your vacation ${yours}. That's ${when}, and a slide of up to 5 days (CBA 2026 7.E.2.a) can't bring it onto any line here, so no line changes. It counts on the pack for the bid month it falls in.`;
}

/** The typed vacations as the pack prints vacations (base day to base day), the ones this month can feel. */
export function typedVacations(typed: TypedVacation[] | undefined, pack: BidPack): VacationPeriod[] {
  return (typed ?? []).flatMap((t) => {
    const v = typedVacation(t.firstDay, t.days, pack);
    return v && inThisMonth(v, pack) ? [v] : [];
  });
}

/**
 * The pilot's entry on this pack's list, by the number they gave — kept with their preferences, or with the place they
 * saved on Strategies. A place saved without a number counts only on the pack it was saved on: next month, the same bid
 * number is somebody else, with somebody else's vacation.
 */
function entryOf(pack: BidPack, seniorityNumber: number | null, saved: SeniorityInput | null): { entry: SeniorityEntry | null; status: VacationStatus | null } {
  const list = pack.seniorityList ?? [];
  if (seniorityNumber) {
    const entry = list.find((e) => e.seniority === seniorityNumber) ?? null;
    return { entry, status: entry ? null : "not-listed" };
  }
  if (!saved) return { entry: null, status: "no-number" };
  if (saved.source === "band") return { entry: null, status: "band" };
  if (saved.source === "between") return { entry: null, status: "not-listed" };
  if (saved.packId !== pack.id) return { entry: null, status: "no-number" };
  const entry = list.find((e) => e.bidNumber === saved.rank) ?? null;
  return { entry, status: entry ? null : "not-listed" };
}

export function findMyVacation(
  pack: BidPack,
  profile: Pick<PreferenceProfile, "seniorityNumber"> | null,
  saved: SeniorityInput | null,
  typed?: { vacations?: TypedVacation[]; preferTyped?: boolean }
): MyVacation {
  const packHasSchedule = (pack.seniorityList ?? []).some((e) => e.vacations?.length);
  const seniorityNumber = profile?.seniorityNumber ?? saved?.seniorityNumber ?? null;
  const { entry, status } = entryOf(pack, seniorityNumber, saved);
  const fromPack = entry && packHasSchedule ? (entry.vacations ?? []).filter((v) => inThisMonth(v, pack)) : [];
  const own = typedVacations(typed?.vacations, pack);
  // What the pilot typed stands in where the pack can't say, and over the pack's when they said it's not right.
  const packCanSay = !!entry && packHasSchedule;
  if (own.length && (!packCanSay || typed?.preferTyped)) return { status: "typed", vacations: own, packHasSchedule, entry, seniorityNumber };
  if (status) return { status: status === "not-listed" || status === "no-number" || status === "band" ? (packHasSchedule ? status : "no-schedule") : status, vacations: [], packHasSchedule, entry, seniorityNumber };
  if (!packHasSchedule) return { status: "no-schedule", vacations: [], packHasSchedule, entry, seniorityNumber };
  return { status: fromPack.length ? "found" : "none", vacations: fromPack, packHasSchedule, entry, seniorityNumber };
}
