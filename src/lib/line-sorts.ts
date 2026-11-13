import { saveOrReport } from "@/lib/local-save-failed";
import { groupDepartures } from "@/lib/metrics/departures";
import { homeParams } from "@/lib/scoring-v2/score";
import type { MetricParams } from "@/lib/metrics/catalog";
import { measureAll, type PackMetrics } from "@/lib/metrics/compute";
import type { Region } from "@/lib/metrics/trip-facts";
import type { MonthDepartureOptions } from "@/lib/month-detail";
import type { LineScore } from "@/lib/scoring";
import type { BidPack, Line } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * "Sort by…": every measure the scorer computes, in a pilot's words. The catalog's own descriptions are written for the
 * brain (`pack-brief.ts` hands them to it word for word, and every metric there is one it may bind a priority to), so
 * what a pilot reads, and the few sorts that aren't priorities (carried-over credit, requested days off kept), live
 * here rather than there.
 *
 * Sorting is for looking: Send to VIPS and Copy keep following the ranking, whatever the list is sorted by.
 */

export type SortGroup = "order" | "pay" | "home" | "commute" | "trips" | "layovers" | "body";

export const SORT_GROUPS: { id: SortGroup; label: string }[] = [
  { id: "order", label: "Your list" },
  { id: "pay", label: "Pay" },
  { id: "home", label: "Time home" },
  { id: "commute", label: "Commuting" },
  { id: "trips", label: "Trips" },
  { id: "layovers", label: "Layovers" },
  { id: "body", label: "Nights and body clock" },
];

/** "depends": pilots want it both ways (a long trip, a lot of flying), so neither end is called better. */
export type SortBetter = "more" | "fewer" | "depends";

type ValueKind = "count" | "hours" | "rate" | "share" | "clock" | "score";

/** What a sort can't be measured without. A sort whose need the pilot hasn't met isn't offered. */
export type SortNeed = "commuter" | "flights" | "dates" | "weekdays" | "cityScores" | "city" | "region";

export interface SortDef {
  id: string;
  group: SortGroup;
  label: string;
  better: SortBetter;
  kind: ValueKind;
  /** What a count counts, singular then plural. */
  noun?: [string, string];
  definition: string;
  needs?: SortNeed;
}

const count = (noun: string, plural = `${noun}s`): Pick<SortDef, "kind" | "noun"> => ({ kind: "count", noun: [noun, plural] });
const hours: Pick<SortDef, "kind"> = { kind: "hours" };
const rate: Pick<SortDef, "kind"> = { kind: "rate" };
const share: Pick<SortDef, "kind"> = { kind: "share" };
const clock: Pick<SortDef, "kind"> = { kind: "clock" };
const score: Pick<SortDef, "kind"> = { kind: "score" };

export const MATCH_SORT = "match";
export const LINE_NUMBER_SORT = "lineNumber";

