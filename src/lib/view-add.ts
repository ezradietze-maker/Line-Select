import { DateTime } from "luxon";
import { splitTrip } from "@/lib/bid-month";
import { longestDaysOffBlock } from "@/lib/days-off-pattern";
import { parseOpenTimePaste } from "@/lib/open-time/parse";
import { carriedDaysOf, dayIndices, flownUnderInternationalRules, flyLine, phaseInRules, reservePeriodSpan, tripSpans, zoneOf, type CarryInItem, type FlownLine, type PhaseInElections, type Span } from "@/lib/phase-in";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import { tripReportUtc } from "@/lib/trip-anchor";
import { flyVacationsOnLine } from "@/lib/vacation-lines";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * The View/Add window: what a pilot owed make-up should bid, in order (CBA 2026 25.E.4). Bids are "only by: (a) Specific
 * trip number (including date); (b) Reserve block label; and/or (c) Base simulator support event label", every bid period,
 * and they're "awarded in seniority order", so the list is a set of first choices and what to fall back on.
 *
 * We never send it. VIPS's make-up form (`webmmu`) needs its field names confirmed by a current pilot first, so the
 * pilot copies the list. Student make-up (SMU) joins View/Add from October 2027 (25.E.4.a.iii, Phase 4) and isn't handled.
 * Questions the text leaves open are in private/ex-pilot/step4-what-we-need-from-you.md.
 */

const HOUR = 3_600_000;
const RELIEF_HOURS = 24;
/** Not in the contract: the most choices other bidding tools' make-up forms send. Unconfirmed until a current pilot sees the form. */
export const MAX_CHOICES = 99;
const MAX_CANDIDATES = 30;
const MAX_COMBO_TRIPS = 4;
/** The search stops here: it tries the pilot's best-looking trips first, and a long list of small trips would otherwise take seconds on a phone. */
const MAX_COMBOS_TRIED = 3000;
/** How many of the best-looking combinations go to the pilot's model. */
const MAX_SCORED_COMBOS = 40;
const BEST_COMBOS = 3;

export interface MakeUpHours {
  /** Phase-in make-up, CIA (CBA 2026 25.E.4.a.i, 25.F.5). */
  cia: number;
  /** Vacation make-up, MUV (CBA 2026 25.E.4.a.ii, 7.G.5). */
  muv: number;
}

/** A piece of the pilot's schedule a candidate has to fit around. */
export interface Busy {
  label: string;
  span: Span;
  /** The duties, when known. */
  duties: Span[];
  dutiesKnown: boolean;
  international: boolean;
  tafbHours: number;
  allDeadheadFirst: boolean;
}

export function busyFromTrip(trip: Trip, pack: BidPack): Busy | null {
  const report = tripReportUtc(pack, trip);
  if (report === null) return null;
  return {
    label: trip.pairingNumber ? `trip ${trip.pairingNumber}` : "a trip",
    span: { start: report, end: report + trip.tafbHours * HOUR },
    duties: tripSpans(trip, report),
    dutiesKnown: trip.schedule.length > 0,
    international: flownUnderInternationalRules(trip),
    tafbHours: trip.tafbHours,
    allDeadheadFirst: !!trip.schedule[0]?.legs.length && trip.schedule[0].legs.every((l) => l.isDeadhead),
  };
}

export function busyFromCarry(item: CarryInItem, zone: string): Busy | null {
  if (item.kind === "trip") {
    const start = Date.parse(item.report);
    const end = Date.parse(item.release);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    const known = (item.duties ?? []).map((d) => ({ start: Date.parse(d.start), end: Date.parse(d.end) }));
    return { label: item.label, span: { start, end }, duties: known.length ? known : [{ start, end }], dutiesKnown: known.length > 0, international: item.international, tafbHours: (end - start) / HOUR, allDeadheadFirst: false };
  }
  const first = reservePeriodSpan(item.firstDay, item.rp, zone);
  const last = reservePeriodSpan(DateTime.fromISO(item.firstDay, { zone }).plus({ days: item.days - 1 }).toISODate()!, item.rp, zone);
  const span = { start: first.start, end: last.end };
  return { label: item.label, span, duties: [span], dutiesKnown: false, international: false, tafbHours: 0, allDeadheadFirst: false };
}

