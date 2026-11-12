import { DateTime } from "luxon";
import type { BidClose } from "@/lib/bid-calendar";
import type { BidForecast } from "@/lib/forecast/forecast";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import type { PhaseInElections } from "@/lib/phase-in";
import type { RankedReserveLine } from "@/lib/reserve-rank";
import type { LineScore } from "@/lib/scoring";
import { computeStanding, type Band } from "@/lib/strategy-engine";
import { ANY_LINE_CODES, type AnyLineKind, type VipsBidAnswers, type VipsBidDraft } from "@/lib/vips-bid";
import type { BidPack, Line } from "@/types/bidpack";
import type { SeniorityInput } from "@/types/strategy";

/**
 * What to look at before a bid goes to VIPS, from what only this pilot's own numbers can say: their place on the
 * pack's seniority list, how likely each line on their list is to survive to their turn, and their own dealbreakers.
 * Pure; the dialog shows the results above its send button.
 *
 * Nothing here stops a pilot sending. A "stop" asks them to say they mean it, and a pilot can always know better than
 * the pack (a late-published bid, a list that's changed).
 */

export type CheckLevel = "stop" | "warn" | "info";

export type CheckFix =
  | { kind: "catch-all"; label: string; anyLines: AnyLineKind[]; reserveLines: string[] }
  | { kind: "link"; label: string; href: string };

export interface PresendCheck {
  id: string;
  level: CheckLevel;
  message: string;
  fix?: CheckFix;
}