export const LINE_SORTS: SortDef[] = [
  { id: MATCH_SORT, group: "order", label: "Best match", better: "more", ...score, definition: "Your ranking: how well each line fits what you told us, with your own swaps kept." },
  { id: LINE_NUMBER_SORT, group: "order", label: "Line number", better: "fewer", ...count("line"), definition: "The order the bid pack prints them." },

  // ---- Pay ----
  { id: "creditHours", group: "pay", label: "Credit this month", better: "more", ...hours, definition: "Credit the line prints for the bid month." },
  { id: "carryOverCredit", group: "pay", label: "Carryover credit", better: "depends", ...hours, definition: "Credit of a trip that runs past the end of the bid month, paid in the next one." },
  { id: "totalCredit", group: "pay", label: "Credit with carryover", better: "more", ...hours, definition: "This month's credit plus what carries over into the next." },
  { id: "blockHours", group: "pay", label: "Hours flown", better: "depends", ...hours, definition: "Block hours you operate. Deadheads don't count." },
  { id: "creditPerBlockHour", group: "pay", label: "Credit per block hour", better: "more", ...rate, definition: "What the line pays for the flying itself: credit for each hour you operate." },
  { id: "creditPerDayAway", group: "pay", label: "Credit per day away", better: "more", ...rate, definition: "Credit for each 24 hours away from base, as scheduled, on the line's whole trips." },
  { id: "effectiveCreditPerDayAway", group: "pay", label: "Credit per day away, after shortening", better: "more", ...rate, definition: "The same, if you deviate on the front- and back-end deadheads and shorten your trips." },
  { id: "creditPerDayAwayFromHome", group: "pay", label: "Credit per day away from home", better: "more", ...rate, needs: "commuter", definition: "Credit for each day away from home, commute included. Any part of a day away is a day." },

  // ---- Time home ----
  { id: "daysOff", group: "home", label: "Days off", better: "more", ...count("day"), definition: "Days off the line prints for the bid month." },
  { id: "requestedDatesKept", group: "home", label: "Your requested days off kept", better: "more", ...count("date"), needs: "dates", definition: "How many of the dates you told us you need off this line leaves off, read from its printed calendar." },
  { id: "longestDaysOffBlock", group: "home", label: "Longest stretch of days off", better: "more", ...count("day"), definition: "The longest run of days off in a row." },
  { id: "weekendDaysOff", group: "home", label: "Weekend days off", better: "more", ...count("day"), definition: "Saturdays and Sundays off." },
  { id: "singleDaysOff", group: "home", label: "Single days off", better: "fewer", ...count("day"), definition: "Days off standing alone between two working days." },
  { id: "weekdaysOff", group: "home", label: "Your weekdays at home", better: "more", ...count("day"), needs: "weekdays", definition: "The days of the week you told us matter, spent at home, door to door." },
  { id: "nightsHome", group: "home", label: "Nights in your own bed", better: "more", ...count("night"), definition: "Nights at home in the bid month, door to door: not on a trip, commuting or in the domicile city." },
  { id: "longestHomeStretch", group: "home", label: "Longest stretch at home", better: "more", ...count("night"), definition: "The most nights in your own bed in a row, door to door." },
  { id: "realBreakNights", group: "home", label: "Nights home in real breaks", better: "more", ...count("night"), definition: "Nights at home in stretches of 3 nights or more (or the number you gave us)." },
  { id: "shortHomeGaps", group: "home", label: "Short stretches at home", better: "fewer", ...count("stretch", "stretches"), definition: "Times home between departures for under 3 nights (or the number you gave us)." },
  { id: "workDays", group: "home", label: "Days given to work", better: "fewer", ...count("day"), definition: "Calendar days each departure touches, from leaving home to getting back, commute days included." },
  { id: "tafbHours", group: "home", label: "Time away from base (TAFB)", better: "fewer", ...hours, definition: "Hours away from base on the month's trips." },
  { id: "homeAwayHours", group: "home", label: "Time away from home", better: "fewer", ...hours, needs: "commuter", definition: "Hours from leaving home to getting back home, commute included." },
  { id: "shortenableHours", group: "home", label: "Hours trips can be shortened", better: "more", ...hours, definition: "Hours you could cut by arriving later on a front-end deadhead or going home sooner after your last leg." },
  { id: "tripsShortenableByADay", group: "home", label: "Trips you can shorten by a day", better: "more", ...count("trip"), definition: "Trips where deviating saves at least 24 hours away." },

  // ---- Commuting ----
  { id: "homeDepartures", group: "commute", label: "Departures", better: "fewer", ...count("departure"), definition: "Times you leave home to fly. Trips flown back to back count once." },
  { id: "departureCommutes", group: "commute", label: "Commutes to or from the domicile", better: "fewer", ...count("commute"), needs: "commuter", definition: "Commutes the month really takes: none at an end you can deadhead from or to home." },
  { id: "baseHotelNights", group: "commute", label: "Nights in the domicile city", better: "fewer", ...count("night"), needs: "commuter", definition: "Nights in the domicile city before an early report, between trips, or after a duty period that ends late." },
  { id: "tripsJoinedFromHome", group: "commute", label: "Trips with a front-end deadhead from home", better: "more", ...count("trip"), needs: "commuter", definition: "Trips starting on a deadhead you can catch from home, instead of commuting to the domicile." },
  { id: "tripsEndingStraightHome", group: "commute", label: "Trips ending straight home", better: "more", ...count("trip"), needs: "commuter", definition: "Trips you can deviate home from after the last operated leg." },
  { id: "fewestBackupFlights", group: "commute", label: "Fewest other flights you could commute on", better: "more", ...count("flight"), needs: "flights", definition: "Across the month, the fewest real airline flights beyond the one you'd plan on. Only lines with flights looked up." },
  { id: "tripsShortOnBackups", group: "commute", label: "Trips short on other flights to commute on", better: "fewer", ...count("trip"), needs: "flights", definition: "Trips with fewer real flights to commute on than you want (2 unless you told us). Only lines with flights looked up." },
  { id: "longestTripHome", group: "commute", label: "Longest wait to get home", better: "fewer", ...hours, needs: "flights", definition: "The most hours from the end of the work to landing at home on a real flight. Only lines with flights looked up." },
  { id: "frontDeadheadTrips", group: "commute", label: "Front deadheads", better: "more", ...count("trip"), definition: "Trips whose first leg is a deadhead." },
  { id: "backDeadheadTrips", group: "commute", label: "Back deadheads", better: "more", ...count("trip"), definition: "Trips whose last leg is a deadhead." },
  { id: "doubleDeadheadTrips", group: "commute", label: "Double deadheads", better: "more", ...count("trip"), definition: "Trips that start and end with a deadhead." },
  { id: "midTripDeadheads", group: "commute", label: "Mid-trip deadheads", better: "fewer", ...count("leg"), definition: "Deadhead legs in the middle of a trip." },
  { id: "frontSlackHours", group: "commute", label: "Time after the front deadhead", better: "more", ...hours, definition: "Average hours between a front-end deadhead landing and your first operated departure." },
  { id: "backSlackHours", group: "commute", label: "Time before the back deadhead", better: "more", ...hours, definition: "Average hours between your last operated arrival and the back-end deadhead." },
  { id: "earliestBaseReport", group: "commute", label: "Earliest report at the domicile", better: "more", ...clock, definition: "The earliest local report at the domicile. Later is easier to commute to; a line that always starts on a deadhead reads 23:59." },
  { id: "latestBaseRelease", group: "commute", label: "Latest arrival back at the domicile", better: "fewer", ...clock, definition: "The latest local arrival at the domicile, running on past midnight until 05:00. Earlier is easier to get home from." },

  // ---- Trips ----
  { id: "tripCount", group: "trips", label: "Trips", better: "fewer", ...count("trip"), definition: "Trips in the month. One running into next month counts by the share of it in this one." },
  { id: "avgTripDays", group: "trips", label: "Average trip length", better: "depends", ...count("day"), definition: "Average trip length in days." },
  { id: "longestTripDays", group: "trips", label: "Longest trip", better: "fewer", ...count("day"), definition: "The length of the longest trip." },
  { id: "dutyPeriods", group: "trips", label: "Duty periods", better: "fewer", ...count("duty", "duties"), definition: "Duty periods in the bid month, as the pack prints them (NO. DP'S)." },
  { id: "landings", group: "trips", label: "Landings", better: "fewer", ...count("landing"), definition: "Operated landings in the month." },
  { id: "avgLegsPerDuty", group: "trips", label: "Legs per duty", better: "fewer", ...count("leg"), definition: "Average operated legs in a flying duty." },
  { id: "maxLegsInADuty", group: "trips", label: "Most legs in one duty", better: "fewer", ...count("leg"), definition: "The most operated legs in any one duty." },
  { id: "extraLegs", group: "trips", label: "Extra legs in multi-leg duties", better: "fewer", ...count("leg"), definition: "Every operated leg past the first in a duty: a three-leg duty counts 2." },
  { id: "dutiesWithManyLegs", group: "trips", label: "Duties with 3 or more legs", better: "fewer", ...count("duty", "duties"), definition: "Duties with at least 3 operated legs (or the number you gave us)." },
  { id: "singleLegDutyShare", group: "trips", label: "Single-leg duties", better: "more", ...share, definition: "Share of flying duties with just one operated leg." },
  { id: "longDuties", group: "trips", label: "Long duty periods", better: "fewer", ...count("duty", "duties"), definition: "Duties over 12 hours (or the length you gave us), report to the last leg's arrival." },
  { id: "maxDutyHours", group: "trips", label: "Longest duty period", better: "fewer", ...hours, definition: "The longest duty, report to the last leg's arrival." },
  { id: "hubTurns", group: "trips", label: "Hub turns", better: "fewer", ...count("hub turn"), definition: "Every leg into a sort hub, sitting while the packages are sorted, and a leg back out, day or night." },
  { id: "dayHubTurns", group: "trips", label: "Day hub turns", better: "fewer", ...count("hub turn"), definition: "Hub turns by day, without a night at a hotel." },
  { id: "restHotelHubTurns", group: "trips", label: "Hub turns with a crew-rest hotel", better: "depends", ...count("hub turn"), definition: "Hub turns with long enough in the hub, about 4 hours or more, for a short airport hotel." },
  { id: "deIcingExposure", group: "trips", label: "Takeoffs where you'd likely de-ice", better: "fewer", ...count("takeoff"), definition: "Operated takeoffs, each counted by how often nights freeze at that airport in that month." },
  { id: "hotelStandbyDays", group: "trips", label: "Hotel standby days", better: "depends", ...count("day"), definition: "All hotel standby days, at the domicile or on a trip: on call, paid, not flying." },
  { id: "tripStandbyDays", group: "trips", label: "Standby days on trips", better: "depends", ...count("day"), definition: "Hotel standby days at a layover city, in the middle of a trip." },
  { id: "baseStandbyDays", group: "trips", label: "Standby days at the domicile", better: "fewer", ...count("day"), definition: "Hotel standby days at the domicile itself." },
  { id: "standbyDaysByCity", group: "trips", label: "Standby days, by where they are", better: "more", ...count("day"), needs: "cityScores", definition: "Hotel standby days, worth more in cities you like and less in ones you avoid." },

  // ---- Layovers ----
  { id: "layoverCount", group: "layovers", label: "Layovers", better: "depends", ...count("layover"), definition: "Layovers in the month." },
  { id: "avgLayoverHours", group: "layovers", label: "Average layover", better: "more", ...hours, definition: "Average layover length." },
  { id: "layoverFullDays", group: "layovers", label: "Full days off on layovers", better: "more", ...count("day"), definition: "Free days between two full nights' sleep on a layover, in any city." },
  { id: "eatAndSleepLayovers", group: "layovers", label: "Eat-and-sleep layovers", better: "fewer", ...count("layover"), definition: "Layovers with no full day free in them." },
  { id: "longLayoverHours", group: "layovers", label: "Long-layover time", better: "more", ...hours, definition: "Layover hours past 24 (or the length you gave us), added up." },
  { id: "layoversInRange", group: "layovers", label: "Layovers of 30 to 48 hours", better: "more", ...count("layover"), definition: "Layovers from 30 to 48 hours long (or the range you gave us)." },
  { id: "shortLayovers", group: "layovers", label: "Short layovers", better: "fewer", ...count("layover"), definition: "Layovers under 24 hours (or the length you gave us)." },
  { id: "sleepableLayovers", group: "layovers", label: "Layovers you can sleep on", better: "more", ...count("layover"), definition: "Layovers with at least 6.5 hours of local night (22:00–07:00)." },
  { id: "daytimeLayovers", group: "layovers", label: "Layovers with no real night", better: "fewer", ...count("layover"), definition: "Layovers with under 4 hours of local night (22:00–07:00), however long they are." },
  { id: "avgLayoverNightHours", group: "layovers", label: "Night hours per layover", better: "more", ...hours, definition: "Average hours of local night (22:00–07:00) on a layover." },
  { id: "internationalLayoverShare", group: "layovers", label: "International layovers", better: "depends", ...share, definition: "Share of layovers outside the US." },
  { id: "layoverHoursInCities", group: "layovers", label: "Hours in a city", better: "more", ...hours, needs: "city", definition: "Layover hours in the city you pick." },
  { id: "layoversInCities", group: "layovers", label: "Layovers in a city", better: "more", ...count("layover"), needs: "city", definition: "Layovers in the city you pick." },
  { id: "tripsTouchingCities", group: "layovers", label: "Trips through a city", better: "more", ...count("trip"), needs: "city", definition: "Trips that land in the city you pick, layover or not." },
  { id: "layoverShareInRegions", group: "layovers", label: "Layovers in a region", better: "more", ...share, needs: "region", definition: "Share of layovers in the region you pick." },
  { id: "layoverValue", group: "layovers", label: "Time in cities you like", better: "more", ...hours, needs: "cityScores", definition: "Layover hours, counted up for cities you like and down for ones you avoid." },
  { id: "fullDaysInLikedCities", group: "layovers", label: "Full days in cities you like", better: "more", ...count("day"), needs: "cityScores", definition: "Full free days on layovers, counted up for cities you like and down for ones you avoid." },

  // ---- Nights and body clock ----
  { id: "bodyClockScore", group: "body", label: "Body-clock score", better: "more", ...score, definition: "How gentle the line is on the body clock, 1–100: night work, early reports, time awake, layover sleep, time zones." },
  { id: "hardestTripBodyClock", group: "body", label: "Hardest trip on the body clock", better: "more", ...score, definition: "The body-clock score of the line's hardest trip, 1–100." },
  { id: "dayFlyingShare", group: "body", label: "Day flying %", better: "more", ...share, definition: "Share of your operated block time flown between 06:00 and 22:00 local. Deadheads and standby don't count." },
  { id: "nightsWorked", group: "body", label: "Nights worked", better: "fewer", ...count("night"), definition: "Nights with at least half an hour of 00:00–05:00 spent flying or on hotel standby." },
  { id: "longestNightStreak", group: "body", label: "Most nights in a row worked", better: "fewer", ...count("night"), definition: "The longest run of nights worked in a row, across trips." },
  { id: "deepNightHours", group: "body", label: "Hours worked on the backside of the clock", better: "fewer", ...hours, definition: "Hours of flying and on-call standby between 00:00 and 05:00 local." },
  { id: "redEyeLegs", group: "body", label: "Night legs", better: "fewer", ...count("leg"), definition: "Operated legs with at least an hour of 00:00–05:00 local." },
  { id: "redEyeFinishes", group: "body", label: "Trips that end with a night leg", better: "fewer", ...count("trip"), definition: "Trips whose last operated leg flies through the night and lands at dawn." },
  { id: "allNighterStreak", group: "body", label: "Most duties through the night in a row", better: "fewer", ...count("duty", "duties"), definition: "The longest run of duties flying at least 3 of the 5 hours from 00:00 to 05:00 local." },
  { id: "backToBackRedEyes", group: "body", label: "Back-to-back duties through the night", better: "fewer", ...count("duty", "duties"), definition: "Duties through the night straight after another one." },
  { id: "earlyReports", group: "body", label: "Early reports", better: "fewer", ...count("duty", "duties"), definition: "Duties reporting between 02:00 and 06:00 local." },
  { id: "nightHubTurns", group: "body", label: "Night hub turns", better: "fewer", ...count("hub turn"), definition: "Hub turns whose time in the hub runs through 00:00–05:00 local." },
  { id: "nightHubTurnRuns", group: "body", label: "Weeks of night hub turns", better: "fewer", ...count("hub turn"), definition: "Night hub turns that come three or more nights in a row." },
  { id: "longestHubTurnRun", group: "body", label: "Most night hub turns in a row", better: "fewer", ...count("night"), definition: "The longest run of nights in a row with a night hub turn." },
  { id: "timezoneHoursCrossed", group: "body", label: "Time zones crossed", better: "fewer", ...hours, definition: "Total time-zone distance across every leg." },
];