export interface FitCheck {
  /** What rules it out, each naming its section. */
  illegal: string[];
  /** What the text doesn't settle for a make-up trip: it stays on the list, flagged. */
  check: string[];
  /** The part of `check` that an open-time bid line adjustment settles: CBA 2026 12.D.1.d.iii and 12.C.1.c excuse the buffers and 1-in-10 for one. */
  excusedByAdjustment: string[];
}

function hoursText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const m = minutes % 60;
  return m ? `${Math.floor(minutes / 60)}:${String(m).padStart(2, "0")}` : `${Math.floor(minutes / 60)} hours`;
}

/** The longest stretch through this trip without 24 hours off (at base, for 1-in-10), and whether time off inside it can't be seen. */
function stretchThrough(candidate: Busy, others: Busy[], atBase: boolean): { hours: number; unsure: boolean; international: boolean } {
  const pieces = [candidate, ...others]
    .flatMap((b) => (atBase ? [{ start: b.span.start, end: b.span.end, b }] : b.duties.map((d) => ({ ...d, b }))))
    .sort((x, y) => x.start - y.start);
  const relief = RELIEF_HOURS * HOUR;
  let worst = { hours: 0, unsure: false, international: false };
  let i = 0;
  while (i < pieces.length) {
    let j = i;
    let end = pieces[i].end;
    let holdsCandidate = pieces[i].b === candidate;
    let unsure = !pieces[i].b.dutiesKnown;
    let international = pieces[i].b.international;
    while (j + 1 < pieces.length && pieces[j + 1].start - end < relief) {
      j++;
      end = Math.max(end, pieces[j].end);
      holdsCandidate ||= pieces[j].b === candidate;
      unsure ||= !pieces[j].b.dutiesKnown;
      international ||= pieces[j].b.international;
    }
    const hours = (end - pieces[i].start) / HOUR;
    if (holdsCandidate && hours > worst.hours) worst = { hours, unsure, international };
    i = j + 1;
  }
  return worst;
}

/**
 * Whether a trip can go on this schedule. Every bid period but the rest numbers, which `phaseInRules` switches.
 * CBA 2026 7.A.3: no trip in conflict with a vacation. CBA 2026 12.C.6.a, 12.D.7: legal rest. CBA 2026 12.C.1.b, 12.D.1.i: 1-in-7.
 * The buffers (12.D.1.d) and 1-in-10 (12.C.1.c) both excuse a bid line adjustment, and make-up is one (25.L.6). Whether that
 * reaches a View/Add bid is question 27, so they only flag.
 */
export function fitCheck(trip: Trip, schedule: Busy[], vacations: VacationPeriod[], pack: BidPack): FitCheck {
  const candidate = busyFromTrip(trip, pack);
  if (!candidate) return { illegal: ["It isn't on a date in the pack."], check: [], excusedByAdjustment: [] };
  const rules = phaseInRules(pack.month);
  const illegal: string[] = [];
  const check: string[] = [];
  const excusedByAdjustment: string[] = [];
  const excused = (text: string) => {
    check.push(text);
    excusedByAdjustment.push(text);
  };
  for (const v of vacations) {
    if (candidate.span.start < Date.parse(v.to) && candidate.span.end > Date.parse(v.from)) illegal.push("It's during your vacation (CBA 2026 7.A.3).");
  }
  for (const o of schedule) {
    const [first, second] = o.span.start <= candidate.span.start ? [o, candidate] : [candidate, o];
    const gap = second.span.start - first.span.end;
    if (gap < 0) {
      illegal.push(`It overlaps ${o.label}.`);
      continue;
    }
    const international = first.international || second.international;
    const rest = international ? 720 : second.allDeadheadFirst ? rules.domesticDeadheadRestMinutes : rules.domesticRestMinutes;
    if (gap < rest * 60_000) {
      illegal.push(`Only ${hoursText(gap)} from ${o.label}; legal rest is ${hoursText(rest * 60_000)} (CBA 2026 ${international ? "12.D.7" : "12.C.6.a"}).`);
      continue;
    }
    if (first.international && first.tafbHours > 120 && gap < 48 * HOUR) excused(`Inside the 48-hour international buffer after ${first === o ? o.label : "it"} (CBA 2026 12.D.1.d.ii).`);
    if (second.international && second.tafbHours > 120 && gap < 24 * HOUR) excused(`Inside the 24-hour international buffer before ${second === o ? o.label : "it"} (CBA 2026 12.D.1.d.i).`);
  }
  const seven = stretchThrough(candidate, schedule, false);
  if (seven.hours > 144 && !seven.unsure) illegal.push(`It would run ${Math.round(seven.hours / 24)} days without 24 hours off (CBA 2026 12.C.1.b, 12.D.1.i).`);
  else if (seven.hours > 120) check.push(`It would run ${Math.round(seven.hours / 24)} days without 24 hours off; check 1-in-7 (CBA 2026 12.C.1.b, 12.D.1.i).`);
  const ten = stretchThrough(candidate, schedule, true);
  if (!ten.international && ten.hours > 192) excused(`It would run ${Math.round(ten.hours / 24)} days without 24 hours at base; check 1-in-10 (CBA 2026 12.C.1.c).`);
  return { illegal, check, excusedByAdjustment };
}

