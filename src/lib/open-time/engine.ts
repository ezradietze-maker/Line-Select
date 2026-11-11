import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { bidTimeline } from "@/lib/bid-timeline";
import { commuteOfTrip, type CommuteAnswers, type CommuteSettings, type TripCommute } from "@/lib/commute-filter";
import { longestDaysOffBlock } from "@/lib/days-off-pattern";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import { banksFor, checkAssignedAs, checkContingency, checkDeadline, checkDrop, checkFrozen, checkPriority, checkRDays, checkRealTime, checkStaffing, checkTradeLimit, isSimilarFootprint, openTimeRules, realTimeTiming, type AssignedAs, type BankOption, type Banks, type OpenTimeRules, type RuleFinding, type RuleLevel, type TripTimes } from "@/lib/open-time/rules";
import type { OpenTimeRow, OpenTimeSnapshot, UnreadRow } from "@/lib/open-time/source";
import { carriedDaysOf, flyLine, lineAsFlown, reservePeriodSpan, zoneOf, type CarryInItem, type PhaseInElections, type Span } from "@/lib/phase-in";
import { flyVacationsOnLine } from "@/lib/vacation-lines";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import { scoreTripsV2, tripValueText, type TripCriterionResult, type TripScore } from "@/lib/scoring-v2/trip-score";
import { dayTripsOf, tripReleaseHours, tripReportUtc } from "@/lib/trip-anchor";
import { busyFromCarry, fitCheck, lineWithAdded, pairingDate, pastedMatches, scheduleAsFlown, tripKey } from "@/lib/view-add";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Open time, read for one pilot: every row of a snapshot matched to its trip in the pack, checked against the pilot's line
 * and the contract, and scored on their own model. It reads an `OpenTimeSnapshot`, so a new source changes nothing here.
 *
 * The score. `fit` starts from the trip's own score on the pilot's line scale (`scoreTripsV2`), then moves by what the trip
 * does to their month compared with the other trips they could take: the line's score with this trip, less the same for
 * the median trip. Any added trip costs days off, so the median is the baseline, and a trip only loses points for costing
 * more than the alternatives do. Both are in points on the same scale, and both are the pilot's own weights; nothing here
 * adds a judgment of its own.
 *
 * A pilot with no model gets no number at all, rather than a made-up one.
 */

const HOUR = 3_600_000;
/** How far a row's printed hours can sit from the pack's and still be the same figure: one decimal place, rounded (28.75 printed as 28.8). */
const ROUNDING_HOURS = 0.1;
/** Pulls smaller than this (score points) aren't worth naming. */
const NOTABLE = 0.5;
/** A paste this long is more than a screen of open time. The rest is said to be left off, not silently dropped. */
export const MAX_ROWS = 400;

export type GiveUpAs = "trade" | "drop";

export interface GiveUp {
  /** `tripKey` of a trip on the pilot's line. */
  key: string;
  as: GiveUpAs;
  /** How they hold it: CBA 2026 25.L.1.h turns on this, and the pack can't say. */
  assignedAs: AssignedAs;
}

export interface OpenTimeSituation {
  pack: BidPack;
  /** The line awarded, as printed. Null: nothing can be checked against a schedule, and the board says so. */
  line: Line | null;
  carryIn: CarryInItem[];
  elections: PhaseInElections;
  vacations?: VacationPeriod[];
  model?: PilotModel | null;
  banks: Banks;
  giveUp?: GiveUp | null;
  /** What this bid period's trades have already added to the published BLG (CBA 2026 25.L.8.a). */
  tradedSoFarCH?: number;
  flights?: FlightAnswers;
  commute?: { settings: CommuteSettings; answers: CommuteAnswers } | null;
  now: number;
}

export type Verdict = "open" | "check" | "late" | "no";

export interface OpenTrip {
  key: string;
  row: OpenTimeRow;
  trip: Trip;
  /** The date on the pairing pages: GMT of its first departure. */
  date: string | null;
  /** The worst of `findings`. */
  verdict: Verdict;
  findings: RuleFinding[];
  banks: BankOption[];
  /** The pilot's fit, 0–100. Null with no model to score on. */
  fit: number | null;
  /** The trip's own score, before what it does to the month. */
  tripScore: number | null;
  /** Points the month moves compared with the median open trip. Null when there's no line to add it to. */
  monthEffect: number | null;
  /** Why, in the pilot's terms: what fits, then what doesn't. */
  reasons: string[];
  commute: TripCommute | null;
  daysOffAfter: number | null;
}