export const LINE_SORTS_BY_ID = new Map(LINE_SORTS.map((s) => [s.id, s]));

/** Catalog measures with no sort of their own, and why. Retired ones aren't here: nothing reads them. */
export const NOT_A_SORT: Record<string, string> = {
  requestedDatesWorked: "shown the other way up, as requestedDatesKept",
};

/** The regions a pilot can pick, for "Layovers in a region". */
export const SORT_REGIONS: { id: Region; label: string }[] = [
  { id: "domestic", label: "Lower 48" },
  { id: "alaska", label: "Alaska" },
  { id: "hawaii", label: "Hawaii" },
  { id: "americas", label: "Latin America and Canada" },
  { id: "asia", label: "Asia" },
  { id: "oceania", label: "Oceania" },
  { id: "europe", label: "Europe" },
  { id: "middleEast", label: "Middle East" },
  { id: "africa", label: "Africa" },
];

/** What the pilot picked: which sort, whether they flipped its usual order, and the city or region it asks for. */
export interface SortChoice {
  id: string;
  reversed?: boolean;
  city?: string;
  region?: Region;
}

export const DEFAULT_SORT: SortChoice = { id: MATCH_SORT };

/** Everything measuring a sort needs, worked out once per pack, pilot and flights. */
export interface SortContext {
  pack: PackMetrics;
  lines: Line[];
  /** The pilot's home settings, for every measure. */
  home: MetricParams;
  /** Each measure's parameters as the pilot gave them, from their priorities. */
  criterionParams: Map<string, MetricParams>;
  /** How the pilot grades cities, from whichever priority holds their grades; every city-valued sort reads the same ones. */
  cityGrades: MetricParams | null;
  /** The dates the pilot needs off that fall in this bid month. */
  dates: string[];
  departureOptions?: MonthDepartureOptions;
  commuter: boolean;
  bidPeriodStart: string | null;
  cities: string[];
}