export interface PresendInput {
  bidPack: BidPack;
  /** The regular lines being bid, best first — no catch-alls or reserve lines. */
  lineNumbers: string[];
  /** Lines in the pack this order leaves out. */
  leftOut: number;
  /** Scored lines being bid, for the dealbreakers on them. Empty when the pilot has no model. */
  lineScores: LineScore[];
  seniority: SeniorityInput | null;
  /** The forecast of this order; null without a seniority number on a pack with a list. */
  forecast: BidForecast | null;
  /** The pilot's own reserve lines, best first. */
  reserveLines: RankedReserveLine[];
  anyLines: AnyLineKind[];
  /** Whether their reserve lines are already in the bid. */
  reserveLinesAdded: boolean;
  close: BidClose | null;
  now: Date;
  /** The answers so far, and what the rankings were scored with when the pilot has a carry-in. */
  answers?: VipsBidDraft;
  carryInElections?: PhaseInElections | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Under this chance of running out, it's worth saying only as a note. */
const RUN_OUT_WARN = 0.05;
/** At this chance it's no longer a risk but what to expect. */
const RUN_OUT_LIKELY = 0.95;
const TOP_FOR_SANITY = 10;

// ---------------------------------------------------------------- could you run out?

/** Lines on the pilot's list expected to be gone at their turn. */
export function expectedGone(forecast: BidForecast, bidPack: BidPack, lineNumbers: string[]): number {
  const byNumber = new Map(bidPack.lines.map((l) => [l.lineNumber, l.id]));
  return lineNumbers.reduce((sum, n) => {
    const f = forecast.lines[byNumber.get(n) ?? ""];
    return sum + (f ? 1 - f.pAvailable : 0);
  }, 0);
}

function runOutCheck({ bidPack, lineNumbers, leftOut, forecast, anyLines, seniority }: PresendInput): PresendCheck | null {
  const covered = anyLines.length > 0;
  // CBA 2026 25.C.2–3 (unchanged from 2015; every bid period): too few choices falls to the standing bid, then to the
  // lowest-numbered line left after everyone who bid.
  const fallback = "If your choices run out, FedEx uses your standing bid, then the lowest-numbered line left (CBA 25.C.2–3).";
  if (!bidPack.seniorityList?.length) {
    return { id: "run-out", level: "info", message: `This pack has no seniority list we could read, so we can't say how far down your ${plural(lineNumbers.length, "choice")} will go. ${fallback}` };
  }
  if (!forecast) {
    return {
      id: "run-out",
      level: "info",
      message: seniority
        ? `Add your exact seniority number to see how many of your ${plural(lineNumbers.length, "choice")} are likely to be left at your turn.`
        : `Add your seniority number to see how many of your ${plural(lineNumbers.length, "choice")} are likely to be left at your turn.`,
      fix: { kind: "link", label: "Add it on Preferences", href: "/preferences" },
    };
  }
  const gone = Math.round(expectedGone(forecast, bidPack, lineNumbers));
  const none = forecast.pNoRegularLine;
  const ahead = `${plural(forecast.pilotsAhead, "pilot")} ${forecast.pilotsAhead === 1 ? "bids" : "bid"} before you.`;
  const odds = gone >= lineNumbers.length ? `All ${plural(lineNumbers.length, "line")} on your list will likely be gone.` : `About ${gone} of your ${plural(lineNumbers.length, "line")} will likely be gone.`;
  if (none >= RUN_OUT_WARN) {
    const chance = none >= RUN_OUT_LIKELY ? "Expect none to be left." : `There's about a ${pct(none)} chance none are left.`;
    const advice = leftOut > 0 ? "Add more lines, or end with a catch-all." : "End with a catch-all.";
    return {
      id: "run-out",
      level: covered ? "info" : "warn",
      message: `${ahead} ${odds} ${chance} ${covered ? "Your catch-all covers that." : `${advice} ${fallback}`}`,
    };
  }
  return { id: "run-out", level: "info", message: `${ahead} ${odds} You're very unlikely to run out (${none < 0.01 ? "under 1%" : pct(none)}).` };
}

// ---------------------------------------------------------------- catch-alls and reserve lines

/** The band the pilot's place puts them in, when there's a place to read. */
function bandOf(bidPack: BidPack, seniority: SeniorityInput | null): Band | null {
  return seniority ? computeStanding(bidPack, seniority).band : null;
}

/**
 * What to tick after the pilot's own list. "Any regular line" only adds something when the list leaves regular lines
 * out, and it stays optional in the message: a leftover line isn't one every pilot would rather have than a secondary
 * line. VIPS reads these in order; the dialog keeps regular, then secondary, then any named reserve lines, then reserve.
 */
export function recommendedCatchAlls(leftOut: number): AnyLineKind[] {
  return leftOut > 0 ? ["regular", "secondary", "reserve"] : ["secondary", "reserve"];
}

function catchAllCheck(input: PresendInput): PresendCheck | null {
  const { bidPack, leftOut, seniority, forecast, reserveLines, anyLines, reserveLinesAdded } = input;
  const band = bandOf(bidPack, seniority);
  const wanted = recommendedCatchAlls(leftOut);
  const none = forecast?.pNoRegularLine ?? null;
  // Reserve lines matter to a pilot who may really land there, not one who holds a regular line by a wide margin.
  const reserveMatters = reserveLines.length > 0 && (band === "reserve" || band === "secondary" || (none ?? 1) >= RUN_OUT_WARN);
  const names = reserveMatters ? reserveLines.map((l) => l.lineNumber) : [];
  const done = wanted.every((k) => anyLines.includes(k)) && (!names.length || reserveLinesAdded);
  if (done) return null;

  const codes = wanted.map((k) => ANY_LINE_CODES[k]).join(", then ");
  const lead =
    band === "reserve"
      ? "Your place on the list lands on a reserve line, so what you bid after your list decides your month."
      : band === "secondary"
        ? none !== null && none < 0.5
          ? // Just past the cutoff, the forecast still has pilots ahead passing on a regular line: said "on a secondary line"
            // beside "very unlikely to run out", the two read as opposite answers.
            "Your place on the list is just past the regular lines, so a few pilots ahead of you passing on one decides whether you hold one or a secondary line."
          : "Your place on the list lands past the regular lines, on a secondary line."
        : band === "regular"
          ? "Your place on the list holds a regular line. A catch-all is there in case pilots ahead of you bid differently than expected."
          : "Without your place on the list, the safe ending covers every case.";
  const reserve = names.length ? ` Named reserve lines go before 9954, in your order: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}.` : "";
  // Lines left off the list on purpose (ranked under reserve, say, because they pay less than it) come back with 9950.
  const skipRegular = wanted.includes("regular") ? " Leave out 9950 if you'd rather have a secondary line or reserve than a line you've left off your list." : "";
  return {
    id: "catch-all",
    level: band === "reserve" || band === "secondary" ? "warn" : "info",
    message: `${lead} End with ${codes}.${reserve}${skipRegular}`,
    fix: { kind: "catch-all", label: names.length ? "Use this ending" : "Use these", anyLines: wanted, reserveLines: names },
  };
}

// ---------------------------------------------------------------- legality

/** CBA 2026 25.D.1.b–e, by weeks in the bid period (every bid period; these limits build the published regular lines). */
const LINE_LIMITS: Record<number, { tafb: number; workDays: number; threes: number }> = {
  28: { tafb: 313, workDays: 15, threes: 1 },
  35: { tafb: 390, workDays: 19, threes: 2 },
  42: { tafb: 470, workDays: 23, threes: 3 },
};

/** Runs of days off in the line's period, from its trips' placed days. Null when the line's trips aren't placed on real days. */
function offBlocks(line: Line, periodDays: number): number[] | null {
  if (line.estimated) return null;
  const worked = new Set<number>();
  for (const t of line.trips) {
    if (t.startDayIndex === null || t.startDayIndex === undefined) return null;
    for (let d = 0; d < t.days; d++) worked.add(t.startDayIndex + d);
  }
  const blocks: number[] = [];
  let run = 0;
  for (let d = 0; d < periodDays; d++) {
    if (worked.has(d)) {
      if (run) blocks.push(run);
      run = 0;
    } else run++;
  }
  if (run) blocks.push(run);
  return blocks;
}

/**
 * 25.D.1.c–e: at least one block of 4 days off, N blocks of 3 and one of 2; "Blocks of days off may be combined", so a
 * long block can hold several. Longest-first filling: the requirement is met when every required block fits somewhere.
 */
export function meetsDaysOffBlocks(blocks: number[], threes: number): boolean {
  const room = [...blocks].sort((a, b) => b - a);
  for (const need of [4, ...Array.from({ length: threes }, () => 3), 2]) {
    room.sort((a, b) => b - a);
    if (!room.length || room[0] < need) return false;
    room[0] -= need;
  }
  return true;
}

/**
 * Published lines are built to these limits, so one failing means the pack was misread or isn't a normal one — worth a
 * look at the PDF, not a legality verdict. The contract text holds no monthly block-hour cap and no number for
 * "minimum days off" (25.F.7 uses the term without defining it), so neither is checked; both wait on the ex-pilot.
 * Protection after a carry-in is `recommendVipsAnswers`'s to weigh (`phase-in.ts`).
 */
function constructionCheck({ bidPack, lineNumbers }: PresendInput): PresendCheck | null {
  const limits = LINE_LIMITS[bidPack.bidPeriodDays];
  if (!limits) return null;
  const inOrder = new Set(lineNumbers);
  const odd: string[] = [];
  for (const line of bidPack.lines) {
    if (!inOrder.has(line.lineNumber)) continue;
    const workDays = bidPack.bidPeriodDays - line.daysOff;
    const blocks = offBlocks(line, bidPack.bidPeriodDays);
    if (line.totalTafbHours > limits.tafb) odd.push(`line ${line.lineNumber} shows ${Math.round(line.totalTafbHours)} h away (25.D.1.b caps it at ${limits.tafb} h)`);
    else if (workDays > limits.workDays) odd.push(`line ${line.lineNumber} shows ${workDays} work days (25.D.1.b caps it at ${limits.workDays})`);
    else if (blocks && !meetsDaysOffBlocks(blocks, limits.threes)) odd.push(`line ${line.lineNumber} doesn't show the days off in a row 25.D.1 requires`);
  }
  if (!odd.length) return null;
  return {
    id: "construction",
    level: "warn",
    message: `${odd.slice(0, 2).join("; ")}${odd.length > 2 ? `; and ${odd.length - 2} more` : ""}. FedEx builds its lines inside these limits, so check ${odd.length === 1 ? "this one" : "these"} against the PDF: we may have misread the pack.`,
  };
}

// ---------------------------------------------------------------- wrong pack, wrong time

function closeWords(iso: string, now: Date): string {
  const hours = (Date.parse(iso) - now.getTime()) / 3_600_000;
  return hours < 1 ? "in under an hour" : hours < 48 ? `in ${Math.round(hours)} hours` : `in ${Math.round(hours / 24)} days`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** When the pack's bid period starts: its printed date, or the first of its month code when that didn't read. */
function periodStart(bidPack: Pick<BidPack, "bidPeriodStart" | "month">): DateTime | null {
  if (bidPack.bidPeriodStart) return DateTime.fromISO(bidPack.bidPeriodStart, { zone: "utc" });
  const m = bidPack.month.match(/^([A-Z]{3})(\d{2})$/i);
  const month = m ? MONTHS.indexOf(m[1].toUpperCase()) + 1 : 0;
  return m && month ? DateTime.utc(2000 + Number(m[2]), month, 1) : null;
}

function timingChecks({ bidPack, close, now }: PresendInput): PresendCheck[] {
  if (bidPack.id.startsWith("sample-")) {
    return [{ id: "sample-pack", level: "stop", message: "This is the sample pack, not your real bid. These lines don't exist in VIPS." }];
  }
  const start = periodStart(bidPack);
  if (start?.isValid && start.toMillis() <= now.getTime()) {
    return [{ id: "period-started", level: "stop", message: `The ${bidPack.month} bid period has already started, so this pack's bid is over. Upload this month's pack.` }];
  }
  if (close) {
    const when = DateTime.fromISO(close.iso).setZone("America/Chicago").toFormat("LLL d, HHmm 'CT'");
    const whose = close.source === "pilot" ? "the time you set" : close.source === "pack" ? "the pack's bid calendar" : "the contract's close rule (CBA 25.C.4)";
    if (Date.parse(close.iso) <= now.getTime()) {
      return [{ id: "bid-closed", level: "stop", message: `Bidding for ${bidPack.month} closed ${when}, by ${whose}. VIPS may not take this bid.` }];
    }
    if (Date.parse(close.iso) - now.getTime() <= 24 * 3_600_000) {
      return [{ id: "bid-closing", level: "warn", message: `Bidding closes ${closeWords(close.iso, now)}: ${when}, by ${whose}.` }];
    }
    return [];
  }
  return [{ id: "no-close", level: "info", message: `We don't know when bidding for ${bidPack.month} closes. Check the date in VIPS.` }];
}

function seniorityMismatchCheck({ bidPack, seniority }: PresendInput): PresendCheck | null {
  if (seniority?.source !== "between" || !bidPack.seniorityList?.length) return null;
  return {
    id: "not-on-list",
    level: "warn",
    message: `Your seniority number isn't on this pack's list for ${bidPack.base} ${bidPack.aircraft} ${bidPack.seat}. Check this is your domicile, fleet and seat.`,
  };
}

// ---------------------------------------------------------------- order sanity

function orderChecks({ lineScores, leftOut }: PresendInput): PresendCheck[] {
  const out: PresendCheck[] = [];
  const broken = lineScores.slice(0, TOP_FOR_SANITY).filter((s) => s.violatedDealbreakers.length > 0);
  if (broken.length) {
    const first = broken[0];
    const why = first.violatedDealbreakers[0];
    out.push({
      id: "dealbreaker-on-top",
      level: "warn",
      message: `${plural(broken.length, "line")} in your top ${TOP_FOR_SANITY} ${broken.length === 1 ? "breaks" : "break"} something you ruled out: line ${first.line.lineNumber}, ${why.detail ?? why.label}${broken.length > 1 ? `, and ${broken.length - 1} more` : ""}.`,
    });
  }
  if (leftOut > 0) {
    out.push({
      id: "left-out",
      level: "warn",
      message: `${leftOut} ${leftOut === 1 ? "line" : "lines"} in the pack ${leftOut === 1 ? "is" : "are"} left out of this order and won't be bid.`,
    });
  }
  return out;
}

const ELECTION_NAMES: Record<keyof PhaseInElections, string> = {
  waiveBufferPhaseIn: "the international buffer waiver",
  waive1in10: "the 1-in-10 waiver",
  protectMinDays: "minimum days off protection",
};

/** A carry-in's lines are scored as they'd fly under the elections on My Rankings; a different answer here means the order was ranked for a month the bid won't produce. */
function answersDifferCheck({ answers, carryInElections }: PresendInput): PresendCheck | null {
  if (!answers || !carryInElections) return null;
  const differ = (Object.keys(ELECTION_NAMES) as (keyof PhaseInElections)[]).filter((k) => answers[k] !== null && answers[k] !== carryInElections[k]);
  if (!differ.length) return null;
  return {
    id: "answers-differ",
    level: "warn",
    message: `Your rankings assumed a different answer on ${differ.map((k) => ELECTION_NAMES[k]).join(" and ")} than you've given here. What you send here is what counts, so match them on My Rankings to see your lines as they'd really fly.`,
  };
}

const LEVEL_ORDER: Record<CheckLevel, number> = { stop: 0, warn: 1, info: 2 };

/** Every check that has something to say, most serious first. */
export function runPresendChecks(input: PresendInput): PresendCheck[] {
  const checks = [
    ...timingChecks(input),
    seniorityMismatchCheck(input),
    runOutCheck(input),
    catchAllCheck(input),
    answersDifferCheck(input),
    ...orderChecks(input),
    constructionCheck(input),
  ].filter((c): c is PresendCheck => c !== null);
  return checks.map((c, i) => [c, i] as const).sort(([a, i], [b, j]) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || i - j).map(([c]) => c);
}

// ---------------------------------------------------------------- the bid, in the order VIPS reads it

/** The pilot's list, then the catch-alls, with named reserve lines before "any reserve line" so they're reached first. */
export function fullBidOrder(lineNumbers: string[], anyLines: AnyLineKind[], reserveLines: string[]): string[] {
  const named = (kinds: AnyLineKind[]) => kinds.filter((k) => anyLines.includes(k)).map((k) => ANY_LINE_CODES[k]);
  return [...lineNumbers, ...named(["regular", "secondary"]), ...reserveLines, ...named(["reserve"])];
}

// ---------------------------------------------------------------- the VIPS questions, for this order

export interface VipsQuestionNote {
  /** What the question means. */
  meaning: string;
  /** What in this order makes it matter, when something does. */
  forThisOrder?: string;
}

/** A trip that starts this close to the period's start is the one a carry-in from last month could run into. */
const FRONT_OF_MONTH_DAYS = 3;

function linesWithInternationalNearStart(bidPack: BidPack, lineNumbers: string[]): string[] {
  const byNumber = new Map(bidPack.lines.map((l) => [l.lineNumber, l]));
  return lineNumbers.slice(0, TOP_FOR_SANITY).filter((n) =>
    byNumber.get(n)?.trips.some((t) => t.startDayIndex !== null && t.startDayIndex !== undefined && t.startDayIndex < FRONT_OF_MONTH_DAYS && computeTripFacts(t).layovers.some((l) => l.international))
  );
}

/**
 * One line on each of VIPS's questions (CBA 2026 25.E.1.a, c, d; 25.F.7). What to answer depends on the pilot's carry-in,
 * so these explain, and `recommendVipsAnswers` (phase-in.ts) advises when the pilot asks. From
 * the December 2026 bid period, 25.E.1.a makes the days-off waivers "all-in-one", which the dialog already warns of.
 */
export function vipsQuestionNotes(bidPack: BidPack, lineNumbers: string[]): Record<keyof VipsBidAnswers, VipsQuestionNote> {
  const intl = linesWithInternationalNearStart(bidPack, lineNumbers);
  const intlNote = intl.length
    ? `${plural(intl.length, "line")} in your top ${TOP_FOR_SANITY} (${intl.slice(0, 3).join(", ")}) ${intl.length === 1 ? "has" : "have"} an international trip in the first ${FRONT_OF_MONTH_DAYS} days, where a carry-in could run into it.`
    : undefined;
  return {
    waiveBufferRecurrent: {
      meaning: "Only if training is due. Yes lets recurrent training sit closer to an international trip, with less duty-free time between them (CBA 25.E.1.c).",
    },
    waiveBufferPhaseIn: {
      meaning: "Yes gives up the international duty-free buffer so a trip from last month doesn't knock out a new trip. No keeps the rest, and that trip may drop as a conflict (CBA 25.E.1.c).",
      forThisOrder: intlNote,
    },
    waive1in10: {
      meaning: "Yes gives up 1-in-10 (CBA 12.C.1.c) so last month's flying doesn't conflict with a new trip. No keeps it, and that trip may drop as a conflict (CBA 25.E.1.d).",
    },
    protectMinDays: {
      meaning: "Yes lets you drop trips or R-days, with make-up, when carry-in or training would leave you short of minimum days off (CBA 25.E.1.a, 25.F.7).",
    },
  };
}