/** What a new trip has to fit around: the line as it will fly, and what's carried in. */
export function scheduleAsFlown(line: Line, carryIn: CarryInItem[], pack: BidPack): Busy[] {
  const zone = zoneOf(pack);
  return [
    ...line.trips.flatMap((t) => {
      const b = busyFromTrip(t, pack);
      return b ? [b] : [];
    }),
    ...carryIn.flatMap((c) => {
      const b = busyFromCarry(c, zone);
      return b ? [b] : [];
    }),
  ];
}

/** The CBA 2026 25.L.6.e overage: from December 2026 a make-up trip can pass eligibility by no more than 7 CH; before it, 6 CH. Also 7.G.5.a for MUV. */
export function overageCH(packMonth: string): number {
  return phaseInRules(packMonth).makeUpOverageCH;
}

const operatedHours = (t: Trip) => t.schedule.flatMap((d) => d.legs).filter((l) => !l.isDeadhead && !l.isStandby).reduce((a, l) => a + (l.blockHours ?? 0), 0);

/** The line with these trips added, its days off and totals with it. */
export function lineWithAdded(line: Line, added: Trip[], pack: BidPack): Line {
  const trips = [...line.trips, ...added].sort((a, b) => (a.startDayIndex ?? 0) - (b.startDayIndex ?? 0));
  const days = new Set(added.flatMap((t) => {
    const b = busyFromTrip(t, pack);
    return b ? dayIndices(b.span, pack) : [];
  }));
  const off = line.gridOffDays?.filter((d) => !days.has(d));
  const inMonth = added.map((t) => splitTrip(t, pack)?.inMonth ?? t);
  return {
    ...line,
    trips,
    daysOff: off ? off.length : Math.max(0, line.daysOff - days.size),
    ...(off ? { gridOffDays: off } : {}),
    totalCreditHours: line.totalCreditHours + inMonth.reduce((a, t) => a + t.creditHours, 0),
    totalTafbHours: line.totalTafbHours + inMonth.reduce((a, t) => a + t.tafbHours, 0),
    ...(line.totalBlockHours !== undefined ? { totalBlockHours: line.totalBlockHours + inMonth.reduce((a, t) => a + operatedHours(t), 0) } : {}),
    totalLandings: line.totalLandings + added.reduce((a, t) => a + t.landings, 0),
    totalDepartures: line.totalDepartures + added.reduce((a, t) => a + t.departures, 0),
    ...(line.totalDutyPeriods !== undefined ? { totalDutyPeriods: line.totalDutyPeriods + added.reduce((a, t) => a + (t.dutyPeriods ?? 1), 0) } : {}),
  };
}

/** Separate stretches of work on the line: a rough count of trips to work for a commuter. */
export function workStretches(line: Line, bidPeriodDays: number): number | null {
  if (!line.gridOffDays) return null;
  const off = new Set(line.gridOffDays);
  let stretches = 0;
  for (let d = 0; d < bidPeriodDays; d++) if (!off.has(d) && (d === 0 || off.has(d - 1))) stretches++;
  return stretches;
}

export function tripKey(t: Pick<Trip, "id" | "startDayIndex">): string {
  return `${t.id}@${t.startDayIndex}`;
}

/** The date a trip is printed under on the pairing pages: GMT of its first departure, "2026-10-14". */
export function pairingDate(trip: Trip, pack: BidPack): string | null {
  const report = tripReportUtc(pack, trip);
  const leg = trip.schedule[0]?.legs[0];
  if (report === null || !leg) return null;
  return new Date(report + leg.startMinutes * 60_000).toISOString().slice(0, 10);
}

