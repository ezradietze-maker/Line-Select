import type { OpenTimeRow, OpenTimeSnapshot, OpenTimeSource, UnreadRow } from "@/lib/open-time/source";

/**
 * Reads an open-time list pasted from VIPS.
 *
 * NOBODY HAS SEEN A REAL ONE. Every format below is a made-up sample: a current pilot hasn't shown us the screen, so we
 * don't know its columns, its date format or how it marks a frozen trip. So this reads widely, believes only what a row
 * labels or a heading names, and hands back every row it couldn't read with the reason. A number it isn't sure of is kept
 * as a possibility for the pack to settle (see `OpenTimeRow.tripNumbers`), and a row nothing settles stays unread.
 *
 * Replace these guesses with the real format once a current pilot pastes one (private/plans/step-8-fedex-connection.md,
 * phase 1).
 */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MON = MONTHS.join("|");

/** Days in a month, February's leap day allowed: a row with no year might mean one. */
const realDate = (month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

const fullYear = (y: string | undefined) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : undefined);

type ReadDate = { month: number; day: number; year?: number };

/** Each way of writing a date: "2026-10-14"; "14OCT", "14 OCT 2026", "14OCT26"; "OCT 14", "October 14, 2026"; "10/14", "10/14/26". */
const DATE_FORMS: { re: RegExp; read: (m: RegExpMatchArray) => ReadDate }[] = [
  { re: /\b(20\d{2})-(\d{2})-(\d{2})\b/g, read: (m) => ({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }) },
  { re: new RegExp(`\\b(\\d{1,2})[ -]?(${MON})[A-Z]*(?:(\\d{2})|[ -](20\\d{2}))?\\b`, "gi"), read: (m) => ({ day: Number(m[1]), month: MONTHS.indexOf(m[2].toUpperCase()) + 1, year: fullYear(m[3] ?? m[4]) }) },
  { re: new RegExp(`\\b(${MON})[A-Z]*\\.?[ -]?(\\d{1,2})\\b(?:,? (20\\d{2})\\b)?`, "gi"), read: (m) => ({ month: MONTHS.indexOf(m[1].toUpperCase()) + 1, day: Number(m[2]), year: fullYear(m[3]) }) },
  { re: /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g, read: (m) => ({ month: Number(m[1]), day: Number(m[2]), year: fullYear(m[3]) }) },
];

/**
 * The dates in a line, in the order they're written. The first is the trip's; a second is its release, and goes unused.
 * Where two ways of reading overlap ("12 Oct 15" is "12 Oct" or "Oct 15"), the first one written wins and the other
 * goes. A four-digit "year" more than a year from now is a report time ("14OCT 2030"), left in the row.
 */
function datesIn(line: string, now = new Date()): { index: number; text: string; date: ReadDate }[] {
  const thisYear = now.getFullYear();
  const all = DATE_FORMS.flatMap(({ re, read }) =>
    [...line.matchAll(re)].map((m) => {
      const date = read(m);
      if (date.year !== undefined && Math.abs(date.year - thisYear) > 1 && /20\d{2}$/.test(m[0])) {
        return { index: m.index, text: m[0].replace(/[ ,-]*20\d{2}$/, ""), date: { ...date, year: undefined } };
      }
      return { index: m.index, text: m[0], date };
    })
  ).sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const kept: typeof all = [];
  for (const d of all) if (!kept.some((k) => d.index < k.index + k.text.length && k.index < d.index + d.text.length)) kept.push(d);
  return kept;
}

const DURATION = String.raw`\d{1,3}[:.]\d{1,2}|\d{1,4}`;

/** "12.5", "12:30", "1230": hours. A bare number with no separator of three or four digits is H:MM, the way times print on a pack. */
function hoursOf(text: string): number | undefined {
  const clock = text.match(/^(\d{1,3}):(\d{2})$/);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  if (text.includes(".")) return Number(text);
  if (text.length >= 3) {
    const minutes = Number(text.slice(-2));
    return minutes < 60 ? Number(text.slice(0, -2)) + minutes / 60 : undefined;
  }
  return Number(text);
}

