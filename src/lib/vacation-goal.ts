import { DateTime } from "luxon";
import { airportCityName, airportsByCityName } from "@/lib/airport-city-names";
import type { VacationAim, VacationGoal } from "@/lib/vacation-engine";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * What a pilot types in "What do you want from your vacation?", read into the aims the slide engine weighs
 * (`lib/vacation-engine.ts`). Read on the device first, so the common goals and the example chips answer at once; what it
 * can't read goes to a small model (`/api/vacation-goal`), which answers in the same terms (`GoalAim`).
 */

/** An aim as typed and as the model answers it: dates as "YYYY-MM-DD", cities as airport codes. */
export type GoalAim =
  | { kind: "credit" | "keep-bank" | "days-off" | "stretch" | "weekends" | "as-awarded" | "pay" }
  | { kind: "dates"; dates: string[] }
  | { kind: "keep" | "drop"; cities: string[] };

export const GOAL_KINDS = ["credit", "keep-bank", "days-off", "stretch", "weekends", "dates", "keep", "drop", "as-awarded", "pay"] as const;

/**
 * "Most pay" said without which kind: the pilot is asked (`PAY_CHOICES`) before it slides anything. Pay from a vacation
 * means one of two opposite things (the ex-pilot, Nov 26): the biggest trips taken off, paid from the bank and not flown
 * ("paid time off", `credit`), or every trip flown and the vacation put on days off, the bank kept for the year-end buyback,
 * so "they get paid for both" ("most money overall", `keep-bank`).
 */
export const PAY_CHOICES: { kind: "credit" | "keep-bank"; title: string; detail: string }[] = [
  { kind: "credit", title: "Paid time off", detail: "Your vacation takes off your biggest trips: paid from your bank, not flown." },
  { kind: "keep-bank", title: "Most money overall", detail: "Keep flying: your vacation goes on your days off, and your bank is kept for the buyback." },
];

export interface ReadGoal {
  aims: GoalAim[];
  /** Words it couldn't place: with these, or with nothing read, the small model reads it instead. */
  unread: string[];
}