function homeFromProfile(profile: Pick<PreferenceProfile, "isCommuter" | "commuteFrom" | "hasCrashPad" | "minHomeHours">): MetricParams {
  if (!profile.isCommuter || !profile.commuteFrom) return {};
  return {
    homeAirports: [profile.commuteFrom],
    ...(profile.hasCrashPad != null ? { hasCrashPad: profile.hasCrashPad } : {}),
    ...(profile.minHomeHours ? { minHomeHours: profile.minHomeHours } : {}),
  };
}

function datesInMonth(profile: Pick<PreferenceProfile, "discoveredFacts">, model: PilotModel | undefined, bidPack: Pick<BidPack, "bidPeriodStart" | "bidPeriodDays">): string[] {
  const start = bidPack.bidPeriodStart;
  if (!start) return [];
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = first + (bidPack.bidPeriodDays - 1) * 86_400_000;
  const all = [
    ...(profile.discoveredFacts ?? []).flatMap((f) => f.specificDates ?? []),
    ...(model?.criteria ?? []).filter((c) => c.metric === "requestedDatesWorked").flatMap((c) => c.params?.dates ?? []),
  ];
  return [...new Set(all)]
    .filter((d) => {
      const t = Date.parse(`${d}T00:00:00Z`);
      return t >= first && t <= last;
    })
    .sort();
}

