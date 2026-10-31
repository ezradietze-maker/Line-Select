import { dutyClocks } from "@/lib/sleep-plan";
import type { Trip } from "@/types/bidpack";

/**
 * How hard a trip, or a whole line, is on the body clock: a score from 1 to 100, 100 the gentlest — replacing the old
 * 1–5 stars. Each thing that disrupts the body clock costs points, on the body's own clock (`dutyClocks`: home time at
 * first, drifting toward local on layovers, as the sleep plan assumes), and the points become the score on a curve. What
 * costs, and the research behind it:
 *
 * - **Working through the body's night** — every hour on duty between 02:00 and 06:00 body time, the window of circadian
 *   low (WOCL) where alertness bottoms out; FAA Part 117 and ICAO fatigue rules are built around it. Night-shift accident
 *   risk runs about 30% above day shifts (Folkard & Tucker, Occupational Medicine 2003). Hotel standby through those
 *   hours counts half: on call, sleep is possible but lighter and shorter (Ferguson et al., Chronobiology Intl 2016),
 *   and it doesn't count as time awake.
 * - **Nights in a row** — the same review: risk on the 2nd, 3rd and 4th consecutive night is about 6%, 17% and 36% above
 *   the first, so each night in a run counts for more; and sleep after a night duty, in the body's day, runs 1–4 hours
 *   short of night sleep (Åkerstedt, shift-work studies), so sleep debt builds with every night after the first.
 * - **Early reports** — a report between 04:00 and 07:00 body time cuts short the sleep before it, about in proportion to
 *   how early (Roach et al., Accident Analysis & Prevention 2012: pilots slept ~15 minutes less for each hour earlier).
 * - **Long time awake** — past 16 hours awake performance falls fast: 17 hours is like a 0.05% blood alcohol level, 24
 *   like 0.10% (Dawson & Reid, Nature 1997; Williamson & Feyer 2000).
 * - **Short sleep on layovers** — the sleep each layover allows (`planTripSleep`) against the 7 hours adults need
 *   (American Academy of Sleep Medicine); under 5 hours costs more.
 * - **Day/night flips** — switching between day and night duty, and back: the body clock never settles. One or two
 *   nights keep it on a day schedule, so coming back costs little; the longer the run of nights, the further the clock
 *   has begun to move and the longer it takes to come back (Folkard, Chronobiology Intl 2008; Folkard & Tucker 2003 —
 *   why short runs of nights are advised over long ones).
 * - **Shifting the body clock** — every hour the body clock has to move to follow time zones on layovers, and to come
 *   back home; moving it earlier (east) is harder than later (west), about one hour a day against one and a half
 *   (Waterhouse et al., The Lancet 2007).
 *
 * A line is scored on the same curve as its trips, as their average (by days) — so a line reads like the trips in it —
 * with what only a line has counted on the trip it follows:
 *
 * - **Recovery between trips** — after a disruptive trip, fewer than two nights at home before the next:
 *   EASA's flight-time rules ask for 36 hours including two local nights to reset after disruptive schedules, and the
 *   sleep debt to clear grows with the nights worked and the time zones crossed (recovery after a run of night shifts
 *   takes longer the longer the run — Tucker et al. 1999), so each night short costs more after a harder trip.
 */

export type BodyClockFactorId = "night" | "nightRun" | "early" | "awake" | "sleep" | "flips" | "shift" | "recovery";

export interface BodyClockFactor {
  id: BodyClockFactorId;
  /** What it is, in a few words. */
  label: string;
  /** Score points it costs (rounded) — the factors together make up 100 minus the score. */
  points: number;
  /** This trip's or line's own specifics: "6 duties through 2–6am body time, 9.5 h in all". */
  detail: string;
  /** One line of the research behind it. */
  science: string;
}

export interface BodyClockScore {
  /** 1–100, 100 the gentlest on the body clock. */
  score: number;
  /** Everything that cost points, most first; empty for a perfect 100. */
  factors: BodyClockFactor[];
  /** Raw counts, for words elsewhere. */
  counts: { nightDuties: number; nightHours: number; longestNightRun: number; earlyReports: number; flips: number; shiftHours: number; shortSleeps: number; longAwake: number };
}