export interface OpenTimeBoard {
  /** Best fit first, what can't be taken last. */
  trips: OpenTrip[];
  /** Rows read, but with no such trip on that date in this pack: not scored or checked. */
  notInPack: UnreadRow[];
  /** Rows that couldn't be read, or whose number the pack couldn't settle. */
  unread: UnreadRow[];
  headings: string[];
  /** Already on the pilot's line, so not a pick-up. */
  onLine: OpenTimeRow[];
  rowsLeftOff: number;
  rules: OpenTimeRules;
  scheduleChecked: boolean;
  scored: boolean;
  /** This pack's trips have no dates, so no row can be matched. */
  noDates: boolean;
}

const dateOf = (r: OpenTimeRow) => `${r.month}/${r.day}`;

/** A pack trip for a row: the one trip number that flies on that date, or why there isn't one. */
function matchRow(row: OpenTimeRow, universe: Map<string, Trip[]>, pack: BidPack): { trip: Trip; findings: RuleFinding[] } | { unread: string } | { notInPack: string } {
  const found = row.tripNumbers.flatMap((n) => {
    const matches = pastedMatches({ tripNumber: n, month: row.month, day: row.day, year: row.year }, universe.get(n) ?? [], pack);
    return matches.length ? [{ n, matches }] : [];
  });
  if (found.length > 1) return { unread: `Both ${found.map((f) => f.n).join(" and ")} are trips on ${dateOf(row)}, so we can't tell which it means.` };
  if (!found.length) {
    return row.tripNumbers.length > 1
      ? { unread: `We couldn't tell which number is the trip: none of ${row.tripNumbers.join(", ")} flies on ${dateOf(row)} in this pack.` }
      : { notInPack: `No trip ${row.tripNumbers[0]} on or next to ${dateOf(row)} in this pack. It may be new or revised since the pack came out.` };
  }
  const { matches } = found[0];
  const findings: RuleFinding[] = [];
  // Which date VIPS prints isn't known (question 28 for the ex-pilot), and it matters when a pairing flies on neighbouring days.
  if (matches.length > 1) {
    findings.push({ section: "open-time-date", level: "check", text: `The same trip also flies a day away. We took the one the pairing pages date ${dateOf(row)}: check its date against VIPS, because the schedule check depends on it.` });
  } else if (matches[0].gap > 0) {
    findings.push({ section: "open-time-date", level: "check", text: `The pack has this trip a day from ${dateOf(row)}. We took that to be the same trip: check it against VIPS.` });
  }
  return { trip: matches[0].trip, findings };
}

/** A row that prints something the pack doesn't: the trip may have been revised since the pack came out. */
function revisionFindings(row: OpenTimeRow, trip: Trip): RuleFinding[] {
  const differs: string[] = [];
  if (row.creditHours !== undefined && Math.abs(row.creditHours - trip.creditHours) > ROUNDING_HOURS) differs.push(`${row.creditHours.toFixed(1)} CH here, ${trip.creditHours.toFixed(1)} CH in the pack`);
  if (row.tafbHours !== undefined && Math.abs(row.tafbHours - trip.tafbHours) > ROUNDING_HOURS) differs.push(`${row.tafbHours.toFixed(1)} TAFB here, ${trip.tafbHours.toFixed(1)} in the pack`);
  // A printed report in another zone would differ too, which is why this only flags.
  const report = trip.schedule[0]?.reportTimeLocal;
  if (row.reportTime && report && row.reportTime !== report) differs.push(`report ${row.reportTime} here, ${report} in the pack`);
  return differs.length ? [{ section: "open-time-revised", level: "check", text: `Your list and the pack disagree (${differs.join("; ")}). It may have been revised: we score the pack's version.` }] : [];
}

const LEVEL_ORDER: RuleLevel[] = ["no", "late", "check", "note"];

function verdictOf(findings: RuleFinding[]): Verdict {
  if (findings.some((f) => f.level === "no")) return "no";
  if (findings.some((f) => f.level === "late")) return "late";
  return findings.some((f) => f.level === "check") ? "check" : "open";
}

function timesOf(trip: Trip, pack: BidPack): (Span & TripTimes) | null {
  const show = tripReportUtc(pack, trip);
  return show === null ? null : { show, tafbHours: trip.tafbHours, start: show, end: show + tripReleaseHours(trip) * HOUR };
}

