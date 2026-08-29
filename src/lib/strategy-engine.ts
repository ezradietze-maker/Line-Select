import { computeTripAnalytics } from "@/lib/trip-analytics";
import type { BidPack, Line } from "@/types/bidpack";
import type {
  AutoBidEntry,
  FeasibilityTier,
  SeniorityInput,
  Strategy,
  StrategyLineRecommendation,
} from "@/types/strategy";

/**
 * Every number here comes straight from the bid pack's own printed
 * credit/TAFB/block totals (via computeTripAnalytics) — nothing about a
 * pilot's actual odds of winning a line is known outside crew scheduling, so
 * "how rare is this pattern in this specific pack" stands in for demand,
 * clearly labeled as an estimate everywhere it surfaces (see
 * `estimateFeasibility`).
 */

interface LineProfile {
  line: Line;
  /** Sum of real printed block hours the pilot actually FLIES across the line's trips — deadhead legs excluded, since riding along as a passenger isn't effort. Null when any trip lacks a verified per-leg schedule (e.g. an estimated line), since a partial sum would understate real flying. */
  realFlyingHours: number | null;
  /** Credit hours earned per 24 hours of time away — the line's real day-rig rate. */
  dayRigHoursPerDay: number | null;
  /** Real (non-deadhead) block hours flown per 24 hours of time away — how much of the day-rig rate reflects actual flying vs. standby/deadhead. */
  effortHoursPerDay: number | null;
  /** Share of the line's total credit earned by its single biggest trip, 0..1. */
  maxTripCreditShare: number;
  maxTripTafbHours: number;
  tripCount: number;
  avgTripDays: number;
  /** Count of distinct ReportTime categories across the line's trips — 1 means every trip reports at the same time of day. */
  distinctReportTimes: number;
  /** False for a parsed line whose day-by-day trip breakdown couldn't be verified — per-trip shape (count, length, report time) is a rough stand-in there, not real, so trip-count-dependent archetypes skip it. */
  hasVerifiedTrips: boolean;
}