const SCIENCE: Record<BodyClockFactorId, string> = {
  night: "02:00–06:00 on your body clock is the window of circadian low — alertness is at its lowest; FAA Part 117 is built around it, and night-shift risk runs ~30% above days (Folkard & Tucker 2003).",
  nightRun: "Each night in a row adds risk — about +6%, +17% and +36% on the 2nd, 3rd and 4th (Folkard & Tucker 2003) — and day sleep after a night runs 1–4 hours short, so sleep debt builds (Åkerstedt).",
  early: "A report before 07:00 on your body clock cuts the sleep before it short — about 15 minutes less for each hour earlier (Roach et al. 2012).",
  awake: "Past 16 hours awake, performance drops fast: 17 hours is like a 0.05% blood alcohol level, 24 like 0.10% (Dawson & Reid, Nature 1997).",
  sleep: "Adults need at least 7 hours (American Academy of Sleep Medicine); this is the sleep each layover allows on your body clock.",
  flips: "Switching onto nights and back keeps the body clock from settling; after one or two nights it comes back easily, after a longer run it takes days (Folkard 2008).",
  shift: "The body clock moves about an hour a day east, an hour and a half west, and coming home it has to move back (Waterhouse et al., Lancet 2007).",
  recovery: "After a disruptive stretch, the body needs about two nights of normal sleep to reset — EASA's rules ask for 36 hours including two local nights.",
};

/** Every factor the score weighs, in the order a pilot would think of them, with its research — for the explainer. */
export function bodyClockFactorsExplained(): { label: string; science: string }[] {
  return (["night", "nightRun", "early", "awake", "sleep", "flips", "shift", "recovery"] as const).map((id) => ({ label: LABEL[id], science: SCIENCE[id] }));
}

const LABEL: Record<BodyClockFactorId, string> = {
  night: "Working through the body's night",
  nightRun: "Nights in a row",
  early: "Early reports",
  awake: "Long time awake",
  sleep: "Short sleep on layovers",
  flips: "Day/night flips",
  shift: "Shifting the body clock",
  recovery: "Little recovery between trips",
};

// What each costs, in points before the curve.
/** Per hour on duty in the body's 02:00–06:00; on call at a hotel, this share of it. */
const NIGHT_PER_HOUR = 2;
const STANDBY_NIGHT_SHARE = 0.5;
/** Relative risk of the 1st, 2nd, 3rd, 4th night in a row (Folkard & Tucker 2003); past the 4th, +15% a night. */
const NIGHT_RUN_RISK = [1, 1.06, 1.17, 1.36];
/** A night duty: this much of it in the body's night, or a report inside it. */
const NIGHT_DUTY_MINUTES = 30;
/** Two night duties are nights in a row when the second reports within this many hours of the first. */
const NIGHTS_IN_A_ROW_HOURS = 30;
/** Per hour a report falls before 07:00 body time (04:00–07:00; earlier is the body's night, counted there). */
const EARLY_PER_HOUR = 1.5;
/** Per hour awake past 16 at block-in. */
const AWAKE_PER_HOUR = 1.5;
const AWAKE_FREE_HOURS = 16;
/** Per hour of sleep short of 7, and again short of 5. */
const SLEEP_PER_HOUR = 1;
/** Going onto nights; and coming back off them, per night of the run (up to four — by then the clock has moved as far as it does). */
const FLIP_ON_POINTS = 1.5;
const FLIP_BACK_PER_NIGHT = 1.5;
const FLIP_BACK_MAX_NIGHTS = 4;
/** Hours of sleep debt each night in a row after the first adds (day sleep runs 1–4 h short — the middle of it), at the sleep rate. */
const DEBT_HOURS_PER_NIGHT = 1.5;
/** Per hour the body clock moves; east (earlier) counts this much more (Waterhouse 2007). */
const SHIFT_PER_HOUR = 1;
const EAST_MULTIPLIER = 1.5;
/** Per night short of two at home after a disruptive trip: a base, more per night duty on it, more per hour the body clock moved. */
const RECOVERY_PER_NIGHT = 4;
const RECOVERY_PER_NIGHT_DUTY = 1.5;
const RECOVERY_PER_SHIFT_HOUR = 0.5;
/** Each night in a row past the pilot's own stated limit (`explicitTargets.circadianTolerance`), on top. */
const PAST_LIMIT_POINTS = 3;
/** Points to score: 100 at none, falling off on a curve — one curve for trips and lines, calibrated on the October 2026 MD-11 and B777 packs so they spread over the range. */
const SCALE = 40;
const toScore = (points: number) => Math.max(1, Math.round(1 + 99 * Math.exp(-points / SCALE)));

