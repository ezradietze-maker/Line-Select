/**
 * How a pilot would say one line beats another on a feature, without the measurement behind it. "5.1 hours after
 * midnight", "33/100 on the body clock" and "138 hours in cities you like" are how the app measures a line, not how a
 * pilot talks about one, and the owner couldn't make sense of them in a question (Nov 2026): "mostly just name features
 * in the descriptions of the lines". So a line choice describes each line by what it has — less night flying, easier on
 * the body clock, more time in cities you like — and keeps numbers only where a pilot counts them on a line themselves:
 * days off, trips, departures, credit, days in a trip, long duty periods, early shows.
 *
 * Each entry is the phrase for the line that's better on it.
 */
const BETTER: Record<string, string> = {
  deepNightHours: "less night flying",
  nightsWorked: "fewer nights working after midnight",
  longestNightStreak: "no long runs of nights in a row",
  redEyeLegs: "fewer night legs",
  dayFlyingShare: "more day flying",
  bodyClockScore: "easier on the body clock",
  avgCircadianStars: "easier on the body clock",
  hardestTripBodyClock: "no really rough trip on the body clock",
  layoverValue: "more time in cities you like",
  layoverHoursInCities: "more time in the cities you named",
  fullDaysInLikedCities: "more full days off in cities you like",
  layoverFullDays: "more full days off on layovers",
  daytimeLayovers: "more layovers you can sleep on at night",
  sleepableLayovers: "more layovers you can sleep on at night",
  avgLayoverNightHours: "layovers with more of the night to sleep",
  eatAndSleepLayovers: "fewer layovers with only time to eat and sleep",
  longLayoverHours: "longer layovers",
  avgLayoverHours: "longer layovers",
  shortLayovers: "fewer short layovers",
  creditPerDayAwayFromHome: "better pay for the days away from home",
  creditPerDayAway: "better pay for the days away",
  effectiveCreditPerDayAway: "better pay for the days away",
  creditPerBlockHour: "more pay for the flying",
  homeAwayHours: "less time away from home",
  tafbHours: "less time away from base",
  timezoneHoursCrossed: "fewer time zones crossed",
  latestBaseRelease: "gets you back earlier",
  earliestBaseReport: "later shows",
  longestTripHome: "a quicker trip home after the last flight",
  standbyDaysByCity: "hotel standby in better places",
  blockHours: "less flying",
  avgTripDays: "shorter trips",
  workDays: "fewer days given to work",
  deIcingExposure: "less de-icing",
  realBreakNights: "more real breaks at home",
  nightsHome: "more nights in your own bed",
};

/** The phrase for the line that's better on a measure, or null when its count is what a pilot says ("16 days off"). */
export function plainBetter(metric: string): string | null {
  return BETTER[metric] ?? null;
}