function buildLineProfile(line: Line): LineProfile {
  // `totalBlockHours` counts every leg's wheels-up-to-wheels-down time,
  // deadhead legs included — real for the aircraft, but not real *effort*
  // for a pilot riding along as a passenger. Subtracting `deadheadBlockHours`
  // is what turns this into "hours actually flown."
  const flyingValues = line.trips.map((t) => {
    const a = computeTripAnalytics(t);
    return a.totalBlockHours === null ? null : a.totalBlockHours - (a.deadheadBlockHours ?? 0);
  });
  const realFlyingHours = flyingValues.every((b): b is number => b !== null)
    ? flyingValues.reduce((s, b) => s + (b ?? 0), 0)
    : null;

  const dayRigHoursPerDay =
    line.totalTafbHours > 0 ? line.totalCreditHours / (line.totalTafbHours / 24) : null;
  const effortHoursPerDay =
    realFlyingHours !== null && line.totalTafbHours > 0
      ? realFlyingHours / (line.totalTafbHours / 24)
      : null;

  const maxTrip = line.trips.reduce<Line["trips"][number] | null>(
    (best, t) => (!best || t.creditHours > best.creditHours ? t : best),
    null
  );
  const maxTripCreditShare =
    maxTrip && line.totalCreditHours > 0 ? maxTrip.creditHours / line.totalCreditHours : 0;

  const tripCount = line.trips.length;
  const avgTripDays = tripCount > 0 ? line.trips.reduce((s, t) => s + t.days, 0) / tripCount : 0;
  const distinctReportTimes = new Set(line.trips.map((t) => t.reportTime)).size;

  return {
    line,
    realFlyingHours,
    dayRigHoursPerDay,
    effortHoursPerDay,
    maxTripCreditShare,
    maxTripTafbHours: maxTrip?.tafbHours ?? 0,
    tripCount,
    avgTripDays,
    distinctReportTimes,
    hasVerifiedTrips: !line.estimated,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Position (1 = most extreme) of `line` when every line in the pack is sorted by `score` descending — the basis for "how rare is this," independent of whether the line cleared any archetype's qualifying bar. */
function rankPosition(profiles: LineProfile[], target: LineProfile, score: (p: LineProfile) => number): number {
  const sorted = [...profiles].sort((a, b) => score(b) - score(a));
  return sorted.findIndex((p) => p.line.id === target.line.id) + 1;
}

function desirabilityPercentile(position: number, total: number): number {
  if (total <= 1) return 1;
  return 1 - (position - 1) / (total - 1);
}

function seniorityPercentile(seniority: SeniorityInput): number {
  const total = Math.max(2, seniority.totalPilots);
  const rank = Math.min(Math.max(1, seniority.rank), total);
  return 1 - (rank - 1) / (total - 1);
}

export function estimateFeasibility(
  desirabilityPct: number,
  seniorityPct: number
): { tier: FeasibilityTier; note: string } {
  const margin = seniorityPct - desirabilityPct;
  if (margin >= 0) {
    return {
      tier: "strong",
      note: "Your seniority number comfortably clears how rare this pattern is in this pack.",
    };
  }
  if (margin >= -0.15) {
    return {
      tier: "possible",
      note: "Within real reach at your number — rank it high, but don't build your whole list around it.",
    };
  }
  return {
    tier: "longshot",
    note: "A genuine reach at your current number this bid period — still worth ranking first if you want it, just don't let it be your only real option.",
  };
}

function hours(n: number): string {
  return n.toFixed(1);
}

const GHOST_LINE_COUNT = 2;
const MEGA_TRIP_COUNT = 2;
const RECURRING_TURN_COUNT = 2;
const SAFETY_NET_COUNT = 3;

/** Fraction of the line's day-rig pay that ISN'T real flying — 1.0 means every paid hour is standby/deadhead. A relative measure, not an absolute one, so a short, near-total sit trip outranks a long trip that merely has some slack in it. */
function ghostLineScore(p: LineProfile): number {
  if (p.dayRigHoursPerDay === null || p.effortHoursPerDay === null || p.dayRigHoursPerDay <= 0) {
    return -Infinity;
  }
  return 1 - p.effortHoursPerDay / p.dayRigHoursPerDay;
}

function megaTripScore(p: LineProfile): number {
  return p.maxTripCreditShare * p.maxTripTafbHours;
}

function recurringTurnScore(p: LineProfile): number {
  if (p.avgTripDays <= 0) return -Infinity;
  return p.tripCount / p.avgTripDays - p.distinctReportTimes * 0.5;
}

function safetyNetScore(p: LineProfile, creditRange: [number, number], daysOffRange: [number, number]): number {
  const normalize = (v: number, [min, max]: [number, number]) => (max > min ? (v - min) / (max - min) : 0.5);
  return (
    normalize(p.line.totalCreditHours, creditRange) + normalize(p.line.daysOff, daysOffRange)
  );
}

function toRecommendation(
  p: LineProfile,
  headline: string,
  detail: string,
  feasibility: { tier: FeasibilityTier; note: string }
): StrategyLineRecommendation {
  return {
    lineNumber: p.line.lineNumber,
    headline,
    detail,
    daysOff: p.line.daysOff,
    totalCreditHours: p.line.totalCreditHours,
    totalTafbHours: p.line.totalTafbHours,
    feasibility: feasibility.tier,
    feasibilityNote: feasibility.note,
  };
}

/**
 * Reads a parsed bid pack for the same handful of patterns real pilots have
 * always hunted for by hand — a line whose printed credit vastly outpaces
 * its real flying, a single trip that nearly covers the month, a tight
 * repeating turn — and returns them as named, explained strategies with the
 * actual lines in *this* pack that fit each one. Nothing here is invented:
 * every number quoted is a real total already on the parsed line.
 */
export function generateStrategies(bidPack: BidPack, seniority: SeniorityInput): Strategy[] {
  const profiles = bidPack.lines.map(buildLineProfile);
  const total = profiles.length;
  const seniorityPct = seniorityPercentile(seniority);

  const strategies: Strategy[] = [];

  // ---- Ghost Line ----
  {
    // The qualifying bar is absolute, not just "best of what's here": at
    // least half the paid day-rig rate has to be something other than real
    // flying, or this isn't actually a ghost line — it's just an ordinary
    // one that happened to sort highest among six mediocre options.
    const candidates = profiles
      .filter((p) => p.dayRigHoursPerDay !== null && p.effortHoursPerDay !== null && p.dayRigHoursPerDay! > 0)
      .filter((p) => p.effortHoursPerDay! <= p.dayRigHoursPerDay! * 0.5)
      .sort((a, b) => ghostLineScore(b) - ghostLineScore(a))
      .slice(0, GHOST_LINE_COUNT);

    const lines = candidates.map((p) => {
      const position = rankPosition(profiles, p, ghostLineScore);
      const feasibility = estimateFeasibility(desirabilityPercentile(position, total), seniorityPct);
      const block = p.realFlyingHours ?? 0;
      return toRecommendation(
        p,
        `${hours(p.line.totalCreditHours)} credit hours from just ${hours(block)} hours of real flying`,
        `Away ${hours(p.line.totalTafbHours / 24)} days total, credited at ~${hours(
          p.dayRigHoursPerDay ?? 0
        )} hrs/day — most of that time is standby or deadhead, not stick time.`,
        feasibility
      );
    });

    strategies.push({
      id: "ghost-line",
      name: "The Ghost Line",
      tagline: "Maximum pay, minimum flying — the day-rig floor working in your favor.",
      mechanism:
        "Credit is guaranteed by how many calendar days you're away, not by how much you actually fly. Once a trip's length locks in its pay, extra flying on top of that doesn't earn anything extra — so the highest-value version of any trip length is the one with the least real block time in it. This line's trips are exactly that: heavy on paid standby and deadhead, light on the yoke.",
      benefits: [
        "Full credit for the trip length, with a fraction of the workload",
        "Less time actually on the flight deck means less fatigue over the bid period",
        "Layovers are longer and less interrupted by report/release cycles",
      ],
      lines,
    });
  }

  // ---- Mega Trip ----
  {
    const allTripTafb = bidPack.lines.flatMap((l) => l.trips.map((t) => t.tafbHours));
    const tafbFloor = percentile(allTripTafb, 0.75);
    const candidates = profiles
      .filter((p) => p.hasVerifiedTrips)
      .filter((p) => p.maxTripCreditShare >= 0.75 && p.maxTripTafbHours >= tafbFloor && tafbFloor > 0)
      .sort((a, b) => b.line.totalCreditHours - a.line.totalCreditHours)
      .slice(0, MEGA_TRIP_COUNT);

    const lines = candidates.map((p) => {
      const position = rankPosition(profiles, p, megaTripScore);
      const feasibility = estimateFeasibility(desirabilityPercentile(position, total), seniorityPct);
      return toRecommendation(
        p,
        `One trip covers ${Math.round(p.maxTripCreditShare * 100)}% of this line's ${hours(
          p.line.totalCreditHours
        )}-hour credit total`,
        `${p.line.daysOff} days off, almost entirely in one uninterrupted block once the trip releases.`,
        feasibility
      );
    });

    strategies.push({
      id: "mega-trip",
      name: "The One-And-Done",
      tagline: "Bid the single trip that nearly clears your whole month by itself.",
      mechanism:
        "A handful of trips in most packs are long enough that one of them alone covers most of a full line's credit requirement. Holding a line built around one of those means the rest of your bid period needs almost nothing else — one sustained trip, then a long, uninterrupted stretch of real days off, instead of your month chopped into several shorter outings.",
      benefits: [
        "One continuous block of days off instead of several fragmented ones",
        "Only one report/release cycle to plan your life around all month",
        "Fewer total trips means fewer chances of an irregular-ops surprise",
      ],
      lines,
    });
  }

  // ---- Recurring Turn ----
  {
    const candidates = profiles
      .filter((p) => p.hasVerifiedTrips)
      .filter((p) => p.tripCount >= 3 && p.avgTripDays > 0 && p.avgTripDays <= 2.5)
      .sort((a, b) => recurringTurnScore(b) - recurringTurnScore(a))
      .slice(0, RECURRING_TURN_COUNT);

    const lines = candidates.map((p) => {
      const position = rankPosition(profiles, p, recurringTurnScore);
      const feasibility = estimateFeasibility(desirabilityPercentile(position, total), seniorityPct);
      const predictability = p.distinctReportTimes === 1 ? "the exact same time" : "a narrow band of times";
      return toRecommendation(
        p,
        `${p.tripCount} short trips, averaging ${hours(p.avgTripDays)} days each`,
        `Every trip reports at ${predictability} of day — about as close to a fixed weekly rhythm as a schedule gets.`,
        feasibility
      );
    });

    strategies.push({
      id: "recurring-turn",
      name: "The Metronome",
      tagline: "Trade a little pay ceiling for a schedule you can actually plan a life around.",
      mechanism:
        "A line built from several short, similar trips instead of one long one repeats the same rhythm most weeks — same rough report time, same trip length, often the same layover. It won't out-earn the highest day-rig lines, but it's the most predictable pattern a bid pack offers, which is its own kind of leverage once you're bidding for a stable routine over raw credit.",
      benefits: [
        "The same weekly pattern makes commuting and family scheduling far easier",
        "No single trip is long enough to be badly disrupted by weather or maintenance",
        "Predictable report times mean predictable sleep — none of the whiplash of a mixed-length line",
      ],
      lines,
    });
  }

  // ---- Safety Net ----
  {
    const creditRange: [number, number] = [
      Math.min(...bidPack.lines.map((l) => l.totalCreditHours)),
      Math.max(...bidPack.lines.map((l) => l.totalCreditHours)),
    ];
    const daysOffRange: [number, number] = [
      Math.min(...bidPack.lines.map((l) => l.daysOff)),
      Math.max(...bidPack.lines.map((l) => l.daysOff)),
    ];
    const score = (p: LineProfile) => safetyNetScore(p, creditRange, daysOffRange);
    const candidates = [...profiles].sort((a, b) => score(b) - score(a)).slice(0, SAFETY_NET_COUNT);

    const lines = candidates.map((p) => {
      const position = rankPosition(profiles, p, score);
      const feasibility = estimateFeasibility(desirabilityPercentile(position, total), seniorityPct);
      return toRecommendation(
        p,
        `${hours(p.line.totalCreditHours)} credit hours and ${p.line.daysOff} days off — strong on both`,
        "No rare pattern to chase here, just a genuinely well-balanced line — the kind that's realistic to actually land.",
        feasibility
      );
    });

    strategies.push({
      id: "safety-net",
      name: "The Safety Net",
      tagline: "The strongest ordinary line in the pack — your guaranteed floor.",
      mechanism:
        "Every list needs entries that don't depend on being rare. These lines score well on both credit and days off without relying on an unusual pattern, so they're far less contested than the plays above — the picks that make sure your bid still lands somewhere good even if none of your reach picks come through.",
      benefits: [
        "Realistic at a much wider range of seniority numbers",
        "Balances pay and time off without betting on a single rare trip",
        "The right anchor for the bottom of your bid list",
      ],
      lines,
    });
  }

  // ---- Re-Bid Chain (process, not line-specific) ----
  strategies.push({
    id: "re-bid-chain",
    name: "The Re-Bid Chain",
    tagline: "Your seniority wins more than once if you use every round of the process.",
    mechanism:
      "Most seniority-ordered bid systems don't stop at the first award — a conflict-resolution pass, a view/add window, and an open-time or secondary-line release each follow, and every one of them is still processed in seniority order. Treat your primary bid as a placeholder, not your final answer: by the time the later windows open, you can see exactly what got shaken loose by conflicts above and below you, and your seniority wins there exactly as it did the first time.",
    benefits: [
      "A second, third, and fourth chance at the exact same pool, with better information each time",
      "No downside to ranking your true favorite first — seniority bidding never penalizes aiming high",
      "Catches lines that only became available because someone senior to you had a conflict",
    ],
    lines: [],
    isProcessTip: true,
  });

  return strategies;
}

/**
 * The generator's headline output: one ordered bid list blending every
 * strategy's best real pick. Order reflects true preference, not odds —
 * seniority bidding never punishes ranking a reach #1, since falling through
 * to the next choice is automatic. The Safety Net entries exist purely to
 * make sure the list doesn't run out before it reaches something realistic.
 */
export function buildAutoBid(strategies: Strategy[]): AutoBidEntry[] {
  const entries: { lineNumber: string; strategyName: string; reason: string; feasibility: FeasibilityTier }[] = [];
  const seen = new Set<string>();

  function addTop(strategy: Strategy, count: number) {
    for (const rec of strategy.lines.slice(0, count)) {
      if (seen.has(rec.lineNumber)) continue;
      seen.add(rec.lineNumber);
      entries.push({
        lineNumber: rec.lineNumber,
        strategyName: strategy.name,
        reason: rec.headline,
        feasibility: rec.feasibility,
      });
    }
  }

  // Each strategy's best pick first (interleaved, since that's the true
  // preference order), then a second reach pick from the two strongest
  // archetypes, then the Safety Net fills out the rest of the list. `addTop`
  // re-slicing from 0 each call is safe: `seen` skips anything already
  // added, so a later, larger count only ever contributes the new tail.
  const byId = Object.fromEntries(strategies.map((s) => [s.id, s]));
  if (byId["ghost-line"]) addTop(byId["ghost-line"], 1);
  if (byId["mega-trip"]) addTop(byId["mega-trip"], 1);
  if (byId["recurring-turn"]) addTop(byId["recurring-turn"], 1);
  if (byId["ghost-line"]) addTop(byId["ghost-line"], 2);
  if (byId["mega-trip"]) addTop(byId["mega-trip"], 2);
  if (byId["safety-net"]) addTop(byId["safety-net"], 3);

  return entries.map((e, i) => ({ rank: i + 1, ...e }));
}
