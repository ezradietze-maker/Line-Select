import type { Trip } from "@/types/bidpack";

/**
 * A suggested sleep plan for every layover on a trip — when to sleep, and whether to nap — from the trip's real
 * printed times and the pilot's body clock. Guidance, not a rule: it shows where sleep will come most easily and do
 * the most good, the way fatigue-risk programs teach crews to plan it.
 *
 * What it rests on (each is mainstream sleep science, and what FAA/ICAO fatigue guidance is built on):
 *
 * - **Two processes decide sleep** (Borbély's two-process model): sleep pressure, which builds the longer you're awake,
 *   and the body clock, which makes sleep easy in its night and hard in its day. Sleep comes best when both line up.
 *   The hardest time to fall asleep is the "wake maintenance zone", the few hours before habitual bedtime; there's a
 *   natural dip in the early afternoon that makes naps work.
 * - **The body clock runs on home time** and shifts toward local time only slowly — about an hour a day flying east,
 *   an hour and a half flying west (Waterhouse et al., The Lancet, 2007); past about nine hours east, it usually adjusts
 *   the long way round, by delaying. On a short layover across the world, a pilot's body is still at home.
 * - **The window of circadian low** (02:00–06:00 body time) is when sleep drive peaks and alertness bottoms out.
 * - **Adults need 7–9 hours** (American Academy of Sleep Medicine); a sleep that ends at the end of a ~90-minute cycle,
 *   or a nap of 20–30 minutes, avoids waking groggy (sleep inertia).
 * - **Planned naps work**: NASA's study of naps on long-haul flights (Rosekind et al., 1994) found a short planned nap
 *   markedly improved pilots' performance and alertness; a nap before a night duty ("prophylactic napping") cuts the
 *   fatigue of flying through the body-clock night.
 * - **After an all-nighter**, a recovery sleep on arrival plus a main sleep in the body-clock night ("anchor sleep",
 *   Minors & Waterhouse) beats one long daytime sleep, which the body clock cuts short.
 *
 * Assumptions, said plainly: before a trip the pilot keeps a normal day at home (asleep about 23:00–07:00 base time);
 * the body clock shifts only during layovers (a duty's light and wakefulness are too irregular to count); a pilot is in
 * the hotel `POST_DUTY` minutes after block-in and needs `GET_READY` minutes before report (or 45 before a printed
 * pickup).
 */

const DAY = 1440;
/** Block-in to hotel: debrief, the van, check-in. */
const POST_DUTY = 45;
/** Hotel arrival to lights out. */
const WIND_DOWN = 20;
/** Waking to report: shower, eat, the van. */
const GET_READY = 90;
/** Waking to a printed hotel pickup. */
const BEFORE_PICKUP = 45;
/** A full night's sleep. */
const FULL_SLEEP = 480;
/** One sleep cycle — the natural place to wake. */
const CYCLE = 90;
/**
 * Sleep in the body clock's day runs 1–4 hours short of night sleep — the clock wakes you (Åkerstedt's shift-work
 * studies) — so where a long layover's main sleep falls in the body's day, plan a core of four cycles and a nap
 * before the next duty, the standard advice for night work, rather than an 8-hour block few people get.
 */
const DAYTIME_CORE = 4 * CYCLE;
/** Awake this long and sleep comes whatever the body clock says. */
const HIGH_PRESSURE_HOURS = 16;
/** Never plan a pilot past this many hours awake before their first sleep of a layover. */
const MAX_AWAKE_HOURS = 18;
/** How fast the body clock shifts, minutes per day of layover: advancing (flying east) and delaying (west). */
const ADVANCE_PER_DAY = 60;
const DELAY_PER_DAY = 90;
/** Past this many minutes east, the body clock adjusts the long way round. */
const LONG_WAY_ROUND = 9 * 60;

export type SleepKind = "sleep" | "recovery" | "nap" | "preDuty";

export interface SleepBlock {
  kind: SleepKind;
  /** Trip minutes, the same clock as the schedule's `startMinutes`. */
  start: number;
  end: number;
  /** "Main sleep", "Recovery sleep", "Pre-departure nap", "Power nap". */
  title: string;
  /** Why this block, in a sentence a pilot can check against what they know. */
  why: string;
  /** How easily sleep comes in this block, 0–1 (the body clock's sleep propensity, on average). */
  ease: number;
  /** Its start and end on the layover city's clock, "HH:MM". */
  startLocal: string;
  endLocal: string;
}

