import type { InterviewExchange } from "@/lib/brain/build-model";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { withHomeFacts } from "@/lib/brain/model-upgrade";
import { parseAirportCode } from "@/lib/interview-story";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

/**
 * A way in that takes about a minute: priorities tapped into order, a sentence if they like, and one read by the same
 * brain that reads the full interview. No questions follow, so it knows less, and the results say so; dragging lines
 * teaches it the same way it teaches a model from the interview.
 *
 * Each chip's words go to the brain as if the pilot said them, written the way pilots say it so the brain's own rules
 * bind them to the right measures. A chip states what matters and never a limit: a pilot who tapped "short trips" hasn't
 * said how short, and a limit they didn't give would cap lines they'd have been happy with.
 */

export interface QuickChip {
  id: string;
  label: string;
  /** What it says to the brain, in the pilot's voice. */
  says: string;
}

export const QUICK_CHIPS: QuickChip[] = [
  { id: "days-in-a-row", label: "Days off in a row", says: "Long stretches of days off in a row, a real break at home." },
  { id: "more-days", label: "More days off", says: "As many days off in the month as I can get." },
  { id: "weekends", label: "Weekends off", says: "Having my Saturdays and Sundays off." },
  { id: "few-departures", label: "Fewer times leaving home", says: "Leaving home as few times a month as I can. Trips that run straight into each other count as one time away." },
  { id: "easy-commute", label: "Easy to commute", says: "Trips that are easy to get to and home from. Starting or ending on a deadhead I can reach from home is a big plus." },
  { id: "day-flying", label: "Flying in daylight", says: "I'd rather be on a day schedule, flying in the daytime." },
  { id: "sleep", label: "Protect my sleep", says: "Staying off the back side of the clock, with layovers I can actually sleep on." },
  { id: "no-hub-turns", label: "No night hub turns", says: "I don't want runs of night hub turns, sitting through the sort night after night." },
  { id: "credit", label: "Highest pay", says: "The most credit hours in the month." },
  { id: "pay-per-day", label: "Pay for time away", says: "The most pay for each day I'm away from home." },
  { id: "short-trips", label: "Short trips", says: "Shorter trips, home more often." },
  { id: "long-trips", label: "Fewer, longer trips", says: "A few long trips rather than many short ones, so the month is packed together." },
  { id: "international", label: "International flying", says: "International flying, more of it the better." },
  { id: "few-legs", label: "Fewer legs a day", says: "Single-leg duties. Two legs is nearly twice the work, and three is too many." },
  { id: "layovers", label: "Layovers worth having", says: "Long layovers with a full day free, not just time to eat and sleep." },
  { id: "no-standby", label: "Little standby", says: "As little standby as possible." },
];

const CHIPS_BY_ID = new Map(QUICK_CHIPS.map((c) => [c.id, c]));

/** Where to start: chips in an order, all of it visible and editable. Nothing here is hidden from the pilot. */
export const QUICK_STARTS: { id: string; label: string; chips: string[] }[] = [
  { id: "home", label: "Home as much as I can be", chips: ["days-in-a-row", "few-departures", "more-days", "weekends"] },
  { id: "commuter", label: "Commuting in from elsewhere", chips: ["few-departures", "easy-commute", "days-in-a-row", "pay-per-day"] },
  { id: "rested", label: "Rested and off the night shift", chips: ["sleep", "no-hub-turns", "day-flying", "few-legs"] },
  { id: "earn", label: "Earning the most", chips: ["credit", "pay-per-day", "international"] },
  { id: "travel", label: "Seeing good places", chips: ["layovers", "international", "long-trips"] },
  { id: "family", label: "Evenings and weekends with family", chips: ["weekends", "short-trips", "day-flying", "more-days"] },
];

export interface QuickBriefInput {
  /** Chip ids, most important first. */
  chips: string[];
  /** Their one sentence, typed or dictated. */
  sentence: string;
  /** Dates they need home, in their own words. */
  dates: string;
}