const DAY = 1440;
const mod = (x: number, m = DAY) => ((x % m) + m) % m;

/** Minutes of [start, end] (trip minutes) that fall between 02:00 and 06:00 on the body clock. */
function bodyNightMinutes(start: number, end: number, toBody: number): number {
  let total = 0;
  for (let m = start; m < end; m += 5) {
    const b = mod(m + toBody);
    if (b >= 120 && b < 360) total += Math.min(5, end - m);
  }
  return total;
}

/** One trip's raw points, by factor, before the curve — and the counts behind them. */
interface TripPoints {
  points: Record<BodyClockFactorId, number>;
  counts: BodyClockScore["counts"];
  /** It disrupted the body clock: a night duty, or a body-clock shift of three hours or more. */
  disruptive: boolean;
  earliestEarlyReport: number | null;
}

/**
 * A trip's points depend on its schedule and printed times, not its date — the same pairing on any line, any day, costs
 * the same — so they're worked out once per pairing (the key the pack's own metrics use) and home offset.
 */
const cache = new Map<string, TripPoints | null>();
const CACHE_LIMIT = 5000;

function tripPoints(trip: Trip, homeBaseOffsetMinutes: number | null, nightsLimit: number | null = null): TripPoints | null {
  // Its printed times and layovers: a pairing's date variants keep their own entry if anything that's timed differs.
  const timed = trip.schedule.map((d) => `${d.startMinutes}:${d.legs.map((l) => `${l.depTimeLocal}${l.depTimeGmt}${l.arrTimeLocal}${l.arrTimeGmt}${l.endMinutes}`).join(",")}:${d.layover?.endMinutes ?? ""}`).join("/");
  const key = `${trip.id}|${homeBaseOffsetMinutes}|${nightsLimit}|${timed}`;
  if (cache.has(key)) return cache.get(key)!;
  const result = computeTripPoints(trip, homeBaseOffsetMinutes, nightsLimit);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}

function computeTripPoints(trip: Trip, homeBaseOffsetMinutes: number | null, nightsLimit: number | null): TripPoints | null {
  const clocks = dutyClocks(trip, homeBaseOffsetMinutes);
  if (!clocks || !clocks.duties.length) return null;
  const points: Record<BodyClockFactorId, number> = { night: 0, nightRun: 0, early: 0, awake: 0, sleep: 0, flips: 0, shift: 0, recovery: 0 };
  const counts = { nightDuties: 0, nightHours: 0, longestNightRun: 0, earlyReports: 0, flips: 0, shiftHours: 0, shortSleeps: 0, longAwake: 0 };
  const nights: boolean[] = [];
  let run = 0;
  /** Each run of nights in a row, by length — what flipping onto and back off nights costs. */
  const runs: number[] = [];
  let lastNightReport = -Infinity;
  let earliest: number | null = null;

  for (const d of clocks.duties) {
    const standby = trip.schedule[d.dutyIndex].legs.every((l) => l.isStandby);
    const toBody = d.zOff + d.bodyOffset;
    const nightMin = bodyNightMinutes(d.report, d.release, toBody);
    const reportBody = mod(d.report + toBody);
    const isNight = nightMin >= NIGHT_DUTY_MINUTES || (reportBody >= 120 && reportBody < 360);
    nights.push(isNight);
    if (isNight) {
      run = d.report - lastNightReport <= NIGHTS_IN_A_ROW_HOURS * 60 ? run + 1 : 1;
      lastNightReport = d.report;
      const risk = run <= NIGHT_RUN_RISK.length ? NIGHT_RUN_RISK[run - 1] : NIGHT_RUN_RISK.at(-1)! + 0.15 * (run - NIGHT_RUN_RISK.length);
      const base = ((standby ? STANDBY_NIGHT_SHARE : 1) * NIGHT_PER_HOUR * nightMin) / 60;
      points.night += base;
      points.nightRun += base * (risk - 1) + SLEEP_PER_HOUR * DEBT_HOURS_PER_NIGHT * (run - 1) + (nightsLimit !== null && run > nightsLimit ? PAST_LIMIT_POINTS : 0);
      counts.nightDuties++;
      counts.nightHours += nightMin / 60;
      counts.longestNightRun = Math.max(counts.longestNightRun, run);
      if (run === 1) runs.push(1);
      else runs[runs.length - 1] = run;
    } else run = 0;
    // 04:00–07:00 on the body clock: an early report, costing more the earlier.
    if (reportBody >= 240 && reportBody < 420) {
      points.early += (EARLY_PER_HOUR * (420 - reportBody)) / 60;
      counts.earlyReports++;
      earliest = earliest === null ? reportBody : Math.min(earliest, reportBody);
    }
    const awake = (d.release - d.wokeAt) / 60;
    if (!standby && awake > AWAKE_FREE_HOURS) {
      points.awake += AWAKE_PER_HOUR * (awake - AWAKE_FREE_HOURS);
      counts.longAwake++;
    }
  }

  for (const plan of clocks.plans) {
    const short = Math.max(0, 7 - plan.totalSleepHours) + Math.max(0, 5 - plan.totalSleepHours);
    if (short > 0) counts.shortSleeps++;
    points.sleep += SLEEP_PER_HOUR * short;
  }

  // The body clock's moves: out across the layovers, then back home.
  const offsets = [clocks.homeOffset, ...clocks.duties.map((d) => d.bodyOffset), clocks.endOffset, clocks.homeOffset];
  for (let i = 1; i < offsets.length; i++) {
    const move = (offsets[i] - offsets[i - 1]) / 60;
    if (Math.abs(move) < 0.25) continue;
    // A later offset is a clock moved later — east, an advance: the harder way.
    points.shift += SHIFT_PER_HOUR * Math.abs(move) * (move > 0 ? EAST_MULTIPLIER : 1);
    counts.shiftHours += Math.abs(move);
  }

  // The trip's own flips — onto nights from a normal day at home, and back — each run of nights costing more to come back
  // from the longer it was.
  const walk = [false, ...nights, false];
  for (let i = 1; i < walk.length; i++) if (walk[i] !== walk[i - 1]) counts.flips++;
  points.flips = runs.reduce((a, n) => a + FLIP_ON_POINTS + FLIP_BACK_PER_NIGHT * Math.min(n, FLIP_BACK_MAX_NIGHTS), 0);

  return { points, counts, disruptive: counts.nightDuties > 0 || counts.shiftHours >= 3, earliestEarlyReport: earliest };
}