export interface PastedEntry {
  raw: string;
  tripNumber: string;
  /** Month and day, as far as the line says. */
  month: number;
  day: number;
  /** The year, when the line prints one. */
  year?: number;
}

/**
 * The open-time list a pilot pastes from VIPS: lines naming a trip number and a date. The screen's exact format isn't known
 * yet, so `parseOpenTimePaste` reads the common ways of writing them and keeps the pilot's own text for the list. Anything
 * else comes back as not understood; it's never guessed at.
 */
export function parseOpenTimeList(text: string): { entries: PastedEntry[]; notRead: string[] } {
  const { rows, unread } = parseOpenTimePaste(text);
  return {
    entries: rows.map((r) => ({ raw: r.raw, tripNumber: r.tripNumbers[0], month: r.month, day: r.day, ...(r.year ? { year: r.year } : {}) })),
    notRead: unread.map((u) => u.raw),
  };
}

/** How far a pasted date sits from each date of this trip number in the pack, nearest first, within a day: VIPS's date convention isn't known yet. A date with no year takes the one nearest the bid period: a January pack can start in December. */
export function pastedMatches(entry: Pick<PastedEntry, "tripNumber" | "month" | "day" | "year">, universe: Trip[], pack: BidPack): { trip: Trip; gap: number }[] {
  const start = DateTime.fromISO(pack.bidPeriodStart ?? "", { zone: "utc" });
  if (!start.isValid) return [];
  const wanted = (entry.year ? [entry.year] : [start.year - 1, start.year, start.year + 1])
    .map((year) => DateTime.utc(year, entry.month, entry.day))
    .sort((a, b) => Math.abs(a.diff(start).toMillis()) - Math.abs(b.diff(start).toMillis()))[0];
  return universe
    .filter((t) => t.pairingNumber === entry.tripNumber)
    .flatMap((trip) => {
      const date = pairingDate(trip, pack);
      if (!date) return [];
      const gap = Math.abs(DateTime.fromISO(date, { zone: "utc" }).diff(wanted, "days").days);
      return gap <= 1 ? [{ trip, gap }] : [];
    })
    .sort((a, b) => a.gap - b.gap);
}

export interface ViewAddChoice {
  /** Null for a choice the pilot typed: a reserve block or simulator label, kept as typed and unscored. */
  trip: Trip | null;
  /** What to copy: the pilot's own pasted text, or the trip number and date. */
  text: string;
  creditHours: number;
  /** Days off the line would have with only this trip added. */
  daysOffAfter: number;
  /** One line on why it's here. */
  why: string;
  check: string[];
  /** In the best combination. */
  inBest: boolean;
  score: number | null;
}

export interface ViewAddCombo {
  trips: Trip[];
  totalCH: number;
  /** CH of the make-up still not made up. */
  shortCH: number;
  daysOffAfter: number;
  longestOff: number | null;
  workStretches: number | null;
  score: number | null;
}

export interface ViewAddPlan {
  flown: FlownLine;
  /** Make-up the pilot bids for, and how far past it a trip can go (25.L.6.e). */
  targetCH: number;
  overCH: number;
  combos: ViewAddCombo[];
  choices: ViewAddChoice[];
  /** Trips looked at and ruled out, with why. */
  ruledOut: { trip: Trip; why: string }[];
  /** Pasted lines we couldn't read or find in the pack. */
  notRead: string[];
  notInPack: string[];
  /** The list came from the pack alone, before VIPS's own open time was pasted. */
  fromPackOnly: boolean;
  byModel: boolean;
}

export interface ViewAddInput {
  pack: BidPack;
  /** The line awarded: as printed, before carry-in. */
  line: Line;
  carryIn: CarryInItem[];
  elections: PhaseInElections;
  /** Hours owed; phase-in make-up defaults to what the carry-in dropped. */
  makeUp?: Partial<MakeUpHours>;
  /** VIPS's open-time list, as pasted. */
  pasted?: string;
  /** Reserve block or simulator labels, one a line: bid as typed (25.E.4.a.iv.(b), (c)). */
  labels?: string;
  vacations?: VacationPeriod[];
  model?: PilotModel | null;
}

