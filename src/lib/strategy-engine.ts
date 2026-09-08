import type { AwardHistorySummary } from "@/lib/award-history";
import { PHRASES } from "@/lib/preference-summary";
import { computeTripAnalytics } from "@/lib/trip-analytics";
import type { BidPack, Line } from "@/types/bidpack";
import type { LineScore } from "@/lib/scoring";
import type { PreferenceWeights } from "@/types/preferences";
import type {
  AutoBidEntry,
  FeasibilityTier,
  SeniorityInput,
  Strategy,
  StrategyId,
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

/** Below this, even a real award-history lineRate is showing you noise, not signal — see `MIN_SAMPLE_SIZE` in `lib/award-history.ts`, which this mirrors. */
const MIN_NEARBY_FOR_GROUNDING = 3;

export function estimateFeasibility(
  desirabilityPct: number,
  seniorityPct: number,
  awardSummary?: AwardHistorySummary | null
): { tier: FeasibilityTier; note: string; source: "award-history" | "heuristic" } {
  // Real data wins when there's enough of it: `lineRate` is the share of
  // real, self-reported outcomes near this pilot's own seniority percentile
  // for this exact base/aircraft/seat that actually held a regular line
  // (vs. reserve/other) — a real empirical read, not a rarity estimate.
  if (awardSummary && awardSummary.lineRate !== null && awardSummary.nearbyCount >= MIN_NEARBY_FOR_GROUNDING) {
    const pct = Math.round(awardSummary.lineRate * 100);
    if (awardSummary.lineRate >= 0.65) {
      return {
        tier: "strong",
        note: `${pct}% of real, self-reported pilots near your seniority for this base/aircraft/seat held a regular line — grounded in actual reports, not an estimate.`,
        source: "award-history",
      };
    }
    if (awardSummary.lineRate >= 0.3) {
      return {
        tier: "possible",
        note: `${pct}% of real, self-reported pilots near your seniority for this base/aircraft/seat held a regular line — a real but mixed track record, not a guaranteed hold.`,
        source: "award-history",
      };
    }
    return {
      tier: "longshot",
      note: `Only ${pct}% of real, self-reported pilots near your seniority for this base/aircraft/seat actually held a regular line — a genuine reach based on real reports, not just a rarity estimate.`,
      source: "award-history",
    };
  }

  const margin = seniorityPct - desirabilityPct;
  if (margin >= 0) {
    return {
      tier: "strong",
      note: "Your seniority number comfortably clears how rare this pattern is in this pack.",
      source: "heuristic",
    };
  }
  if (margin >= -0.15) {
    return {
      tier: "possible",
      note: "Within real reach at your number — rank it high, but don't build your whole list around it.",
      source: "heuristic",
    };
  }
  return {
    tier: "longshot",
    note: "A genuine reach at your current number this bid period — still worth ranking first if you want it, just don't let it be your only real option.",
    source: "heuristic",
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
  feasibility: { tier: FeasibilityTier; note: string; source: "award-history" | "heuristic" }
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
    feasibilitySource: feasibility.source,
    // Filled in by `attachScoreContext` once a ranking exists — every
    // recommendation starts without one, same as before this field existed.
    scoreContext: null,
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
export function generateStrategies(
  bidPack: BidPack,
  seniority: SeniorityInput,
  awardSummary?: AwardHistorySummary | null
): Strategy[] {
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
      const feasibility = estimateFeasibility(desirabilityPercentile(position, total), seniorityPct, awardSummary);
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
      const feasibility = estimateFeasibility(desirabilityPercentile(position, total), seniorityPct, awardSummary);
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
      const feasibility = estimateFeasibility(desirabilityPercentile(position, total), seniorityPct, awardSummary);
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
      const feasibility = estimateFeasibility(desirabilityPercentile(position, total), seniorityPct, awardSummary);
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

  // ---- Reserve Ladder (only when this pack's own Reserve Lines grid parsed) ----
  if (bidPack.reserveLines && bidPack.reserveLines.length > 0) {
    const counts = { "24hr": 0, a: 0, b: 0, unknown: 0 };
    for (const rl of bidPack.reserveLines) {
      if (rl.reserveType === "24hr") counts["24hr"]++;
      else if (rl.reserveType === "a") counts.a++;
      else if (rl.reserveType === "b") counts.b++;
      else counts.unknown++;
    }

    const typeBreakdown = [
      counts["24hr"] > 0 ? `${counts["24hr"]} run 24-Hour (R) reserve` : null,
      counts.a > 0 ? `${counts.a} run RA` : null,
      counts.b > 0 ? `${counts.b} run RB` : null,
    ].filter((s): s is string => s !== null);
    const unknownNote =
      counts.unknown > 0 ? `, and ${counts.unknown} whose type wasn't clear from the printed grid` : "";

    const rlg = bidPack.info?.rlgHours ?? null;
    const lowLineCredit = bidPack.info?.lowLineCreditHours ?? null;
    const rlgSentence =
      rlg !== null
        ? ` All of them draw the same Reserve Line Guarantee — ${hours(rlg)} hours — no matter which type you hold.`
        : "";

    const benefits = [
      "Identical guaranteed pay across every reserve type on this pack's own numbers",
      "Your pack's own legend calls out R as the only explicitly 24-hour type — RA/RB are named separately, which usually means a narrower call window for the same floor pay (the exact hours aren't printed on the grid itself, so confirm locally)",
    ];
    if (rlg !== null && lowLineCredit !== null && rlg > lowLineCredit) {
      benefits.push(
        `This bid period, that guarantee (${hours(rlg)} hrs) is actually higher than the lowest-paying awarded regular line (${hours(
          lowLineCredit
        )} hrs) — reserve isn't automatically the losing seat this month.`
      );
    }

    strategies.push({
      id: "reserve-ladder",
      name: "The Reserve Ladder",
      tagline: "If you're going to hold reserve, hold the lightest version of it that pays the same.",
      mechanism: `This pack has ${bidPack.reserveLines.length} reserve lines this bid period: ${typeBreakdown.join(
        ", "
      )}${unknownNote}.${rlgSentence} If you end up on reserve at all, there's real reason to prefer whichever of RA/RB is available over 24-Hour R — the guarantee doesn't change, only how much of your day is locked to the phone.`,
      benefits,
      lines: [],
      isProcessTip: true,
    });
  }

  // ---- Vacation Vault (process, not line-specific — deliberately generic; see mechanism) ----
  strategies.push({
    id: "vacation-vault",
    name: "The Vacation Vault",
    tagline: "Bank vacation into one long block and skip the bid fight for that stretch entirely.",
    mechanism:
      "Vacation entitlement usually isn't capped at one week per pick — a pilot with enough accrued balance can bid several consecutive weeks together as one continuous block, sometimes long enough to swallow an entire bid period. A block that overlaps a bid month's boundary means you're drawing vacation pay through it instead of competing for a line at all — no trip to fly, no reserve to sit, nothing to rank. Line Select can't point you at a specific slot here: doing that would mean reading other pilots' names and vacation weeks off your pack's own roster pages, which this app deliberately never parses. Check your own accrued vacation balance and bid the longest continuous stretch you can actually use.",
    benefits: [
      "A guaranteed, paid outcome that doesn't depend on winning anything in the bid",
      "One long block beats several short ones for actually feeling like time off",
      "Timed right, it removes an entire bid period from the competition altogether",
    ],
    lines: [],
    isProcessTip: true,
  });

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

  // ---- Reserve Avoidance (process, pending contract verification) ----
  strategies.push({
    id: "reserve-avoidance",
    name: "Reserve Avoidance",
    tagline: "Bid a wide enough spread that a gap in your primary picks never defaults you onto reserve.",
    mechanism:
      "Distinct from the Reserve Ladder above (which is about what to do once you're already on reserve) — this is about not landing there in the first place. The Re-Bid Chain's own logic already establishes that a seniority-ordered award runs through several rounds, not just one; the exposure to reserve mostly comes from a bid list that's too narrow to survive a conflict in an early round, not from bad luck. Ranking a deliberately wide spread of realistically-feasible lines — not just your top few reaches — means a conflict anywhere above you is far more likely to fall through to something you actually ranked, rather than to nothing at all. Works entirely within FAR Part 117 duty and rest limits — this is about bid-list construction, never about what a line itself is legally allowed to require.",
    benefits: [
      "A conflict in an early round is far less likely to leave you with no ranked line left to fall to",
      "No cost to ranking widely — seniority bidding never penalizes a long list",
      "Turns the Re-Bid Chain's own multi-round logic into a deliberate defensive strategy, not just an opportunistic one",
    ],
    lines: [],
    isProcessTip: true,
    verification: "pending-contract",
  });

  // ---- Trip Trading (process, pending contract verification) ----
  strategies.push({
    id: "trip-trading",
    name: "Trip Trading",
    tagline: "Reconstruct your ideal month after award by trading trips with other pilots.",
    mechanism:
      "No single awarded line usually matches everything a pilot wants — but most seniority-ordered schedules allow real, pilot-to-pilot trip-for-trip trades after award, typically subject to qualification and seniority checks Line Select has no visibility into. Rather than treat your awarded line as final, treat it as a starting point: trading away a trip that doesn't fit for one that does can close much of the gap between what you were awarded and what you actually wanted, without re-entering the bid process at all. This is genuinely more effort than bidding once and waiting — it's the right move mainly for a pilot who said they'd actually put in that work, not a passive default. Trading itself never touches duty or rest limits — every trip involved is already a real, FAR Part 117-compliant pairing on someone's own awarded line.",
    benefits: [
      "Can close the gap between an awarded line and an ideal one without waiting for the next bid period",
      "Works even for a pilot who bid conservatively and got a safe but unexciting line",
      "Every trip involved is already a real, legal pairing — trading it changes who flies it, not what it legally requires",
    ],
    lines: [],
    isProcessTip: true,
    verification: "pending-contract",
  });

  // ---- Grievance / Slide Paperwork (process, pending contract verification) ----
  strategies.push({
    id: "grievance-slide",
    name: "Grievance & Slide Paperwork",
    tagline: "A missed or misapplied entitlement is a real lever most pilots never pull.",
    mechanism:
      "When a specific contractual entitlement is missed or misapplied in an award — a guarantee, a protected day, a bid-process rule not followed correctly — a formal grievance or a schedule-slide request is a real, underused avenue, not a last resort. Line Select has no visibility into any pilot's actual grievance history or the exact contract language that would apply to a specific situation, so this is deliberately general: know that this process exists and is worth using when something genuinely was missed, rather than assuming an award mistake just has to stand. Like everything else here, this is about enforcing what you're actually entitled to — never a route to something outside FAR Part 117 duty/rest limits or outside the contract itself.",
    benefits: [
      "A real process, not a hypothetical one — most contracts specifically provide for this",
      "Worth knowing about even if rarely needed, since the cost of raising a legitimate miss is low",
      "The natural fit for a pilot who said they'd actually do the paperwork for a better outcome",
    ],
    lines: [],
    isProcessTip: true,
    verification: "pending-contract",
  });

  return strategies;
}

/**
 * The generator's headline output: one ordered bid list blending every
 * strategy's best real pick. Order reflects true preference, not odds —
 * seniority bidding never punishes ranking a reach #1, since falling through
 * to the next choice is automatic. The Safety Net entries exist purely to
 * make sure the list doesn't run out before it reaches something realistic,
 * so it always contributes its picks last regardless of where it sorts.
 *
 * `strategies` should already be in the order the pilot would want them
 * considered — pass the output of `rankStrategiesByPreference` when a
 * profile exists, so the two strategies that best match the pilot's own
 * interview are the ones that get a second reach pick, not always
 * Ghost Line/One-And-Done by default.
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

  const lineStrategies = strategies.filter((s) => !s.isProcessTip && s.id !== "safety-net");
  const safetyNet = strategies.find((s) => s.id === "safety-net");

  // Each strategy's best pick first, in whatever order they were given
  // (the true preference order), then a second reach pick from whichever
  // two strategies rank highest, then the Safety Net fills out the rest.
  // `addTop` re-slicing from 0 each call is safe: `seen` skips anything
  // already added, so a later, larger count only ever adds the new tail.
  for (const s of lineStrategies) addTop(s, 1);
  for (const s of lineStrategies.slice(0, 2)) addTop(s, 2);
  if (safetyNet) addTop(safetyNet, 3);

  return entries.map((e, i) => ({ rank: i + 1, ...e }));
}

/** Which preference dimensions a strategy lives or dies on, and which direction favors it — high weight (wants more of it) or low/negative weight (wants less/the opposite). Strategies absent here (the process tips) aren't preference-ranked at all. */
const FIT_FACTORS: Partial<Record<StrategyId, { key: keyof PreferenceWeights; favorsHigh: boolean }[]>> = {
  "ghost-line": [
    { key: "creditHours", favorsHigh: true },
    { key: "deadheadTolerance", favorsHigh: true },
    { key: "riskTolerance", favorsHigh: true },
  ],
  "mega-trip": [
    { key: "tripLength", favorsHigh: true },
    { key: "daysOff", favorsHigh: true },
    { key: "riskTolerance", favorsHigh: true },
  ],
  "recurring-turn": [
    { key: "tripLength", favorsHigh: false },
    { key: "riskTolerance", favorsHigh: false },
  ],
  "safety-net": [
    { key: "creditHours", favorsHigh: true },
    { key: "daysOff", favorsHigh: true },
    { key: "riskTolerance", favorsHigh: false },
  ],
  // Reserve Ladder isn't ranked here on purpose — whether it applies to you
  // depends on circumstance (how close you sit to the reserve cutoff), not
  // a stated preference.
  "vacation-vault": [{ key: "daysOff", favorsHigh: true }],
  "re-bid-chain": [{ key: "adminEffortAppetite", favorsHigh: true }],
  "reserve-avoidance": [{ key: "adminEffortAppetite", favorsHigh: true }],
  "trip-trading": [
    { key: "adminEffortAppetite", favorsHigh: true },
    { key: "riskTolerance", favorsHigh: true },
  ],
  "grievance-slide": [{ key: "adminEffortAppetite", favorsHigh: true }],
};

/** Below this magnitude a slider reads as "no strong opinion" — same bar preference-summary.ts uses before it's worth naming in a sentence. */
const MEANINGFUL_WEIGHT = 12;

function scorePreferenceFit(
  id: StrategyId,
  weights: PreferenceWeights
): { score: number; reasons: string[] } | null {
  const factors = FIT_FACTORS[id];
  if (!factors) return null;

  let total = 0;
  const reasons: string[] = [];
  for (const factor of factors) {
    const raw = weights[factor.key];
    total += factor.favorsHigh ? raw : -raw;
    if (Math.abs(raw) >= MEANINGFUL_WEIGHT) {
      reasons.push(raw >= 0 ? PHRASES[factor.key].positive : PHRASES[factor.key].negative);
    }
  }
  return { score: total / factors.length, reasons };
}

/**
 * Reorders strategies by how well each matches the pilot's own interview
 * answers, using the exact same weights that already drive their line
 * rankings — not a separate guess. Process-tip strategies (no line content
 * to prefer or not) always sort to the end, in their original order. Without
 * a profile yet, the input order is left alone — there's nothing to rank
 * against.
 */
export function rankStrategiesByPreference(
  strategies: Strategy[],
  weights: PreferenceWeights | null
): Strategy[] {
  if (!weights) return strategies;

  const scored = strategies.map((s) => ({ strategy: s, fit: scorePreferenceFit(s.id, weights) }));
  const ranked = scored
    .filter((x): x is { strategy: Strategy; fit: NonNullable<typeof x.fit> } => x.fit !== null)
    .sort((a, b) => b.fit.score - a.fit.score)
    .map((x) => ({ ...x.strategy, preferenceMatch: x.fit.reasons }));
  const unranked = scored.filter((x) => x.fit === null).map((x) => x.strategy);

  return [...ranked, ...unranked];
}

/**
 * Ties a strategy's recommended lines back to this pilot's own real
 * Satisfaction Index — not a hypothetical "if you applied this strategy"
 * transformation (a strategy here always points at an existing, already-
 * scored line, it doesn't modify one), but that line's own real score
 * compared to the pilot's current top pick. Null (not a strategy touched at
 * all) when `lineScores` is empty/absent — a pilot who hasn't interviewed
 * yet sees strategies exactly as they did before this existed.
 */
export function attachScoreContext(strategies: Strategy[], lineScores: LineScore[] | null | undefined): Strategy[] {
  if (!lineScores || lineScores.length === 0) return strategies;
  const topScore = Math.max(...lineScores.map((r) => r.score));
  const scoreByLineNumber = new Map(lineScores.map((r) => [r.line.lineNumber, r.score]));

  return strategies.map((s) => ({
    ...s,
    lines: s.lines.map((rec) => {
      const score = scoreByLineNumber.get(rec.lineNumber);
      if (score === undefined) return rec;
      return {
        ...rec,
        scoreContext: { score, deltaFromTopPick: Math.round((score - topScore) * 10) / 10 },
      };
    }),
  }));
}
