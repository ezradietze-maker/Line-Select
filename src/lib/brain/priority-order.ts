import type { PilotModel } from "@/types/pilot-model";

/**
 * The first question after the opening, asked the same way every time and
 * without a model call: of the two or three things the pilot's story says
 * matter most, which do they give up last? It's put in words before any line
 * choice can touch those priorities — a close call between two lines is often
 * made for some other reason (one commute, but on a 14-day trip), and on its
 * own it shouldn't get to reorder what a pilot would have told us outright if
 * asked.
 */

/** How the question opens — how the transcript (and the interviewer's own guard against repeats) recognizes it. */
export const PRIORITY_ORDER_LEAD = "When these pull against each other";
export const ABOUT_EQUAL = "They matter about the same";

/**
 * Measures that are the same priority to a pilot, said different ways — "weekends off" against "Saturdays off", or pay
 * per day against pay per day from home, isn't a trade anyone has to make. Anything not listed is its own priority.
 */
const FAMILY: Record<string, string> = {
  daysOff: "days off",
  weekendDaysOff: "days off",
  weekdaysOff: "days off",
  longestDaysOffBlock: "days off",
  requestedDatesWorked: "days off",
  creditHours: "pay",
  creditPerDayAway: "pay",
  effectiveCreditPerDayAway: "pay",
  creditPerDayAwayFromHome: "pay",
  baseCommutesNeeded: "commute",
  departureCommutes: "commute",
  baseHotelNights: "commute",
  doubleDeadheadTrips: "commute",
  frontDeadheadTrips: "commute",
  backDeadheadTrips: "commute",
  tripsJoinedFromHome: "commute",
  tripsEndingStraightHome: "commute",
  avgTripDays: "trip length",
  longestTripDays: "trip length",
  tripCount: "trip length",
  homeDepartures: "trip length",
  layoverValue: "cities",
  layoverHoursInCities: "cities",
  layoversInCities: "cities",
  tripsTouchingCities: "cities",
  bodyClockScore: "body clock",
  hardestTripBodyClock: "body clock",
};

/** How many of the top priorities to put to them. */
const SHOWN = 3;
/** After their pick, no other priority weighs more than this share of it. */
const RUNNER_UP_CEILING = 0.85;

export interface PriorityOrderQuestion {
  prompt: string;
  helpText: string;
  options: string[];
  /** The criterion behind each option, in order; the last option ("about the same") has none. */
  criterionIds: string[];
}

export function priorityOrderQuestion(model: PilotModel | null): PriorityOrderQuestion | null {
  if (!model) return null;
  // One per priority family (see FAMILY) — the question is which of their different priorities wins.
  const seen = new Set<string>();
  const top = [...model.criteria]
    .sort((a, b) => b.weight - a.weight)
    .filter((c) => {
      const key = FAMILY[c.metric] ?? c.metric;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SHOWN);
  if (top.length < 2) return null;
  return {
    prompt: `${PRIORITY_ORDER_LEAD}, which would you give up last?`,
    helpText: "From your story, these matter most to you. Add a note if the order is different.",
    options: [...top.map((c) => c.label), ABOUT_EQUAL],
    criterionIds: top.map((c) => c.id),
  };
}

/** The transcript's record of the question, with the options it offered — so the brain reads what the pick was out of. */
export function priorityOrderTranscript(q: PriorityOrderQuestion): string {
  return `${q.prompt} (${q.options.slice(0, -1).join(" / ")})`;
}

/**
 * Their answer, applied at once (the brain also reads it at its next pass): the priority they'd give up last becomes
 * their strongest, with the rest kept clearly below it. "About the same" changes nothing.
 */
export function applyPriorityPick(model: PilotModel, criterionId: string | null): PilotModel {
  const picked = criterionId ? model.criteria.find((c) => c.id === criterionId) : undefined;
  if (!picked) return model;
  const top = Math.max(...model.criteria.map((c) => c.weight)) || 1;
  const criteria = model.criteria.map((c) =>
    c.id === picked.id ? { ...c, weight: 1, confidence: Math.max(c.confidence, 0.9) } : { ...c, weight: Math.min(c.weight / top, RUNNER_UP_CEILING) }
  );
  return { ...model, criteria };
}