export interface LayoverSleepPlan {
  /** Index of the duty this layover follows. */
  dutyIndex: number;
  city: string;
  /** In the hotel, and up for the next duty — trip minutes. */
  inHotel: number;
  wakeBy: number;
  /** Local clock offset from UTC here, and the body clock's, in minutes. */
  localOffset: number;
  bodyOffset: number;
  /** Hours awake on reaching the hotel (an estimate — see `planTripSleep`). */
  awakeHours: number;
  blocks: SleepBlock[];
  totalSleepHours: number;
  /** good ≥ 7 h planned, short 5–7 h, poor under 5 h. */
  quality: "good" | "short" | "poor";
  /** One line: "Nap 08:40–11:40 · Sleep 22:30–06:15". */
  summary: string;
  /** The body clock here, in words: "Your body clock is 3 h behind local time — it's 05:10 to your body when you get in." */
  bodyClockNote: string;
  /** Hotel arrival and wake-up on the city's clock. */
  inHotelLocal: string;
  wakeByLocal: string;
  /** How easily the body could sleep through the stay, every 15 minutes from arrival to wake-up (body clock alone), for drawing it. */
  ribbon: { at: number; ease: number }[];
}

const mod = (x: number, m = DAY) => ((x % m) + m) % m;
const hhmm = (s: string | undefined) => (s && /^\d{4}$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(2)) : null);

/** Local minus UTC, in minutes, read off a printed local/GMT pair — within ±12 h. */
function offsetOf(local: string | undefined, gmt: string | undefined): number | null {
  const l = hhmm(local);
  const g = hhmm(gmt);
  if (l === null || g === null) return null;
  const d = mod(l - g);
  return d > 720 ? d - DAY : d;
}

/** UTC minute-of-day minus trip minute, read off the first leg with a printed GMT time. */
function zuluOffset(trip: Trip): number | null {
  for (const duty of trip.schedule)
    for (const leg of duty.legs) {
      const g = hhmm(leg.depTimeGmt);
      if (g !== null) return mod(g - leg.startMinutes);
    }
  return null;
}

/** Where the body clock is after `minutes` in a zone at `target`, starting from `body` (all minutes). */
export function driftBodyClock(body: number, target: number, minutes: number): number {
  let diff = mod(target - body + 720) - 720;
  if (diff > LONG_WAY_ROUND) diff -= DAY;
  const rate = diff > 0 ? ADVANCE_PER_DAY : DELAY_PER_DAY;
  const step = Math.min(Math.abs(diff), (rate * Math.max(0, minutes)) / DAY);
  return body + Math.sign(diff) * step;
}