const FIGURE = String.raw`\d{1,3}[:.]\d{1,2}`;
const FIGURE_LABELS = "CH|CR|CRED|CREDIT|TAFB";

/**
 * A labelled figure. A row writes its labels on one side of their figures, and which side it is decides "12:30 CH 48.5 TAFB"
 * against "CH 12.5 TAFB 48:30", so whichever comes first in the row settles it. A figure before its label has to look like
 * hours (12.5, 12:30, 12): "213 CH" is a trip number and a stray label.
 */
function labelledFigure(rest: string, label: string): { value: string; text: string } | null {
  const firstIsLabel = new RegExp(`\\b(?:${FIGURE_LABELS})\\b|${FIGURE}`, "i").exec(rest)?.[0].match(/^[a-z]/i);
  const m = firstIsLabel ? rest.match(new RegExp(`\\b(?:${label})\\b[\\s:=]*(${DURATION})\\b`, "i")) : rest.match(new RegExp(`(?<![\\d.:])(${FIGURE}|\\d{1,2})\\s*(?:${label})\\b`, "i"));
  return m ? { value: m[1], text: m[0] } : null;
}

const CREDIT = "CH|CR|CRED|CREDIT";
const TAFB = "TAFB";
const REPORT = /\b(?:RPT|RPRT|REPORT|SHOW(?:\s?TIME)?)\b[\s:=@]*(\d{1,2}):?(\d{2})[LZ]?\b/i;
const RELEASE = /\b(?:REL|RLS|RELEASE)\b[\s:=@]*\d{1,2}:?\d{2}[LZ]?\b/i;
const TRIP = /\b(?:TRIP|SEQ|SEQUENCE|PAIRING|PAIR|PRG)\b\s*(?:NO\.?|NUM(?:BER)?)?\s*[:#=]?\s*(\d{1,5})\b|#\s*(\d{1,5})\b/i;
const COUNTS = /\b\d{1,2}[ -]?(?:DAYS?|DY|DYS|LEGS?|LDGS?|LANDINGS?|DPS?|HRS?|HOURS?)\b/gi;
/** A time or a figure written so it can't be a trip number: 09:15, 12.5, 0915Z. */
const NOT_A_TRIP = /\b\d{1,3}:\d{2}\b|\b\d+\.\d+\b|\b\d{3,4}[LZ]\b/gi;
const STANDBY = /\b(?:BAS|BHS|STANDBY|STBY|SBY)\b/i;
/** A guess at how VIPS would show CBA 2026 25.G.2.b.iii. Unconfirmed. */
const FROZEN = /\b(?:FROZEN|FRZN|CRS ONLY)\b/i;

/** Could be a clock time: 0000–2359. Those come last among a row's possible trip numbers. */
const timeLike = (n: string) => n.length === 4 && Number(n.slice(0, 2)) < 24 && Number(n.slice(2)) < 60;

function readRow(raw: string, line: string): OpenTimeRow | UnreadRow {
  // A labelled trip number isn't a date's day: "Trip 12 Oct 15" is trip 12 on Oct 15, not trip 15 on Oct 12.
  const labelled = line.match(TRIP);
  const dates = datesIn(labelled ? line.replace(labelled[0], " ".repeat(labelled[0].length)) : line);
  const hasDigit = /\d/.test(line);
  if (STANDBY.test(line)) return { raw, why: "Looks like a standby. Only trips are scored so far." };
  if (!dates.length) return { raw, why: hasDigit ? "No date we could read." : "No trip number or date in it." };
  const { month, day, year } = dates[0].date;
  if (!realDate(month, day)) return { raw, why: `"${dates[0].text}" isn't a real date.` };

  let rest = line;
  for (const d of dates) rest = rest.replace(d.text, " ");
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], " ");
    return m;
  };
  const named = take(TRIP);
  const figure = (label: string) => {
    const f = labelledFigure(rest, label);
    if (f) rest = rest.replace(f.text, " ");
    return f;
  };
  const credit = figure(CREDIT);
  const tafb = figure(TAFB);
  const report = take(REPORT);
  take(RELEASE);
  rest = rest.replace(COUNTS, " ").replace(NOT_A_TRIP, " ");

  // Bare whole numbers only: not "FX1234", "MEM-123" or "0800-2000". A zero-led four digits is a time ("0915"), never a trip.
  const bare = [...rest.matchAll(/(?<![A-Za-z0-9\-/.:])\d{1,4}(?![A-Za-z0-9\-/.:])/g)].map((m) => m[0]).filter((n) => !(n.length === 4 && n.startsWith("0")));
  const numbers = named ? [named[1] ?? named[2]] : [...bare.filter((n) => !timeLike(n)), ...bare.filter(timeLike)];
  if (!numbers.length) return { raw, why: "No trip number we could read." };

  const creditHours = credit ? hoursOf(credit.value) : undefined;
  const tafbHours = tafb ? hoursOf(tafb.value) : undefined;
  return {
    raw,
    tripNumbers: [...new Set(numbers)],
    month,
    day,
    ...(year ? { year } : {}),
    ...(creditHours !== undefined ? { creditHours } : {}),
    ...(tafbHours !== undefined ? { tafbHours } : {}),
    ...(report ? { reportTime: `${report[1].padStart(2, "0")}${report[2]}` } : {}),
    ...(FROZEN.test(line) ? { frozen: true } : {}),
  };
}