export function buildSortContext(
  bidPack: BidPack,
  profile: Pick<PreferenceProfile, "isCommuter" | "commuteFrom" | "hasCrashPad" | "minHomeHours" | "discoveredFacts"> & { pilotModel?: PilotModel },
  pack: PackMetrics,
  departureOptions?: MonthDepartureOptions
): SortContext {
  const model = profile.pilotModel;
  const home = model?.home ? homeParams(model) : homeFromProfile(profile);
  const criterionParams = new Map<string, MetricParams>();
  for (const c of model?.criteria ?? []) if (c.params && !criterionParams.has(c.metric)) criterionParams.set(c.metric, c.params);
  const graded = model?.criteria.find((c) => c.params?.cityScores)?.params;
  const cityGrades = graded ? { cityScores: graded.cityScores, citySeasons: graded.citySeasons, hotelScores: graded.hotelScores, hotelAreas: graded.hotelAreas } : null;
  const cities = new Set<string>();
  for (const line of bidPack.lines) for (const t of line.trips) for (const c of t.layoverCities) cities.add(c);
  return {
    pack,
    lines: bidPack.lines,
    home,
    criterionParams,
    cityGrades,
    dates: datesInMonth(profile, model, bidPack),
    departureOptions,
    commuter: !!home.homeAirports?.length && !home.homeAirports.includes(bidPack.base),
    bidPeriodStart: bidPack.bidPeriodStart,
    cities: [...cities].sort(),
  };
}