/** How easily sleep comes at a body-clock time (minute of day), 0–1: highest in the body's night, lowest just before it. */
export function sleepPropensity(bodyMinute: number): number {
  const knots: [number, number][] = [
    [0, 1],
    [6, 1],
    [7, 0.85],
    [8, 0.55],
    [9, 0.35],
    [12, 0.3],
    [14, 0.55],
    [15.5, 0.5],
    [17, 0.3],
    [19, 0.12],
    [21, 0.12],
    [22, 0.5],
    [23, 0.9],
    [24, 1],
  ];
  const h = mod(bodyMinute) / 60;
  for (let i = 1; i < knots.length; i++) {
    const [h1, v1] = knots[i];
    const [h0, v0] = knots[i - 1];
    if (h <= h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return 1;
}

const clockText = (m: number) => `${String(Math.floor(mod(m) / 60)).padStart(2, "0")}:${String(Math.round(mod(m) % 60)).padStart(2, "0")}`;
const hoursText = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
};

interface Context {
  zOff: number;
  /** Body clock offset at a trip minute during this layover. */
  bodyAt: (m: number) => number;
  /** Sleep pressure bonus at a trip minute: very tired, sleep comes early even in the body's day. */
  pressureAt: (m: number) => number;
}

/** Mean ease of sleep over [s, e), sampled every 15 minutes. */
function easeOf(ctx: Context, s: number, e: number): number {
  let sum = 0;
  let n = 0;
  for (let m = s; m < e; m += 15) {
    sum += Math.min(1, sleepPropensity(m + ctx.zOff + ctx.bodyAt(m)) + ctx.pressureAt(m));
    n++;
  }
  return n ? sum / n : 0;
}

/** The best place for a sleep of `length` in [from, to]: where it comes most easily. */
function bestBlock(ctx: Context, from: number, to: number, length: number): { start: number; ease: number } | null {
  if (to - from < length) return null;
  let best: { start: number; ease: number } | null = null;
  for (let s = from; s + length <= to; s += 15) {
    const ease = easeOf(ctx, s, s + length);
    if (!best || ease > best.ease + 1e-6) best = { start: s, ease };
  }
  return best;
}

/** Body-clock-night minutes (22:30–07:00 body time) in [s, e). */
function bodyNightMinutes(ctx: Context, s: number, e: number): number {
  let n = 0;
  for (let m = s; m < e; m += 15) {
    const b = mod(m + ctx.zOff + ctx.bodyAt(m));
    if (b >= 22.5 * 60 || b < 7 * 60) n += 15;
  }
  return n;
}

/** When they last woke before the trip: a normal day at home, or a rest before a night report. */
function wokeBeforeTrip(firstReport: number, bodyMinute: number): number {
  if (bodyMinute >= 8.5 * 60 && bodyMinute < 20 * 60) return firstReport - (bodyMinute - 7 * 60);
  if (bodyMinute >= 4 * 60 && bodyMinute < 8.5 * 60) return firstReport - GET_READY;
  // A night report: most pilots rest beforehand — count from a nap ending a few hours before.
  return firstReport - 180;
}

/** The layover's printed hotel pickup as a trip minute (the last time that clock reads before report), if there is one. */
function pickupMinute(pickupLocal: string | undefined, report: number, localOff: number, zOff: number): number | null {
  const p = hhmm(pickupLocal);
  if (p === null) return null;
  const reportLocal = mod(report + zOff + localOff);
  const before = mod(reportLocal - p);
  return before <= 4 * 60 ? report - before : null;
}

export function planTripSleep(trip: Trip, homeBaseOffsetMinutes: number | null): LayoverSleepPlan[] {
  if (!trip.schedule.length) return [];
  const zOff = zuluOffset(trip);
  if (zOff === null) return [];
  const first = trip.schedule[0].legs[0];
  let body = homeBaseOffsetMinutes ?? offsetOf(first?.depTimeLocal, first?.depTimeGmt) ?? 0;
  const firstReport = trip.schedule[0].startMinutes;
  let lastWake = wokeBeforeTrip(firstReport, mod(firstReport + zOff + body));
  const plans: LayoverSleepPlan[] = [];

  trip.schedule.forEach((duty, i) => {
    const lay = duty.layover;
    const next = trip.schedule[i + 1];
    if (!lay || !next) return;
    const lastLeg = duty.legs.at(-1);
    const localOff = offsetOf(lastLeg?.arrTimeLocal, lastLeg?.arrTimeGmt) ?? body;
    const inHotel = lay.startMinutes + POST_DUTY;
    const report = next.startMinutes;
    const pickup = pickupMinute(lay.pickupTimeLocal, report, localOff, zOff);
    const wakeBy = pickup !== null ? pickup - BEFORE_PICKUP : report - GET_READY;
    const from = inHotel + WIND_DOWN;
    const startBody = body;
    const awakeMin = Math.max(0, inHotel - lastWake);
    const ctx: Context = {
      zOff,
      bodyAt: (m) => driftBodyClock(startBody, localOff, m - inHotel),
      // Very tired, sleep comes early whatever the body clock says — fading over the first hours in.
      pressureAt: (m) => Math.max(0, Math.min(0.5, (awakeMin / 60 - 14) / 10)) * Math.exp(-(m - from) / 240),
    };
    const nextDutyEnd = next.legs.at(-1)?.endMinutes ?? report;
    const local = (m: number) => clockText(m + zOff + localOff);
    const blocks = planLayover(ctx, from, wakeBy, awakeMin / 60, report, nextDutyEnd).map((b) => ({ ...b, startLocal: local(b.start), endLocal: local(b.end) }));
    const total = blocks.reduce((a, b) => a + (b.end - b.start), 0);
    const ribbon: { at: number; ease: number }[] = [];
    for (let m = inHotel; m <= wakeBy; m += 15) ribbon.push({ at: m, ease: sleepPropensity(m + zOff + ctx.bodyAt(m)) });
    const behind = Math.round((mod(localOff - ctx.bodyAt(inHotel) + 720) - 720) / 60);
    plans.push({
      dutyIndex: i,
      city: lay.city,
      inHotel,
      wakeBy,
      localOffset: localOff,
      bodyOffset: ctx.bodyAt(inHotel),
      awakeHours: awakeMin / 60,
      blocks,
      totalSleepHours: total / 60,
      quality: total >= 7 * 60 ? "good" : total >= 5 * 60 ? "short" : "poor",
      summary: blocks.length ? blocks.map((b) => `${b.kind === "sleep" ? "Sleep" : b.kind === "recovery" ? "Recovery" : "Nap"} ${b.startLocal}–${b.endLocal}`).join(" · ") : "No real chance to sleep",
      inHotelLocal: local(inHotel),
      wakeByLocal: local(wakeBy),
      ribbon,
      bodyClockNote:
        Math.abs(behind) < 1
          ? `Your body clock is on local time here — it's ${local(inHotel)} to your body too.`
          : `Your body clock is ${Math.abs(behind)} h ${behind > 0 ? "behind" : "ahead of"} local time — it's ${clockText(inHotel + zOff + ctx.bodyAt(inHotel))} to your body when you get to the hotel at ${local(inHotel)}.`,
    });
    // Carried to the next layover: the body clock where this one left it, and when they got up.
    body = ctx.bodyAt(report);
    lastWake = blocks.length ? Math.max(...blocks.map((b) => b.end)) : lastWake;
  });
  return plans;
}

/** The sleep blocks for one layover's window [from, wakeBy]. */
type PlannedBlock = Omit<SleepBlock, "startLocal" | "endLocal">;

function planLayover(ctx: Context, from: number, wakeBy: number, awakeHours: number, report: number, nextDutyEnd: number): PlannedBlock[] {
  const avail = wakeBy - from;
  if (avail < 25) return [];
  // Too short for a full cycle: a power nap, short enough to wake from cleanly.
  if (avail < CYCLE) {
    const len = Math.min(30, avail);
    return [{ kind: "nap", start: from, end: from + len, title: "Power nap", ease: easeOf(ctx, from, from + len), why: "Too short for a full sleep cycle: 20–30 minutes refreshes without the grogginess of waking from deep sleep." }];
  }
  // Short: sleep as soon as you're in, ending on a cycle so you wake cleanly.
  if (avail < 4.5 * 60) {
    const len = Math.floor(avail / CYCLE) * CYCLE;
    return [{ kind: "sleep", start: wakeBy - len, end: wakeBy, title: "Sleep", ease: easeOf(ctx, wakeBy - len, wakeBy), why: `A short rest: get to bed as soon as you can. ${len / CYCLE} full sleep ${len === CYCLE ? "cycle" : "cycles"} (${hoursText(len)}) ends you on a cycle boundary, so you wake less groggy.` }];
  }

  // Main sleeps: the best full night first, then any other body-clock night the layover covers.
  const mains: { start: number; end: number; ease: number }[] = [];
  const free: [number, number][] = [[from, wakeBy]];
  for (let guard = 0; guard < 4 && free.length; guard++) {
    let pick: { start: number; end: number; ease: number; slot: number } | null = null;
    free.forEach(([s, e], slot) => {
      let len = Math.min(FULL_SLEEP, e - s);
      if (len >= FULL_SLEEP && e - s >= 11 * 60) {
        const night = bestBlock(ctx, s, e, len);
        if (night && bodyNightMinutes(ctx, night.start, night.start + len) < 4 * 60) len = DAYTIME_CORE;
      }
      // A first main sleep can go anywhere it fits; later ones only into a stretch that really covers the body's night.
      if (len < 4.5 * 60 || (mains.length > 0 && bodyNightMinutes(ctx, s, e) < 4 * 60)) return;
      const b = bestBlock(ctx, s, e, len);
      if (b && (!pick || b.ease > pick.ease)) pick = { start: b.start, end: b.start + len, ease: b.ease, slot };
    });
    if (!pick) break;
    const { start, end, ease, slot } = pick as { start: number; end: number; ease: number; slot: number };
    mains.push({ start, end, ease });
    const [s, e] = free[slot];
    // Keep a few awake hours either side, so the next sleep has pressure behind it.
    free.splice(slot, 1, ...([[s, start - 6 * 60], [end + 6 * 60, e]] as [number, number][]).filter(([a, b]) => b - a >= 4.5 * 60));
  }
  mains.sort((a, b) => a.start - b.start);
  const blocks: PlannedBlock[] = mains.map((m) => ({
    kind: "sleep",
    start: m.start,
    end: m.end,
    title: "Main sleep",
    ease: m.ease,
    why:
      bodyNightMinutes(ctx, m.start, m.end) >= 5 * 60
        ? "Lines up with your body clock's night, so it's the easiest, deepest sleep you'll get here."
        : m.end - m.start <= DAYTIME_CORE
          ? "It's daytime to your body, and daytime sleep runs short — the body clock wakes you — so plan four full cycles now and top up with a nap before you go. Blackout curtains, a cool room and earplugs help."
          : "Your best chance at a full sleep in this layover — it's daytime to your body, so expect lighter sleep: blackout curtains, a cool room and earplugs help.",
  }));

  // After a long time awake (an all-nighter), or when the body-clock night is too far off to wait for, a recovery sleep on
  // arrival — kept to whole cycles, and well clear of the main sleep so the night still comes easily. Nobody should be
  // planned past ~18 hours awake.
  const firstMain = mains[0];
  const awakeAtMain = firstMain ? awakeHours + (firstMain.start - from) / 60 : 0;
  if (firstMain && firstMain.start - from >= 4.5 * 60 && (awakeHours >= HIGH_PRESSURE_HOURS || awakeAtMain >= MAX_AWAKE_HOURS)) {
    const wanted = awakeHours >= 20 ? 3 : awakeHours >= HIGH_PRESSURE_HOURS ? 2 : 1;
    for (let cycles = wanted; cycles >= 1; cycles--) {
      const len = cycles * CYCLE;
      if (from + len > firstMain.start - 4 * 60) continue;
      blocks.unshift({
        kind: "recovery",
        start: from,
        end: from + len,
        title: "Recovery sleep",
        ease: easeOf(ctx, from, from + len),
        why:
          awakeHours >= HIGH_PRESSURE_HOURS
            ? `You've been up about ${Math.round(awakeHours)} hours — sleep as soon as you're in. Keep it to ${hoursText(len)} (${cycles} full ${cycles === 1 ? "cycle" : "cycles"}) so you can still sleep properly in your body's night ("anchor sleep").`
            : `Your body's night is still ${Math.round((firstMain.start - from) / 60)} hours off — too long to stay up for. ${hoursText(len)} now (${cycles} full ${cycles === 1 ? "cycle" : "cycles"}) keeps you rested without spoiling the main sleep.`,
      });
      break;
    }
  }

  // Before a night departure: a nap that banks alertness for the body clock's low point — placed where sleep actually
  // comes (the afternoon dip, not the hours just before the body's bedtime), at least three hours after the main sleep.
  const lastMain = mains[mains.length - 1];
  const reportBody = mod(report + ctx.zOff + ctx.bodyAt(report));
  const fliesThroughNight = reportBody >= 19 * 60 || reportBody < 5 * 60 || bodyNightMinutes(ctx, report, nextDutyEnd) >= 2 * 60;
  if (fliesThroughNight && lastMain) {
    const after = lastMain.end + 3 * 60;
    const full = wakeBy - lastMain.end >= 6 * 60 ? bestBlock(ctx, after, wakeBy, CYCLE) : null;
    const power = !full || full.ease < 0.3 ? bestBlock(ctx, Math.max(after, wakeBy - 4 * 60), wakeBy, 30) : null;
    const nap = full && full.ease >= 0.3 ? { ...full, len: CYCLE } : power && power.ease >= 0.25 ? { ...power, len: 30 } : null;
    if (nap)
      blocks.push({
        kind: "preDuty",
        start: nap.start,
        end: nap.start + nap.len,
        title: nap.len === CYCLE ? "Pre-departure nap" : "Power nap before you go",
        ease: nap.ease,
        why:
          nap.len === CYCLE
            ? "Your next duty runs through your body clock's night. A planned nap beforehand — NASA's research found planned naps markedly improve pilots' alertness — banks sleep for its low point; one full cycle wakes you cleanly."
            : "Your next duty runs through your body clock's night: a 20–30 minute nap before you go lifts alertness without the grogginess of a longer one.",
      });
  }
  return blocks.sort((a, b) => a.start - b.start);
}