const hours = (h: number) => (h >= 10 ? `${Math.round(h)} h` : `${Math.round(h * 10) / 10} h`);
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function detailOf(id: BodyClockFactorId, c: BodyClockScore["counts"], extra: { earliestEarly: number | null; recoveryGaps: number }): string {
  switch (id) {
    case "night":
      return `${plural(c.nightDuties, "duty", "duties")} through 2–6am on your body clock, ${hours(c.nightHours)} in all`;
    case "nightRun":
      return `Longest run: ${plural(c.longestNightRun, "night")} in a row`;
    case "early":
      return `${plural(c.earlyReports, "report")} before 07:00 body time${extra.earliestEarly !== null ? `, the earliest ${clock(extra.earliestEarly)}` : ""}`;
    case "awake":
      return `${plural(c.longAwake, "duty", "duties")} ending more than 16 hours after you'd have woken`;
    case "sleep":
      return `${plural(c.shortSleeps, "layover")} allowing under 7 hours of sleep`;
    case "flips":
      return `${plural(c.flips, "switch", "switches")} onto nights and back`;
    case "shift":
      return `The body clock moves ${hours(c.shiftHours)} in all, out and back`;
    case "recovery":
      return `${plural(extra.recoveryGaps, "time")} fewer than two nights at home after a disruptive trip`;
  }
}

function finish(points: Record<BodyClockFactorId, number>, counts: BodyClockScore["counts"], extra: { earliestEarly: number | null; recoveryGaps: number }): BodyClockScore {
  const total = Object.values(points).reduce((a, b) => a + b, 0);
  const score = toScore(total);
  const lost = 100 - score;
  const factors = (Object.keys(points) as BodyClockFactorId[])
    .filter((id) => points[id] > 0.05)
    .map((id) => ({ id, label: LABEL[id], points: total > 0 ? (points[id] / total) * lost : 0, detail: detailOf(id, counts, extra), science: SCIENCE[id] }))
    .sort((a, b) => b.points - a.points)
    .map((f) => ({ ...f, points: Math.round(f.points) }))
    .filter((f) => f.points > 0);
  return { score, factors, counts };
}