/** Whether the pilot has given what this sort needs. */
export function sortAvailable(def: SortDef, ctx: SortContext): boolean {
  switch (def.needs) {
    case "commuter":
      return ctx.commuter;
    case "flights":
      return ctx.commuter && Object.keys(ctx.pack.ctx.flights ?? {}).length > 0;
    case "dates":
      return ctx.dates.length > 0 && !!ctx.bidPeriodStart;
    case "weekdays":
      return !!ctx.criterionParams.get("weekdaysOff")?.weekdays?.length;
    case "cityScores":
      return !!ctx.cityGrades;
    case "city":
      return ctx.cities.length > 0;
    default:
      return true;
  }
}

/** The sort a pilot's choice comes to: their choice if it's real and they can use it, else the ranking. */
export function resolveSort(choice: SortChoice, ctx: SortContext | null): SortDef {
  const def = LINE_SORTS_BY_ID.get(choice.id);
  const match = LINE_SORTS_BY_ID.get(MATCH_SORT)!;
  if (!def || def.group === "order") return def ?? match;
  return ctx && sortAvailable(def, ctx) ? def : match;
}

function paramsFor(def: SortDef, choice: SortChoice, ctx: SortContext, metric = def.id): MetricParams {
  const city = choice.city && ctx.cities.includes(choice.city) ? choice.city : ctx.cities[0];
  const region = choice.region ?? SORT_REGIONS[0].id;
  return {
    ...ctx.home,
    ...ctx.criterionParams.get(metric),
    ...(def.needs === "cityScores" ? ctx.cityGrades : {}),
    ...(def.needs === "city" ? { cities: city ? [city] : [] } : {}),
    ...(def.needs === "region" ? { regions: [region] } : {}),
  };
}

/**
 * Every line's value on a sort, null where the pack can't say (an estimated line, a line whose flights weren't looked
 * up). Departures are counted as each card counts them, the times the pilot leaves home, not the scorer's share of one
 * running into next month.
 */