/** The examples under the box, each read on the device. */
export const GOAL_EXAMPLES = ["Paid time off", "Most money overall", "Most days off", "Longest stretch at home", "Weekends off", "Leave it where it is"];

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/** The phrases for each simple aim, in the words pilots use. */
const SIMPLE: { kind: "credit" | "keep-bank" | "days-off" | "stretch" | "weekends" | "as-awarded" | "pay"; re: RegExp }[] = [
  { kind: "as-awarded", re: /\b(leave it where it is|leave it alone|leave it|where it is|don'?t (move|slide)|no slide|as awarded|as it was awarded|keep it where)\b/ },
  { kind: "keep-bank", re: /\b((keep|save|protect|preserve|hold on to)\s+(my\s+)?(vacation\s+)?bank|least credit|use (the )?least|keep (my )?flying|min(imum|imi[sz]e)?\s+(my\s+)?credit|(work|fly)( as)? (much|many hours) as (i can|possible)|(work|fly) (the )?most|(work|fly) more|most flying|as little (time )?off( as (i can|possible))?|(most|max(imum)?|more) (money|pay) overall|buy ?backs?|paid (for )?both|get paid twice|de-?conflict)\b/ },
  { kind: "credit", re: /\b(paid time off|max(imum|imi[sz]e|ing)?( out)?( my)?( the)? (credit|ch|hours)|most (credit|ch|hours)|biggest trips?|cover (the )?(most|biggest|big)|more credit|knock(ing)? out( the)?( most| biggest)?( flying| trips?| credit| hours)?|paid not to fly|get paid (not to fly|for not flying))\b/ },
  // Pay without saying which kind: asked (see `PAY_CHOICES`).
  { kind: "pay", re: /\b(max(imum|imi[sz]e|ing)?( out)?( my)?( the)? (pay|money)|most (pay|money)|more (pay|money)|get paid|pay ?max|make (the )?most money)\b/ },
  { kind: "stretch", re: /\b((longest|longer)( (stretch|block|run|break))?( (of days )?(off|at home|home))?|(days )?in a row|consecutive( days)?|block of (days )?off|stretch( (off|at home|home))?|straight days)\b/ },
  { kind: "weekends", re: /\bweekends?\b/ },
  { kind: "days-off", re: /\b((most|max(imum|imi[sz]e)?|more) (days|time) (off|at home|home)|days off|time off|time at home|at home|be home|home more)\b/ },
];

/** Words that say nothing about the goal: left over, they don't send it to the model. */
const FILLER = new Set(
  "i want my the a an to be and then but also with of on in for it its please would like as much possible get have want most more max out so that is are all any just only really very do my vacation vac trips trip flying off at home days day time can could i'd as many keep need still otherwise while also".split(" ")
);

/** The bid month's days, Sep 28 to Oct 25 and on to the strip's end, by month and day: where "Oct 31" or "the 24th" falls. */
function dayIndexOf(pack: Pick<BidPack, "bidPeriodStart" | "bidPeriodDays">, month: number | null, day: number): number | null {
  if (!pack.bidPeriodStart) return null;
  const start = DateTime.fromISO(pack.bidPeriodStart, { zone: "utc" });
  // The bid month and a week either side: a vacation can slide 5 days past it.
  for (let i = -7; i < pack.bidPeriodDays + 7; i++) {
    const d = start.plus({ days: i });
    if (d.day === day && (month === null || d.month === month)) return i;
  }
  return null;
}

const isoOf = (pack: Pick<BidPack, "bidPeriodStart">, index: number) => DateTime.fromISO(pack.bidPeriodStart!, { zone: "utc" }).plus({ days: index }).toISODate()!;

/** Holidays a pilot might name, as "MM-DD" (Thanksgiving: the fourth Thursday of November). */
function holiday(name: string, year: number): string | null {
  const nov1 = DateTime.utc(year, 11, 1);
  const thanksgiving = nov1.plus({ days: ((4 - nov1.weekday + 7) % 7) + 21 }).toFormat("MM-dd");
  const by: Record<string, string> = { thanksgiving, "christmas eve": "12-24", christmas: "12-25", "new year's eve": "12-31", "new years eve": "12-31", "new year's": "01-01", "new years": "01-01", halloween: "10-31", "fourth of july": "07-04", "july 4th": "07-04", "4th of july": "07-04" };
  return by[name] ?? null;
}

/** Dates a pilot named, as day indices of the bid month: "Oct 31", "Oct 20-24", "the 24th", "Halloween". */
function readDates(text: string, pack: Pick<BidPack, "bidPeriodStart" | "bidPeriodDays">): { days: number[]; spans: [number, number][] } {
  const days: number[] = [];
  const spans: [number, number][] = [];
  const year = pack.bidPeriodStart ? DateTime.fromISO(pack.bidPeriodStart).year : new Date().getFullYear();
  const range = new RegExp(`\\b${MONTH_RE}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to|through|thru)\\s*(?:${MONTH_RE}\\.?\\s*)?(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g");
  for (const m of text.matchAll(range)) {
    const from = dayIndexOf(pack, MONTHS[m[1].slice(0, 3)] ?? MONTHS[m[1].slice(0, 4)], Number(m[2]));
    const to = dayIndexOf(pack, MONTHS[(m[3] ?? m[1]).slice(0, 3)] ?? null, Number(m[4]));
    if (from !== null && to !== null && to >= from && to - from < 40) for (let d = from; d <= to; d++) days.push(d);
    spans.push([m.index!, m.index! + m[0].length]);
  }
  const single = new RegExp(`\\b${MONTH_RE}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b|\\bthe\\s+(\\d{1,2})(?:st|nd|rd|th)\\b`, "g");
  for (const m of text.matchAll(single)) {
    if (spans.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    const month = m[1] ? MONTHS[m[1].slice(0, 3)] : m[4] ? MONTHS[m[4].slice(0, 3)] : null;
    const day = Number(m[2] ?? m[3] ?? m[5]);
    const d = dayIndexOf(pack, month, day);
    if (d !== null) days.push(d);
    spans.push([m.index!, m.index! + m[0].length]);
  }
  for (const name of ["thanksgiving", "christmas eve", "christmas", "new year's eve", "new years eve", "new year's", "new years", "halloween", "fourth of july", "4th of july", "july 4th"]) {
    const at = text.indexOf(name);
    if (at < 0 || spans.some(([a, b]) => at >= a && at < b)) continue;
    const mmdd = holiday(name, year);
    const d = mmdd ? dayIndexOf(pack, Number(mmdd.slice(0, 2)), Number(mmdd.slice(3))) : null;
    if (d !== null) days.push(d);
    spans.push([at, at + name.length]);
  }
  return { days: [...new Set(days)].sort((a, b) => a - b), spans };
}

/** Cities a pilot named, by code or name, that the pack lays over in: each with whether they want its trips kept or taken. */
function readCities(text: string, original: string, cities: string[]): { keep: string[]; drop: string[]; spans: [number, number][] } {
  const byName = airportsByCityName();
  const known = new Set(cities);
  const keep: string[] = [];
  const drop: string[] = [];
  const spans: [number, number][] = [];
  const found: { code: string; at: number; end: number }[] = [];
  for (const m of original.matchAll(/\b[A-Z]{3}\b/g)) if (known.has(m[0])) found.push({ code: m[0], at: m.index!, end: m.index! + 3 });
  for (const [name, code] of byName) {
    if (!known.has(code) || name.length < 4) continue;
    const at = text.indexOf(name);
    // A whole word: "oakland", not inside another one.
    if (at >= 0 && !/[a-z]/.test(text[at - 1] ?? "") && !/[a-z]/.test(text[at + name.length] ?? "") && !found.some((f) => f.code === code)) found.push({ code, at, end: at + name.length });
  }
  for (const f of found.sort((a, b) => a.at - b.at)) {
    // The words just before it say which: "keep my Honolulu trips", "get rid of the Guangzhou trip".
    const before = text.slice(Math.max(0, f.at - 30), f.at);
    const dropping = /\b(avoid|drop|skip|lose|cover|take off|get rid of|get out of|no|not|without|off|hate|miss)\b[^,;]*$/.test(before);
    (dropping ? drop : keep).push(f.code);
    spans.push([f.at, f.end]);
  }
  return { keep, drop, spans };
}

/**
 * The goal read on the device. Specific asks (dates off, trips kept or taken) come first — "most credit, but keep the
 * 24th off" means the 24th off whatever it costs — then the rest in the order typed.
 */
export function readGoalText(original: string, pack: Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "lines">): ReadGoal {
  const text = original.toLowerCase().replace(/[’`]/g, "'");
  const layoverCities = [...new Set(pack.lines.flatMap((l) => l.trips.flatMap((t) => t.layoverCities ?? [])))];
  const dates = readDates(text, pack);
  const cities = readCities(text, original, layoverCities);
  const specific: GoalAim[] = [];
  if (dates.days.length && pack.bidPeriodStart) specific.push({ kind: "dates", dates: dates.days.map((d) => isoOf(pack, d)) });
  if (cities.keep.length) specific.push({ kind: "keep", cities: cities.keep });
  if (cities.drop.length) specific.push({ kind: "drop", cities: cities.drop });
  const found = SIMPLE.flatMap((s) => {
    const m = s.re.exec(text);
    return m ? [{ kind: s.kind, at: m.index, end: m.index + m[0].length }] : [];
  });
  // "Days off" said as part of "weekend days off", "a stretch at home" or "paid time off" is that, not a goal of its own;
  // and pay said as "most money overall", "paid time off" or "get paid not to fly" is that kind of pay: read, but not twice.
  const near = (a: { at: number; end: number }, b: { at: number; end: number }, by: number) => a.at < b.end + by && b.at < a.end + by;
  const simple = found
    .filter((s, _, all) => !(s.kind === "days-off" && all.some((o) => (o.kind === "weekends" || o.kind === "stretch") && near(s, o, 12))))
    .filter((s, _, all) => !(s.kind === "days-off" && all.some((o) => o.kind === "credit" && near(s, o, 0))))
    .filter((s, _, all) => !(s.kind === "pay" && all.some((o) => (o.kind === "credit" || o.kind === "keep-bank") && near(s, o, 0))))
    // "Knock out the most flying" takes the flying off: it isn't "the most flying" kept.
    .filter((s, _, all) => !(s.kind === "keep-bank" && all.some((o) => o.kind === "credit" && o.at <= s.at && o.end >= s.end)))
    .sort((a, b) => a.at - b.at);
  const covered = [...dates.spans, ...cities.spans, ...found.map((s) => [s.at, s.end] as [number, number])];
  const unread = [...text.matchAll(/[a-z']+/g)].filter((m) => !covered.some(([a, b]) => m.index! >= a && m.index! < b) && !FILLER.has(m[0])).map((m) => m[0]);
  const aims: GoalAim[] = [...specific, ...simple.map((s) => ({ kind: s.kind }) as GoalAim)];
  // "Leave it where it is" with anything else: the anything else.
  const kept = aims.length > 1 ? aims.filter((a) => a.kind !== "as-awarded") : aims;
  return { aims: kept.filter((a, i) => kept.findIndex((b) => b.kind === a.kind) === i), unread };
}

/** The aims the engine weighs, on this pack's days. */
export function toEngineGoal(aims: GoalAim[], pack: Pick<BidPack, "bidPeriodStart">): VacationGoal {
  const start = pack.bidPeriodStart ? DateTime.fromISO(pack.bidPeriodStart, { zone: "utc" }) : null;
  return {
    aims: aims.flatMap((a): VacationAim[] => {
      if (a.kind === "dates") return start ? [{ kind: "dates", days: a.dates.map((d) => Math.round(DateTime.fromISO(d, { zone: "utc" }).diff(start, "days").days)) }] : [];
      if (a.kind === "keep" || a.kind === "drop") return [{ kind: a.kind, cities: a.cities }];
      // Not yet answered which kind of pay: nothing to slide by until it is.
      if (a.kind === "pay") return [];
      return [{ kind: a.kind }];
    }),
  };
}

/**
 * Measures that say what a pilot would want from a vacation, and which way: a pilot who wants more days off wants the
 * vacation where it frees the most days, one who wants more credit wants to keep flying. Credit wanted means the most
 * money overall, not paid time off: a pilot after high-credit lines wants the flying and the buyback.
 */
const FROM_PRIORITY: { metric: string; wants: "more" | "less"; kind: "days-off" | "stretch" | "weekends" | "keep-bank" | "dates" }[] = [
  { metric: "requestedDatesWorked", wants: "less", kind: "dates" },
  { metric: "daysOff", wants: "more", kind: "days-off" },
  { metric: "nightsHome", wants: "more", kind: "days-off" },
  { metric: "homeDepartures", wants: "less", kind: "days-off" },
  { metric: "workDays", wants: "less", kind: "days-off" },
  { metric: "tripCount", wants: "less", kind: "days-off" },
  { metric: "homeAwayHours", wants: "less", kind: "days-off" },
  { metric: "creditHours", wants: "less", kind: "days-off" },
  { metric: "longestDaysOffBlock", wants: "more", kind: "stretch" },
  { metric: "longestHomeStretch", wants: "more", kind: "stretch" },
  { metric: "singleDaysOff", wants: "less", kind: "stretch" },
  { metric: "weekendDaysOff", wants: "more", kind: "weekends" },
  { metric: "creditHours", wants: "more", kind: "keep-bank" },
];

/**
 * What a pilot who hasn't said what they want from their vacation would want, read from their interview: the aims their
 * own priorities point to, most weighted first (up to three). With none of them, the most days off — what most pilots
 * use a vacation for, "some extra time off with pay" (the ex-pilot, Nov 26). Each line's vacation slides by this until
 * the pilot types their own, or moves it on a line.
 */
export function guessVacationGoal(model: Pick<PilotModel, "criteria"> | null | undefined): GoalAim[] {
  const aims: GoalAim[] = [];
  const byWeight = [...(model?.criteria ?? [])].filter((c) => c.weight > 0).sort((a, b) => b.weight - a.weight);
  for (const c of byWeight) {
    const wants = c.shape.kind === "more" ? "more" : c.shape.kind === "less" || c.shape.kind === "perOccurrence" ? "less" : null;
    const found = wants && FROM_PRIORITY.find((f) => f.metric === c.metric && f.wants === wants);
    if (!found || aims.some((a) => a.kind === found.kind)) continue;
    if (found.kind === "dates") {
      const dates = (c.params?.dates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
      if (dates.length) aims.push({ kind: "dates", dates });
    } else aims.push({ kind: found.kind });
    if (aims.length === 3) break;
  }
  return aims.length ? aims : [{ kind: "days-off" }];
}

/** One aim in a pilot's words, for "Read as". */
export function aimLabel(a: GoalAim): string {
  const place = (codes: string[]) => codes.map((c) => airportCityName(c) ?? c).join(" and ");
  switch (a.kind) {
    case "credit":
      return "Paid time off: your biggest trips under your vacation";
    case "keep-bank":
      return "Most money overall: keep flying, keep your bank";
    case "pay":
      return "Which kind of pay?";
    case "days-off":
      return "Most days off";
    case "stretch":
      return "Longest stretch off";
    case "weekends":
      return "Most weekend days off";
    case "as-awarded":
      return "Where the pack has it";
    case "dates":
      return `Off ${a.dates.map((d) => DateTime.fromISO(d).toFormat("LLL d")).join(", ")}`;
    case "keep":
      return `Keep your ${place(a.cities)} trips`;
    case "drop":
      return `Vacation over your ${place(a.cities)} trips`;
  }
}

/**
 * The model's reading with what the device found in the same words: a date or a city the device read is one the pilot
 * said, so it's kept even if the model's answer let it go — first, as specific asks go.
 */
export function withDeviceReading(model: GoalAim[], device: GoalAim[]): GoalAim[] {
  const specific = device.filter((a) => (a.kind === "dates" || a.kind === "keep" || a.kind === "drop") && !model.some((m) => m.kind === a.kind));
  return [...specific, ...model];
}

/** A model's answer checked: known kinds only, real dates, codes the pack has; nothing else gets through. */
export function cleanAims(raw: unknown, pack: Pick<BidPack, "lines">): GoalAim[] {
  if (!Array.isArray(raw)) return [];
  const cities = new Set(pack.lines.flatMap((l) => l.trips.flatMap((t) => t.layoverCities ?? [])));
  const out: GoalAim[] = [];
  for (const r of raw.slice(0, 6)) {
    if (!r || typeof r !== "object") continue;
    const kind = (r as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !(GOAL_KINDS as readonly string[]).includes(kind) || out.some((a) => a.kind === kind)) continue;
    if (kind === "dates") {
      const dates = ((r as { dates?: unknown }).dates as unknown[] | undefined)?.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) ?? [];
      if (dates.length) out.push({ kind, dates: dates.slice(0, 40) });
    } else if (kind === "keep" || kind === "drop") {
      const codes = ((r as { cities?: unknown }).cities as unknown[] | undefined)?.filter((c): c is string => typeof c === "string" && cities.has(c.toUpperCase())).map((c) => c.toUpperCase()) ?? [];
      if (codes.length) out.push({ kind, cities: codes.slice(0, 10) });
    } else out.push({ kind } as GoalAim);
  }
  return out;
}