/**
 * One trip's body-clock score. Null when the trip can't be placed on the clock (no printed GMT times). `nightsLimit`: the
 * pilot's own stated most nights in a row, when they gave one — each past it costs more.
 */
export function tripBodyClockScore(trip: Trip, homeBaseOffsetMinutes: number | null, nightsLimit: number | null = null): BodyClockScore | null {
  const t = tripPoints(trip, homeBaseOffsetMinutes, nightsLimit);
  return t ? finish(t.points, t.counts, { earliestEarly: t.earliestEarlyReport, recoveryGaps: 0 }) : null;
}

/**
 * A line's body-clock score: its trips' own scores, averaged by days — so a line reads like the trips in it — each trip
 * scored with the recovery it leaves short when the next comes too soon (after a disruptive trip, fewer than two nights
 * at home). The reasons are its trips' reasons, averaged the same way, so they still add up to 100 minus the score; the
 * counts are the whole line's. Null when none of its trips can be placed on the clock.
 */
export function lineBodyClockScore(trips: Trip[], homeBaseOffsetMinutes: number | null, nightsLimit: number | null = null): BodyClockScore | null {
  const at = (trip: Trip, minutes: number) => (trip.zuluAnchor ? Date.parse(trip.zuluAnchor) + minutes * 60_000 : NaN);
  const ordered = [...trips].sort((a, b) => at(a, 0) - at(b, 0) || (a.startDayIndex ?? 0) - (b.startDayIndex ?? 0));
  const lost: Record<BodyClockFactorId, number> = { night: 0, nightRun: 0, early: 0, awake: 0, sleep: 0, flips: 0, shift: 0, recovery: 0 };
  const counts = { nightDuties: 0, nightHours: 0, longestNightRun: 0, earlyReports: 0, flips: 0, shiftHours: 0, shortSleeps: 0, longAwake: 0 };
  let earliestEarly: number | null = null;
  let recoveryGaps = 0;
  let days = 0;
  let scoreSum = 0;

  ordered.forEach((trip, i) => {
    const t = tripPoints(trip, homeBaseOffsetMinutes, nightsLimit);
    if (!t) return;
    const points = { ...t.points };
    for (const k of ["nightDuties", "nightHours", "earlyReports", "flips", "shiftHours", "shortSleeps", "longAwake"] as const) counts[k] += t.counts[k];
    counts.longestNightRun = Math.max(counts.longestNightRun, t.counts.longestNightRun);
    if (t.earliestEarlyReport !== null) earliestEarly = earliestEarly === null ? t.earliestEarlyReport : Math.min(earliestEarly, t.earliestEarlyReport);
    // Home before the next trip: recovered after two local nights — what's left short is this trip's to carry.
    const lastLeg = trip.schedule.at(-1)?.legs.at(-1);
    const next = ordered[i + 1];
    const gapHours = next && lastLeg ? (at(next, 0) - at(trip, lastLeg.endMinutes)) / 3_600_000 : Infinity;
    if (next && t.disruptive && Number.isFinite(gapHours)) {
      // Nights at home: a night is 22:00–08:00; the gap holds about one per 24 hours past the first 10.
      const homeNights = Math.max(0, Math.floor((gapHours - 10) / 24) + (gapHours >= 10 ? 1 : 0));
      if (homeNights < 2) {
        const need = RECOVERY_PER_NIGHT + RECOVERY_PER_NIGHT_DUTY * Math.min(t.counts.nightDuties, 5) + RECOVERY_PER_SHIFT_HOUR * Math.min(t.counts.shiftHours, 12);
        points.recovery += need * (2 - homeNights);
        recoveryGaps++;
      }
    }
    // This trip's score, and what each reason cost it, weighted by its days.
    const total = Object.values(points).reduce((a, b) => a + b, 0);
    const score = toScore(total);
    const weight = Math.max(1, trip.days);
    days += weight;
    scoreSum += score * weight;
    for (const id of Object.keys(points) as BodyClockFactorId[]) if (total > 0) lost[id] += (points[id] / total) * (100 - score) * weight;
  });
  if (!days) return null;
  const score = Math.max(1, Math.round(scoreSum / days));
  const extra = { earliestEarly, recoveryGaps };
  const factors = (Object.keys(lost) as BodyClockFactorId[])
    .map((id) => ({ id, label: LABEL[id], points: Math.round(lost[id] / days), detail: detailOf(id, counts, extra), science: SCIENCE[id] }))
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points - a.points);
  return { score, factors, counts };
}