/** A brief needs one thing to read: a priority or a sentence. */
export function quickBriefReady({ chips, sentence }: Pick<QuickBriefInput, "chips" | "sentence">): boolean {
  return chips.length > 0 || sentence.trim().length > 0;
}

const QUESTION =
  "Quick brief instead of an interview. The pilot tapped what matters to them, most important first, and may have added their own words; no follow-up questions will be asked. Earlier in the list means it counts for more, and their own words count at least as much as anything tapped. They gave no numbers unless written here, so set no hard limits from the list.";

/** The brief as the one exchange the brain reads, so the same read serves both ways in. */
export function quickBriefExchanges({ chips, sentence, dates }: QuickBriefInput): InterviewExchange[] {
  const said = chips.flatMap((id) => {
    const chip = CHIPS_BY_ID.get(id);
    return chip ? [chip.says] : [];
  });
  const parts = [
    said.length ? `What matters to me, most important first:\n${said.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "",
    sentence.trim() ? `In my own words: ${sentence.trim()}` : "",
    dates.trim() ? `Dates I need off: ${dates.trim()}` : "",
  ].filter(Boolean);
  return [{ turn: 0, question: QUESTION, answer: parts.join("\n\n") }];
}

/**
 * The profile a quick brief saves: the same shape an interview leaves, so ranking, the drag learner and the priorities
 * page all work on it, marked so the results can say it's a quick start and the next interview starts from the top.
 */
export function quickBriefProfile({
  bidPack,
  model,
  exchanges,
  isCommuter,
  commuteFrom,
  seniorityNumber,
  prior,
}: {
  bidPack: Pick<BidPack, "id">;
  model: PilotModel;
  exchanges: InterviewExchange[];
  isCommuter: boolean | null;
  commuteFrom: string;
  seniorityNumber: number | null;
  prior: PreferenceProfile | null;
}): PreferenceProfile {
  // A quick brief asks nothing about cities or home, so what the pilot said about them before still stands: their city
  // grades, and whether they keep a crash pad and how long they need at home. On the model as the full interview puts
  // them (and every refit after does, from the profile), or the first drag reorders lines for reasons that have nothing
  // to do with it.
  const cityRatings = prior?.cityRatings ?? {};
  const hasCrashPad = prior?.hasCrashPad ?? null;
  const minHomeHours = isCommuter ? (prior?.minHomeHours ?? null) : null;
  const homed = withHomeFacts(applyCityRatings(model, cityRatings), { hasCrashPad, minHomeHours });
  return {
    ...carriedOver(prior),
    source: "quick",
    weights: { ...DEFAULT_WEIGHTS },
    deepRoundCompleted: false,
    tradeoffAnswers: [],
    explicitTargets: {},
    isCommuter,
    commuteFrom: parseAirportCode(commuteFrom),
    hasCrashPad,
    ...(minHomeHours ? { minHomeHours } : {}),
    seniorityNumber,
    cityPreferences: prior?.cityPreferences ?? {},
    cityRatings,
    completedAt: new Date().toISOString(),
    implicitWeights: {},
    implicitConfidence: {},
    discoveredFacts: [],
    interviewTranscript: [],
    pilotModel: homed,
    brainInterview: { exchanges, choices: [], reviewedModel: homed, packId: bidPack.id },
  };
}

/**
 * What a new interview, check-in or quick brief keeps from the profile it replaces: what belongs to the pilot rather
 * than to one interview. Without it, each month's check-in erased the logbook (and the carry-in it gives next month)
 * and the bid checklist.
 */
export function carriedOver(prior: PreferenceProfile | null | undefined): Pick<PreferenceProfile, "strategyReactions" | "logbook" | "bidChecklist"> {
  return {
    ...(prior?.strategyReactions ? { strategyReactions: prior.strategyReactions } : {}),
    ...(prior?.logbook?.length ? { logbook: prior.logbook } : {}),
    ...(prior?.bidChecklist ? { bidChecklist: prior.bidChecklist } : {}),
  };
}