export function sortValues(def: SortDef, choice: SortChoice, ctx: SortContext): Map<string, number | null> {
  let known = sortValuesByContext.get(ctx);
  if (!known) sortValuesByContext.set(ctx, (known = new Map()));
  const key = `${def.id}|${def.needs === "city" ? choice.city : ""}|${def.needs === "region" ? choice.region : ""}`;
  let values = known.get(key);
  if (!values) known.set(key, (values = readSortValues(def, choice, ctx)));
  return values;
}

const sortValuesByContext = new WeakMap<SortContext, Map<string, Map<string, number | null>>>();

function readSortValues(def: SortDef, choice: SortChoice, ctx: SortContext): Map<string, number | null> {
  const { lines, pack } = ctx;
  const out = new Map<string, number | null>();
  const each = (read: (line: Line) => number | null) => lines.forEach((l) => out.set(l.id, read(l)));
  switch (def.id) {
    case MATCH_SORT:
    case LINE_NUMBER_SORT:
      return out;
    case "carryOverCredit":
      each((l) => l.carryOverCreditHours ?? 0);
      return out;
    case "totalCredit":
      each((l) => l.totalCreditHours + (l.carryOverCreditHours ?? 0));
      return out;
    case "requestedDatesKept": {
      const worked = measureAll("requestedDatesWorked", lines, pack, { ...ctx.home, dates: ctx.dates });
      lines.forEach((l, i) => out.set(l.id, worked[i] === null ? null : ctx.dates.length - worked[i]!));
      return out;
    }
    case "homeDepartures":
      if (ctx.departureOptions && ctx.bidPeriodStart) {
        const options = ctx.departureOptions;
        const start = ctx.bidPeriodStart;
        each((l) => groupDepartures((pack.monthLines.get(l.id) ?? l).trips, { bidPeriodStart: start, base: options.base }, options).length);
        return out;
      }
      break;
  }
  const values = measureAll(def.id, lines, pack, paramsFor(def, choice, ctx));
  lines.forEach((l, i) => out.set(l.id, values[i]));
  return out;
}

const byLineNumber = (a: LineScore, b: LineScore) => a.line.lineNumber.localeCompare(b.line.lineNumber, undefined, { numeric: true });

/** Whether this sort shows high numbers first: its usual order is the better end first, unless the pilot flipped it. */
export function highFirst(def: SortDef, choice: SortChoice): boolean {
  const usual = def.better !== "fewer";
  return choice.reversed ? !usual : usual;
}

/**
 * A new list in the sort's order; "Best match" keeps the incoming order, which is already ranked. A line the measure
 * can't read goes last whichever way it's sorted: unknown isn't best or worst. Equal lines break by score and then line
 * number, so they never shuffle between renders.
 */
export function applySort(list: LineScore[], choice: SortChoice, ctx: SortContext | null): LineScore[] {
  const def = resolveSort(choice, ctx);
  // A sort the pilot can't use any more falls back to the plain ranking, not the ranking upside down.
  if (def.id !== choice.id) return list;
  if (def.id === MATCH_SORT) return choice.reversed ? [...list].reverse() : list;
  if (def.id === LINE_NUMBER_SORT) {
    const up = [...list].sort(byLineNumber);
    return choice.reversed ? up.reverse() : up;
  }
  if (!ctx) return list;
  const values = sortValues(def, choice, ctx);
  const sign = highFirst(def, choice) ? -1 : 1;
  return [...list].sort((a, b) => {
    const va = values.get(a.line.id) ?? null;
    const vb = values.get(b.line.id) ?? null;
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
    } else if (va !== vb) return sign * (va - vb);
    return b.score - a.score || byLineNumber(a, b);
  });
}

const oneDecimal = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** A sort's value in words: "85.3 hrs", "62%", "05:30", "4 of 5 dates". */
export function formatSortValue(def: SortDef, value: number | null, ctx: Pick<SortContext, "dates">): string {
  if (value === null) return "Not known";
  if (def.id === "requestedDatesKept") return `${value} of ${ctx.dates.length} kept`;
  switch (def.kind) {
    case "hours":
      return `${oneDecimal(value)} hrs`;
    case "rate":
      return `${value.toFixed(2)} ${def.id === "creditPerBlockHour" ? "per block hr" : "hrs per day"}`;
    case "share":
      return `${Math.round(value * 100)}%`;
    case "score":
      return String(Math.round(value));
    case "clock": {
      const m = Math.round(value) % 1440;
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    }
    case "count": {
      const [one, many] = def.noun ?? ["", ""];
      return `${oneDecimal(value)} ${value === 1 ? one : many}`.trim();
    }
  }
}