/** The line without a trip given up, or as it is. */
function lineGivingUp(line: Line, given: Trip | null, pack: BidPack): Line {
  if (!given) return line;
  const spans = new Map<Trip, Span>();
  for (const t of line.trips) {
    const times = timesOf(t, pack);
    if (times) spans.set(t, { start: times.start, end: times.end });
  }
  return lineAsFlown(line, pack, [given], spans, new Set());
}

/** The pack's own open time release for this seat, when it prints one: CBA 2026 25.G.2.a says "Each bid period package will indicate when open time will be released." */
export function openTimePublishedAt(pack: BidPack): number | null {
  // As the bid timeline reads it: real covers print "OT Release CAP 2000 LBT F/O 2200 LBT", naming neither the month
  // nor "Open Time", and each seat its own time.
  const event = bidTimeline(pack).find((e) => e.kind === "open-time" && e.source === "pack" && e.bidMonth === pack.month);
  return event ? Date.parse(event.at) : null;
}

/** The findings on one trip for this pilot's schedule, banks and any trip they'd give up. */
function ruleFindings(trip: Trip, row: OpenTimeRow, s: OpenTimeSituation, rules: OpenTimeRules, flownLine: Line | null, given: Trip | null, options: BankOption[]): RuleFinding[] {
  const { pack, carryIn, vacations = [], giveUp, now } = s;
  const zone = zoneOf(pack);
  const findings: RuleFinding[] = [...checkFrozen(row.frozen)];
  const times = timesOf(trip, pack);
  const givenTimes = given ? timesOf(given, pack) : null;
  const creditHours = row.creditHours ?? trip.creditHours;

  // CBA 2026 25.L.1.d, every bid period: "A bid line adjustment is prohibited if it would create a conflict with another scheduled activity (e.g., trip, R-day, training) or if the pilot making such would not be legal to operate another scheduled activity as a result of the bid line adjustment."
  if (flownLine) {
    const kept = lineGivingUp(flownLine, given, pack);
    const fit = fitCheck(trip, scheduleAsFlown(kept, carryIn, pack), vacations, pack);
    for (const text of fit.illegal) findings.push({ section: "25.L.1.d", level: "no", text });
    for (const text of fit.check) {
      // CBA 2026 12.D.1.d.iii: "A pilot is deemed to have waived any conflict with the international buffer resulting from a bid line adjustment". 12.C.1.c: "It shall not be a violation of this rule if a pilot would have received the relief from duty ... but for a bid line adjustment". Every bid period.
      findings.push(fit.excusedByAdjustment.includes(text) ? { section: "12.D.1.d.iii", level: "note", text: `${text} A bid line adjustment excuses this.` } : { section: "25.L.1.d", level: "check", text });
    }
    if (times) {
      for (const c of carryIn) {
        if (c.kind !== "rdays") continue;
        const block = busyFromCarry(c, zone);
        if (block) findings.push(...checkRDays(times, { start: reservePeriodSpan(c.firstDay, c.rp, zone).start, end: block.span.end }, c.label));
      }
    }
  }

  if (times) {
    // "the first affected activity": whichever of the two trips comes first when one is given up.
    findings.push(...checkDeadline(givenTimes ? Math.min(times.show, givenTimes.show) : times.show, now, zone));
  }

  if (giveUp && given) {
    findings.push(...checkAssignedAs(giveUp.assignedAs, rules));
    if (giveUp.as === "trade") {
      findings.push(...checkTradeLimit(creditHours, given.creditHours, s.tradedSoFarCH ?? 0, rules));
      if (times && givenTimes) findings.push(checkStaffing(isSimilarFootprint(times, givenTimes, now, zone)));
      // CBA 2026 25.L.3.b bars a "drop". Whether trading away a trip on those days counts isn't in the text: a question for the ex-pilot.
      if (givenTimes && checkDrop(givenTimes, zone).length) findings.push({ section: "25.L.3.b", level: "check", text: "The trip you'd give up is on a holiday. The contract bars dropping it; it doesn't say whether that stops a trade (CBA 2026 25.L.3.b)." });
    } else {
      if (givenTimes) findings.push(...checkDrop(givenTimes, zone));
      findings.push(...checkContingency(creditHours, options));
    }
  } else if (Object.values(s.banks).some((h) => (h ?? 0) > 0)) {
    // CBA 2026 25.L.4.d, 25.L.5.c, 25.L.6.e: every bank it's tried against, each on its own (25.L.6.d).
    const usable = options.filter((o) => o.eligible);
    if (!usable.length) {
      // The bank that comes closest says the most: the others are further off.
      const closest = options.reduce<BankOption | null>((best, o) => (!best || o.hours > best.hours ? o : best), null);
      findings.push({ section: closest?.section ?? "25.L.6.e", level: "no", text: closest?.notes[0] ?? `${creditHours.toFixed(1)} CH doesn't fit a bank you entered.` });
    }
    if (usable.length && times && (usable[0].code === "PMU" || usable[0].code === "PNP")) findings.push(checkPriority(usable[0].code, times.show, now, zone));
  }

  if (times) {
    const usingPMU = !giveUp && options.some((o) => o.code === "PMU" && o.eligible);
    findings.push(...checkRealTime(realTimeTiming(now, zone, rules, { publishedAt: openTimePublishedAt(pack), appearedAt: row.appearedAt, usingPMU }), zone));
  }
  return findings;
}