type Column = "trip" | "date" | "report" | "credit" | "tafb" | null;

const columnOf = (cell: string): Column => {
  const c = cell.toUpperCase();
  if (/^(TRIP|SEQ|SEQUENCE|PAIRING|PAIR|PRG)\b/.test(c)) return "trip";
  if (/^(DATE|DEP|START|DAY)\b/.test(c)) return "date";
  if (/^(RPT|RPRT|REPORT|SHOW)/.test(c)) return "report";
  if (/^(CH|CR|CRED|CREDIT)\b/.test(c)) return "credit";
  if (/^TAFB\b/.test(c)) return "tafb";
  return null;
};

const cellsOf = (line: string) => {
  const wide = line.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean);
  return wide.length > 1 ? wide : line.split(/\s+/).filter(Boolean);
};

/** Column names, when a line is only that: at least two we know, and no figures. */
function headingOf(line: string): Column[] | null {
  if (/\d/.test(line)) return null;
  const columns = cellsOf(line).map(columnOf);
  return columns.filter(Boolean).length >= 2 ? columns : null;
}

/** A row under a heading, rewritten so each figure carries its column's label. Cells under a column we don't know are dropped. */
function underHeading(line: string, columns: Column[]): string | null {
  const cells = cellsOf(line);
  if (cells.length !== columns.length) return null;
  const label = { trip: "TRIP ", date: "", report: "RPT ", credit: "CH ", tafb: "TAFB " };
  return cells.flatMap((c, i) => (columns[i] ? [`${label[columns[i]!]}${c}`] : [])).join("  ");
}

export function parseOpenTimePaste(text: string): Pick<OpenTimeSnapshot, "rows" | "unread" | "headings"> {
  const rows: OpenTimeRow[] = [];
  const unread: UnreadRow[] = [];
  const headings: string[] = [];
  let columns: Column[] | null = null;
  for (const raw of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (/^[-=_*|+\s]+$/.test(raw)) continue;
    const heading = headingOf(raw);
    if (heading) {
      columns = heading;
      headings.push(raw);
      continue;
    }
    const line = (columns && underHeading(raw, columns)) ?? raw;
    // A row that matched its heading's columns but whose trip cell isn't a number falls back to reading the row as it is.
    let read = readRow(raw, line);
    if ("why" in read && line !== raw) read = readRow(raw, raw);
    if ("why" in read) unread.push(read);
    else rows.push({ ...read, ...(FROZEN.test(raw) ? { frozen: true } : {}) });
  }
  return { rows, unread, headings };
}

/** The list as a pilot pasted it, as a source. */
export function pasteSource(text: string, now: () => number = Date.now): OpenTimeSource {
  return { read: async () => pasteSnapshot(text, now()) };
}

export function pasteSnapshot(text: string, readAt: number = Date.now()): OpenTimeSnapshot {
  return { source: "paste", readAt, ...parseOpenTimePaste(text) };
}