/** Most make-up restored, then most days off, then fewest stretches of work. */
function comboOrder(a: ViewAddCombo, b: ViewAddCombo): number {
  return a.shortCH - b.shortCH || b.daysOffAfter - a.daysOffAfter || (a.workStretches ?? 0) - (b.workStretches ?? 0) || a.totalCH - b.totalCH;
}

export function buildViewAdd(input: ViewAddInput): ViewAddPlan {
  const { pack, line, carryIn, elections, vacations = [], model } = input;
  // The vacation's trips are off the line too (CBA 2026 7.G.1), so they aren't in the way, and its days off count.
  const carried = flyLine(line, pack, carryIn, elections);
  const onVacation = flyVacationsOnLine(carried.line, pack, vacations.map((vacation) => ({ vacation, choice: "use" as const })), carriedDaysOf(pack, carryIn));
  const flown = { ...carried, line: onVacation.line };
  const cia = Math.max(0, input.makeUp?.cia ?? flown.makeUpCH);
  const muv = Math.max(0, input.makeUp?.muv ?? 0);
  const target = cia + muv;
  const over = overageCH(pack.month);
  // CBA 2026 25.L.6.d: "A make-up assignment shall be operated under a single pay code (e.g., one trip could not be half MUV and half MUS)." Every bid period.
  const onePayCode = Math.max(cia, muv);

  const schedule = scheduleAsFlown(flown.line, carryIn, pack);

  // The pool: VIPS's own list when pasted, the pack's open trips until then. A trip the carry-in dropped from this line can be bid back only if it can fly, which the fit check settles.
  const pasted = parseOpenTimeList(input.pasted ?? "");
  const notInPack: string[] = [];
  const textOf = new Map<string, string>();
  const fromPackOnly = pasted.entries.length === 0;
  let pool: Trip[];
  if (fromPackOnly) {
    pool = pack.openPairings ?? [];
  } else {
    const universe = [...(pack.openPairings ?? []), ...pack.lines.flatMap((l) => l.trips)];
    const found = new Map<string, Trip>();
    for (const e of pasted.entries) {
      const t = pastedMatches(e, universe, pack)[0]?.trip;
      if (!t) {
        notInPack.push(e.raw);
        continue;
      }
      found.set(tripKey(t), t);
      textOf.set(tripKey(t), e.raw);
    }
    pool = [...found.values()];
  }

  const onLine = new Set(flown.line.trips.map(tripKey));
  const ruledOut: ViewAddPlan["ruledOut"] = [];
  const legal: { trip: Trip; check: string[] }[] = [];
  for (const trip of pool) {
    if (onLine.has(tripKey(trip))) continue;
    const fit = fitCheck(trip, schedule, vacations, pack);
    if (fit.illegal.length) {
      ruledOut.push({ trip, why: fit.illegal[0] });
    } else if (target > 0 && trip.creditHours > onePayCode + over) {
      // CBA 2026 25.L.6.e: "not eligible for a make-up assignment that exceeds the pilot's make-up eligibility by more than" this.
      ruledOut.push({ trip, why: `${trip.creditHours.toFixed(1)} CH passes your ${onePayCode.toFixed(1)} CH of make-up by more than ${over} CH (CBA 2026 25.L.6.e).` });
    } else {
      legal.push({ trip, check: fit.check });
    }
  }

  // Each candidate alone, on the pilot's own model when there is one: the variations score with the pack, so scores compare.
  const scoreLines = (variants: { id: string; line: Line }[]): Map<string, number> => {
    if (!model || !variants.length) return new Map();
    const lines = variants.map((v) => ({ ...v.line, id: v.id }));
    return new Map(scorePackV2({ ...pack, lines: [...pack.lines, ...lines] }, model).map((s) => [s.lineId, s.score]));
  };
  const solo = legal.map((c) => ({ ...c, line: lineWithAdded(flown.line, [c.trip], pack) }));
  const soloScores = scoreLines(solo.map((s) => ({ id: tripKey(s.trip), line: s.line })));
  const ranked = solo
    .map((s) => ({ ...s, score: soloScores.get(tripKey(s.trip)) ?? null }))
    .sort((a, b) => (model ? (b.score ?? 0) - (a.score ?? 0) : 0) || b.line.daysOff - a.line.daysOff || b.trip.creditHours - a.trip.creditHours);

  // The combination: a small search over the best-looking trips, each tried against those already in it.
  const candidates = ranked.slice(0, MAX_CANDIDATES);
  const found: ViewAddCombo[] = [];
  let tried = 0;
  const walk = (from: number, chosen: typeof candidates, busy: Busy[], total: number) => {
    if (chosen.length) {
      tried++;
      const whole = lineWithAdded(flown.line, chosen.map((c) => c.trip), pack);
      found.push({ trips: chosen.map((c) => c.trip), totalCH: Math.round(total * 100) / 100, shortCH: Math.max(0, Math.round((target - total) * 100) / 100), daysOffAfter: whole.daysOff, longestOff: longestDaysOffBlock(whole), workStretches: workStretches(whole, pack.bidPeriodDays), score: null });
    }
    if (chosen.length === MAX_COMBO_TRIPS || total >= target) return;
    for (let i = from; i < candidates.length; i++) {
      if (tried >= MAX_COMBOS_TRIED) return;
      const c = candidates[i];
      // CBA 2026 25.L.6.e: each trip against what's still owed.
      if (c.trip.creditHours > Math.min(target - total, onePayCode) + over) continue;
      if (fitCheck(c.trip, busy, vacations, pack).illegal.length) continue;
      const b = busyFromTrip(c.trip, pack);
      if (!b) continue;
      walk(i + 1, [...chosen, c], [...busy, b], total + c.trip.creditHours);
    }
  };
  if (target > 0) walk(0, [], schedule, 0);
  found.sort(comboOrder);
  const shortlist = found.slice(0, MAX_SCORED_COMBOS);
  const comboScores = scoreLines(shortlist.map((c, i) => ({ id: `combo-${i}`, line: lineWithAdded(flown.line, c.trips, pack) })));
  shortlist.forEach((c, i) => (c.score = comboScores.get(`combo-${i}`) ?? null));
  // Whatever restores the hours first; the pilot's model picks among those.
  const combos = [...shortlist].sort((a, b) => a.shortCH - b.shortCH || (model ? (b.score ?? 0) - (a.score ?? 0) : 0) || comboOrder(a, b)).slice(0, BEST_COMBOS);

  const best = new Set(combos[0]?.trips.map(tripKey) ?? []);
  const inCombos = new Set(combos.flatMap((c) => c.trips.map(tripKey)));
  const text = (t: Trip) => {
    const own = textOf.get(tripKey(t));
    if (own) return own;
    const date = pairingDate(t, pack);
    return `Trip ${t.pairingNumber ?? "?"} ${date ? DateTime.fromISO(date, { zone: "utc" }).toFormat("LLL d") : ""}`.trim();
  };
  const ordered = [...ranked].sort((a, b) => Number(best.has(tripKey(b.trip))) - Number(best.has(tripKey(a.trip))) || Number(inCombos.has(tripKey(b.trip))) - Number(inCombos.has(tripKey(a.trip))));
  const choices: ViewAddChoice[] = ordered.slice(0, MAX_CHOICES).map((c) => {
    const key = tripKey(c.trip);
    const lost = flown.line.daysOff - c.line.daysOff;
    const reason = best.has(key) ? "In your best combination" : inCombos.has(key) ? "In a close alternative" : "A fallback if those go to someone senior";
    return {
      trip: c.trip,
      text: text(c.trip),
      creditHours: c.trip.creditHours,
      daysOffAfter: c.line.daysOff,
      why: `${reason}: ${c.trip.creditHours.toFixed(1)} CH, costs ${lost} day${lost === 1 ? "" : "s"} off, leaving ${c.line.daysOff}.`,
      check: c.check,
      inBest: best.has(key),
      score: c.score,
    };
  });
  // Labels the pilot typed go where they put them relative to nothing we can score: after the trips, within the limit.
  const labels = (input.labels ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const label of labels) {
    if (choices.length >= MAX_CHOICES) break;
    choices.push({ trip: null, text: label, creditHours: 0, daysOffAfter: flown.line.daysOff, why: "As you typed it: we can't see reserve blocks or simulator events in the pack (CBA 2026 25.E.4.a.iv).", check: [], inBest: false, score: null });
  }

  return { flown, targetCH: target, overCH: over, combos, choices, ruledOut, notRead: pasted.notRead, notInPack, fromPackOnly, byModel: !!model };
}

/** The list as plain text, for pasting into VIPS. */
export function viewAddCopyText(plan: Pick<ViewAddPlan, "choices">): string {
  return plan.choices.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
}