const named = (r: TripCriterionResult) => {
  const v = tripValueText(r);
  return v && v !== "yes" && v !== "no" ? v : r.label;
};

function scoreReasons(score: TripScore | undefined): string[] {
  if (!score) return [];
  if (score.violations.length) return [`Goes past your limit: ${score.violations.map((v) => v.label).join(", ")}`];
  const ups = score.results.filter((r) => r.contribution >= NOTABLE).sort((a, b) => b.contribution - a.contribution).slice(0, 2);
  const down = score.results.filter((r) => r.contribution <= -NOTABLE).sort((a, b) => a.contribution - b.contribution)[0];
  return [...ups.map(named), ...(down ? [`but ${named(down)}`] : [])];
}

function daysOffReasons(before: Line, after: Line): string[] {
  const was = longestDaysOffBlock(before);
  const now = longestDaysOffBlock(after);
  const lost = before.daysOff - after.daysOff;
  if (was === null || now === null) return lost > 0 ? [`costs ${lost} day${lost === 1 ? "" : "s"} off`] : [];
  if (now >= was) return [`keeps your ${was} day${was === 1 ? "" : "s"} off in a row`];
  return [`cuts your ${was} days off in a row to ${now}`];
}

function commuteReasons(c: TripCommute | null, settings: CommuteSettings | undefined): string[] {
  if (!c || !settings) return [];
  const zone = timezoneForAirport(settings.homeAirport) ?? "UTC";
  const clockAt = (ms: number) => DateTime.fromMillis(ms, { zone }).toFormat("HH:mm");
  const out: string[] = [];
  if (c.in === "joined") out.push("runs straight on from a trip you already have, so no commute in");
  else if (c.in === "yes" && c.lastDeparture !== null) out.push(`commutable on the ${clockAt(c.lastDeparture)}`);
  else if (c.in === "no") out.push("no flight gets you in that day");
  if (c.home === "joined") out.push("leads straight into your next trip, so no commute home");
  else if (c.home === "yes" && c.firstArrival !== null) out.push(`home by ${clockAt(c.firstArrival)}`);
  else if (c.home === "no") out.push("no flight home that day");
  return out;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Best for this pilot first, what's past its deadline after that, what can't be taken last. Something to check doesn't bury a good trip. */
const VERDICT_RANK: Record<Verdict, number> = { open: 0, check: 0, late: 1, no: 2 };

export function evaluateOpenTime(snapshot: OpenTimeSnapshot, s: OpenTimeSituation): OpenTimeBoard {
  const { pack, line, carryIn, elections, model } = s;
  const rules = openTimeRules(pack.month);
  // The vacation's trips come off the line too (CBA 2026 7.G.1), as View/Add flies it: still on it, they blocked open
  // trips that fit around the vacation.
  const carried = line ? flyLine(line, pack, carryIn, elections) : null;
  const flown = carried
    ? { ...carried, line: flyVacationsOnLine(carried.line, pack, (s.vacations ?? []).map((vacation) => ({ vacation, choice: "use" as const })), carriedDaysOf(pack, carryIn)).line }
    : null;
  const flownLine = flown?.line ?? null;
  const given = s.giveUp && flownLine ? (flownLine.trips.find((t) => tripKey(t) === s.giveUp!.key) ?? null) : null;

  // Open trips, and trips on other pilots' lines: another pilot's drop or conflict puts those in open time.
  const universe = new Map<string, Trip[]>();
  const seen = new Set<string>();
  for (const t of [...(pack.openPairings ?? []), ...pack.lines.flatMap((l) => l.trips)].flatMap(dayTripsOf)) {
    if (!t.pairingNumber || seen.has(tripKey(t))) continue;
    seen.add(tripKey(t));
    universe.set(t.pairingNumber, [...(universe.get(t.pairingNumber) ?? []), t]);
  }

  const onLineKeys = new Set(flownLine?.trips.flatMap(dayTripsOf).map(tripKey) ?? []);
  const unread: UnreadRow[] = [...snapshot.unread];
  const notInPack: UnreadRow[] = [];
  const onLine: OpenTimeRow[] = [];
  const matched = new Map<string, { row: OpenTimeRow; trip: Trip; findings: RuleFinding[] }>();
  for (const row of snapshot.rows.slice(0, MAX_ROWS)) {
    const m = matchRow(row, universe, pack);
    if ("unread" in m) unread.push({ raw: row.raw, why: m.unread });
    else if ("notInPack" in m) notInPack.push({ raw: row.raw, why: m.notInPack });
    else if (onLineKeys.has(tripKey(m.trip))) onLine.push(row);
    else if (!matched.has(tripKey(m.trip))) matched.set(tripKey(m.trip), { row, trip: m.trip, findings: [...m.findings, ...revisionFindings(row, m.trip)] });
  }

  const evaluated = [...matched.values()].map(({ row, trip, findings }) => {
    const options = banksFor(row.creditHours ?? trip.creditHours, s.banks, rules);
    const all = [...findings, ...ruleFindings(trip, row, s, rules, flownLine, given, options)].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
    return { row, trip, key: tripKey(trip), findings: all, options, verdict: verdictOf(all) };
  });

  // The score. See the top of this file.
  const scores = model ? scoreTripsV2(pack, model, { extraTrips: evaluated.map((e) => e.trip), onLineScale: true, ...(s.flights ? { flights: s.flights } : {}) }) : new Map<string, TripScore>();
  const kept = flownLine ? lineGivingUp(flownLine, given, pack) : null;
  const after = new Map<string, Line>();
  const effects = new Map<string, number>();
  if (kept) {
    // A trip that can't fly on this line has no month to judge.
    for (const e of evaluated) if (e.verdict !== "no") after.set(e.key, { ...lineWithAdded(kept, [e.trip], pack), id: `open-time-${e.key}` });
    if (model && after.size) {
      const base = { ...kept, id: "open-time-base" };
      const lineScores = new Map(scorePackV2({ ...pack, lines: [...pack.lines, base, ...after.values()] }, model, s.flights ? { flights: s.flights } : {}).map((l) => [l.lineId, l.uncapped]));
      const from = lineScores.get(base.id) ?? 0;
      const moves = new Map([...after].map(([key, l]) => [key, (lineScores.get(l.id) ?? from) - from]));
      const middle = median([...moves.values()]);
      for (const [key, move] of moves) effects.set(key, move - middle);
    }
  }

  const trips = evaluated.map<OpenTrip>((e) => {
    const score = scores.get(e.key);
    const monthEffect = effects.get(e.key) ?? null;
    const fit = score ? Math.round(Math.min(100, Math.max(0, score.score + (monthEffect ?? 0)))) : null;
    const added = after.get(e.key);
    const commute = s.commute ? commuteOfTrip(pack, e.trip, kept, s.commute.settings, s.commute.answers) : null;
    return {
      key: e.key,
      row: e.row,
      trip: e.trip,
      date: pairingDate(e.trip, pack),
      verdict: e.verdict,
      findings: e.findings,
      banks: e.options,
      fit,
      tripScore: score?.score ?? null,
      monthEffect,
      reasons: [...(kept && added ? daysOffReasons(kept, added) : []), ...(e.verdict === "no" ? [] : commuteReasons(commute, s.commute?.settings)), ...scoreReasons(score)],
      commute,
      daysOffAfter: added?.daysOff ?? null,
    };
  });
  trips.sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || (b.fit ?? -1) - (a.fit ?? -1) || (b.daysOffAfter ?? 0) - (a.daysOffAfter ?? 0) || b.trip.creditHours - a.trip.creditHours);

  return {
    trips,
    notInPack,
    unread,
    headings: snapshot.headings,
    onLine,
    rowsLeftOff: Math.max(0, snapshot.rows.length - MAX_ROWS),
    rules,
    scheduleChecked: !!flownLine,
    scored: !!model && scores.size > 0,
    noDates: !pack.bidPeriodStart,
  };
}