/** The order in words, for the menu's toggle. */
export function orderLabels(def: SortDef): { usual: string; flipped: string } {
  if (def.id === MATCH_SORT) return { usual: "Best first", flipped: "Worst first" };
  if (def.id === LINE_NUMBER_SORT) return { usual: "Low to high", flipped: "High to low" };
  if (def.kind === "clock") return def.better === "more" ? { usual: "Latest first", flipped: "Earliest first" } : { usual: "Earliest first", flipped: "Latest first" };
  return def.better === "fewer" ? { usual: "Lowest first", flipped: "Highest first" } : { usual: "Highest first", flipped: "Lowest first" };
}

/** Which way is better, in words. Empty when pilots want it both ways. */
export function betterLabel(def: SortDef): string {
  if (def.better === "depends" || def.group === "order") return "";
  if (def.kind === "clock") return def.better === "more" ? "Later is better" : "Earlier is better";
  if (def.kind === "share" || def.kind === "score" || def.kind === "hours" || def.kind === "rate") return def.better === "more" ? "Higher is better" : "Lower is better";
  return def.better === "more" ? "More is better" : "Fewer is better";
}

export interface SortPreview {
  top: { lineNumber: string; text: string }[];
  /** How many of the listed lines the measure can read. */
  measured: number;
  total: number;
}

/** The first lines a sort would put on top, with their values, for the menu. */
export function previewSort(list: LineScore[], def: SortDef, choice: SortChoice, ctx: SortContext, n = 3): SortPreview {
  if (def.group === "order") {
    const top = applySort(list, { ...choice, id: def.id }, ctx).slice(0, n);
    return { top: top.map((r) => ({ lineNumber: r.line.lineNumber, text: def.id === MATCH_SORT ? `${Math.round(r.score)} match` : "" })), measured: list.length, total: list.length };
  }
  const values = sortValues(def, choice, ctx);
  const top = applySort(list, { ...choice, id: def.id }, ctx).slice(0, n);
  return {
    top: top.map((r) => ({ lineNumber: r.line.lineNumber, text: formatSortValue(def, values.get(r.line.id) ?? null, ctx) })),
    measured: list.filter((r) => (values.get(r.line.id) ?? null) !== null).length,
    total: list.length,
  };
}

/** Sorts matching what the pilot typed: every word found in the name, the group or the definition, name matches first. */
export function searchSorts(defs: SortDef[], query: string): SortDef[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return defs;
  const group = (d: SortDef) => SORT_GROUPS.find((g) => g.id === d.group)!.label.toLowerCase();
  const inName = (d: SortDef) => words.every((w) => d.label.toLowerCase().includes(w));
  const found = defs.filter((d) => {
    const hay = `${d.label} ${group(d)} ${d.definition}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return [...found.filter(inName), ...found.filter((d) => !inName(d))];
}

/** One line for what's being sorted on the card opened under its strip; the strips themselves never show it. */
export function sortValueForLine(def: SortDef, choice: SortChoice, ctx: SortContext, lineId: string): string | null {
  if (def.group === "order") return null;
  return formatSortValue(def, sortValues(def, choice, ctx).get(lineId) ?? null, ctx);
}

function sortKey(userId: string | null, bidPackId: string): string {
  return `line-select:line-sort:${userId ?? "guest"}:${bidPackId}:v1`;
}

/** The last sort on this pack. Only the sort's shape is checked here; `resolveSort` decides whether it can still be used. */
export function loadSortChoice(userId: string | null, bidPackId: string): SortChoice {
  if (typeof window === "undefined") return DEFAULT_SORT;
  try {
    const raw = window.localStorage.getItem(sortKey(userId, bidPackId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_SORT;
    const c = parsed as Record<string, unknown>;
    if (typeof c.id !== "string" || !LINE_SORTS_BY_ID.has(c.id)) return DEFAULT_SORT;
    return {
      id: c.id,
      ...(c.reversed === true ? { reversed: true } : {}),
      ...(typeof c.city === "string" ? { city: c.city } : {}),
      ...(SORT_REGIONS.some((r) => r.id === c.region) ? { region: c.region as Region } : {}),
    };
  } catch {
    return DEFAULT_SORT;
  }
}

/** Whether the browser kept it; when it didn't, the pilot is told it won't survive a refresh (`saveOrReport`). */
export function saveSortChoice(userId: string | null, bidPackId: string, choice: SortChoice): boolean {
  return saveOrReport(sortKey(userId, bidPackId), JSON.stringify(choice));
}
