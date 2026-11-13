import { DOCS, NODES, ancestorsOf, childrenOf, contractNode, findNode, fullText, versionText } from "./index";
import { LINE_NOT_IN_PACK } from "./pack-facts";
import { applicabilityOf, PHASE_STARTS } from "./phases";
import type { ContractVersion } from "./types";

/**
 * The hard rule of the contract box: no made-up section, no misquote, enforced here and not left to the model. Every
 * section number must exist in the index, every quote must be in that section word for word, every number in the
 * short answer must come from the quotes or from what the pilot's own pack says of the line or trip it's said of, and
 * every month, date and phase must be when a quoted rule starts. Anything else turns into "not found".
 *
 * What it can't catch: it checks sections, quotes, numbers and dates, not what the words around them say. "May"
 * turned into "may not", a "not" taken out, or hours swapped for days all pass, as long as the numbers stay backed.
 * The quotes shown under the answer are the guarantee; the short answer's meaning is not.
 */

export interface RawAnswer {
  found: boolean;
  answer: string;
  quotes: { section: string; quote: string; version: ContractVersion }[];
}

export type Verdict =
  | { ok: true; answer: string; quotes: { section: string; quote: string; version: ContractVersion }[] }
  | { ok: false; reason: string };

/** The PDF's typography read as plain keys, with every run of spacing one space. */
function plainText(text: string): string {
  return text
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Same words, same order: only spacing and the PDF's typography can differ. */
export function normalizeForMatch(text: string): string {
  return plainText(text).replace(/ /g, "");
}

/** Whether the two sides of a boundary are one number: "3|0", "9|:30", "2.|25", "1|,000". A space between them ends it. */
function joinsANumber(left: string, right: string): boolean {
  const d = /\d/;
  const l = left.slice(-1);
  const r = right[0] ?? "";
  return (d.test(l) && d.test(r)) || (d.test(l) && /^[.:,]\d/.test(right)) || (/\d[.:,]$/.test(left) && d.test(r));
}

/**
 * Where a section's text holds the quote word for word, with no number cut in two at either end, as the text writes
 * it; null when it doesn't. Matched anywhere, "…in writing at least 3" was found inside "at least 30 days", and its 3
 * then backed an answer of "3 days". The words are matched with all spacing taken out, since the PDF breaks lines
 * inside words and numbers ("202 6"), but the ends are tested with the spacing kept: without it the cells of a pay
 * table ran into one long number, and every quote that began or ended on a cell counted as cut.
 */
export function quotedSpan(text: string, quote: string): string | null {
  const wanted = normalizeForMatch(quote);
  if (!wanted || !normalizeForMatch(text).includes(wanted)) return null;
  const spaced = plainText(text);
  // Where each letter of the spaceless text sits in the spaced one.
  const at: number[] = [];
  for (let i = 0; i < spaced.length; i++) if (spaced[i] !== " ") at.push(i);
  const hay = at.map((i) => spaced[i]).join("");
  for (let from = hay.indexOf(wanted); from >= 0; from = hay.indexOf(wanted, from + 1)) {
    const start = at[from];
    const end = at[from + wanted.length - 1] + 1;
    const cutBefore = joinsANumber(spaced.slice(Math.max(0, start - 2), start), spaced.slice(start, start + 2));
    const cutAfter = joinsANumber(spaced.slice(Math.max(0, end - 2), end), spaced.slice(end, end + 2));
    if (!cutBefore && !cutAfter) return spaced.slice(start, end);
  }
  return null;
}

export function holdsQuote(text: string, quote: string): boolean {
  return quotedSpan(text, quote) !== null;
}

/** Fewer words than this prove nothing by being found ("SMU", "New Year's Day"), so they're left out, not trusted. */
const MIN_QUOTE_WORDS = 4;

/** Section numbers as a sentence would write them: 25.E.6, 25.A.7.b.i.(c), Section 13. */
const SECTION_REF = /\b\d{1,2}\.[A-Z]{1,2}(?:\.(?:\([a-z0-9]+\)|[a-z0-9]+))*(?:\([a-z0-9]+\))*/g;
const BARE_SECTION = /\bSection\s+(\d{1,2})\b(?!\.[A-Z])/g;
/**
 * A number as written in a contract or an answer: 115, 9:30, 1700, 2.25, 60,000. Thousands are read whole, so
 * "60000" is the same claim as "60,000", and "60,000" no longer backs an answer of "60".
 */
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|\d+(?::\d+|\.\d+)*/g;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/**
 * "One" that counts nothing: "no one can drop…", "one another", "one of these holidays" (a list the answer just gave),
 * "not this one." (standing for a thing named before). Only these: "the one day" and "only one of your vacations" are
 * counts, and passed unbacked when every "the one" and "one of" was let off.
 */
const ONE_AS_A_WORD =
  /\bno[- ]one\b|\b(?:any|every|some)one\b|\bone another\b|(?<!\b(?:only|just|exactly|least|most|than|to|but) )\bone of (?:these|those|them|the following|the listed)\b|\b(?:the|this|that|each|which) one(?=\s*(?:[.,;:!?)]|$))/gi;
const SPELLED = new RegExp(`\\b(?:(${TENS.slice(2).join("|")})(?:[- ](${ONES.slice(1, 10).join("|")}))?|(${ONES.join("|")}))\\b`, "gi");

/**
 * Every number a text holds, written in digits or in words: the contract writes "twelve (12)", and an answer saying
 * "twelve hours" makes the same claim as "12 hours" — it has to be backed the same way.
 */
function numbersIn(text: string): string[] {
  const spelled = [...text.replace(ONE_AS_A_WORD, " ").matchAll(SPELLED)].map((m) =>
    m[3] !== undefined ? String(ONES.indexOf(m[3].toLowerCase())) : String(TENS.indexOf(m[1].toLowerCase()) * 10 + (m[2] ? ONES.indexOf(m[2].toLowerCase()) : 0))
  );
  return [...(text.match(NUMBER) ?? []).map((n) => n.replace(/,/g, "")), ...spelled];
}

/** "9 hours 30 minutes", "1 hour and 15 mins": one length of time, which a contract may write as 9:30 or 9.5 hours. */
const HOURS_AND_MINUTES = /\b(\d{1,3}) (?:hours?|hrs?),?(?: and)? (\d{1,2}) (?:minutes?|mins?)\b/gi;
/** Hours the contract writes with a decimal: "9.5 hours". Only these back a length of time written in minutes. */
const DECIMAL_HOURS = /\b(\d+\.\d+) ?(?:hours?|hrs?)\b/gi;

/**
 * Takes out each length of time the quotes or facts hold whole, as H:MM or as decimal hours, so "9 hours 30 minutes"
 * passes against "9:30" without its 9 and 30 having to be there apart. One that isn't held whole is left as it was
 * and its numbers checked one by one, so nothing a quote doesn't back gets through.
 */
function dropHeldLengths(text: string, allowed: Set<string>, decimalHours: Set<string>): string {
  return text.replace(HOURS_AND_MINUTES, (all, h: string, m: string) => {
    const minutes = Number(m);
    if (minutes >= 60) return all;
    const hundredths = Number(h) * 100 + (minutes * 100) / 60;
    const decimal = Number.isInteger(hundredths) ? String(hundredths / 100) : null;
    return allowed.has(`${Number(h)}:${m.padStart(2, "0")}`) || (decimal !== null && decimalHours.has(decimal)) ? " " : all;
  });
}

/** The deepest piece whose words hold the quote, so a quote cited to 25.E lands on 25.E.6. */
export function narrowestPiece(id: string, quote: string, version: ContractVersion): string {
  for (const child of childrenOf(id)) {
    if (holdsQuote(fullText(child.id, version), quote)) return narrowestPiece(child.id, quote, version);
  }
  return id;
}

/** Where a quote's words really are, to tell the model when it mislabels one. It never changes a label itself: words the model took for the current rule may be a deleted one. */
export function whereIsQuote(quote: string): { section: string; version: ContractVersion } | null {
  for (const n of NODES) {
    for (const version of ["2026", "2015"] as const) {
      if (holdsQuote(versionText(n, version), quote)) return { section: n.id, version };
    }
  }
  return null;
}

/**
 * `bidMonth` is the bid period the question is about ("2026-11"); an answer may name it. Without it, only the months
 * the quoted rules start in may be named.
 */
export function validateAnswer(raw: RawAnswer, context: { question: string; facts?: string; bidMonth?: string }): Verdict {
  if (!raw.found) return { ok: false, reason: "the model found nothing" };
  if (!raw.answer.trim()) return { ok: false, reason: "empty answer" };
  if (!raw.quotes.length) return { ok: false, reason: "an answer with no quote" };

  const quotes: { section: string; quote: string; version: ContractVersion }[] = [];
  // The numbers each quote holds, as the contract itself writes them: the match ignores spacing, so a quote that ran two
  // cells of a pay table together ("5 433.94" as "5433.94") would otherwise back a number no cell holds.
  const quotedNumbers: string[] = [];
  for (const q of raw.quotes) {
    const node = findNode(q.section);
    if (!node) return { ok: false, reason: `no section ${q.section}` };
    const span = quotedSpan(fullText(node.id, q.version), q.quote);
    if (span === null) {
      const actually = whereIsQuote(q.quote);
      const hint = actually ? ` Those words are in the ${actually.version} wording of ${actually.section}.` : "";
      return { ok: false, reason: `not word for word in ${node.id} (${q.version}): "${q.quote.slice(0, 80)}".${hint}` };
    }
    if (q.quote.trim().split(/\s+/).length < MIN_QUOTE_WORDS) continue;
    quotes.push({ section: narrowestPiece(node.id, q.quote, q.version), quote: q.quote.trim(), version: q.version });
    const written = new Set(numbersIn(span));
    quotedNumbers.push(...numbersIn(q.quote).filter((n) => written.has(n)));
  }
  if (!quotes.length) return { ok: false, reason: "no quote long enough to check" };

  // A section named in the answer must be a piece a quote landed on, one above it, or one the quoted words themselves
  // name ("…as provided in Section 12.C."). Taken from the model's own labels, any piece under a label passed: a quote
  // labelled 25.G.3.b let the answer send the pilot to 25.G.3.b.vii, which holds none of it.
  const cited = quotes.flatMap((q) => (q.quote.match(SECTION_REF) ?? []).flatMap((ref) => findNode(ref)?.id ?? []));
  const landed = [...quotes.map((q) => q.section), ...cited];
  const holdsPartOf = (id: string) => {
    const node = contractNode(id);
    return quotes.some((q) => {
      const own = node ? normalizeForMatch(versionText(node, q.version)) : "";
      return !!own && id.startsWith(`${q.section}.`) && normalizeForMatch(q.quote).includes(own);
    });
  };
  for (const ref of raw.answer.match(SECTION_REF) ?? []) {
    const node = findNode(ref);
    if (!node) return { ok: false, reason: `the answer names ${ref}, which doesn't exist` };
    if (!landed.some((s) => s === node.id || s.startsWith(`${node.id}.`)) && !holdsPartOf(node.id)) {
      return { ok: false, reason: `the answer names ${node.id} but quotes nothing from it. Quote it, or leave its name out` };
    }
  }
  for (const m of raw.answer.matchAll(BARE_SECTION)) {
    if (!DOCS.some((d) => d.id === m[1])) return { ok: false, reason: `the answer names Section ${m[1]}, which we don't have` };
  }

  // When the quoted rules start, from the implementation chart: "starts by the December 2026 bid period" turned into
  // "December 2027" or "March 2026" passed, since every year was let through and every "Phase N" taken out unread.
  // Every piece a quote is cited to counts here, even one too short to back a number: "SMU" as one item of a list is
  // still the piece whose start the answer gives.
  const short = raw.quotes.filter((q) => q.quote.trim().split(/\s+/).length < MIN_QUOTE_WORDS);
  const when = datesHeld([...quotes, ...short.map((q) => ({ section: narrowestPiece(findNode(q.section)!.id, q.quote, q.version), quote: q.quote }))], context.bidMonth);
  let words = raw.answer.replace(SECTION_REF, " ").replace(BARE_SECTION, " ");
  for (const m of words.matchAll(DATED)) {
    const [said, month, day, year] = m;
    if (!year && !(month === "June" && day === "29")) continue;
    const ym = `${year ?? "2026"}-${String(MONTH_NAMES.indexOf(month) + 1).padStart(2, "0")}`;
    if (day ? when.days.has(`${ym}-${day.padStart(2, "0")}`) : when.months.has(ym)) continue;
    return { ok: false, reason: `the answer says ${said}, which isn't when the quoted rules start or the bid period asked about. Give the start each quoted section's notes give, or leave the date out` };
  }
  for (const m of words.matchAll(PHASE)) {
    if (!when.phases.has(Number(m[1]))) return { ok: false, reason: `the answer says ${m[0]}, but no quoted section is in ${m[0]}. Give the phase each quoted section's notes give, or leave it out` };
  }
  words = words.replace(DATED, (said, month: string, day?: string, year?: string) => (year || (month === "June" && day === "29") ? " " : said)).replace(PHASE, " ");
  // A reserve status is a name, not a count, when the contract writes it: "R-24" says nothing about 24 hours.
  const statuses = reserveStatusesHeld(raw.quotes, quotes);
  words = words.replace(RESERVE_STATUS, (s) => (statuses.has(s.toUpperCase()) ? " " : s));

  // Nothing comes from the question itself: any number in it let "Is minimum rest 8 hours?" have its 8 confirmed
  // against a quote that says 9:30, and even its line and trip numbers did ("Do trips 3 days long count?" backed "3
  // days", "begin at 1800?" backed 1800). A line or trip the question names counts only once the pack facts, worked
  // out from the pilot's own pack, show it's really there: "Line 1800 isn't in this pack" backs no 1800.
  // The years that name the versions are let through: "the 2026 wording".
  const backed = new Set(["2015", "2026", "2027", ...quotedNumbers]);
  const quotedHours = decimalHoursIn(quotes.map((q) => q.quote), backed);
  const facts = packFactsOf(context.facts ?? "");
  // A pack's figure backs only what's said of its own line or trip: "Line 1001 has 15 days off" let "the contract
  // requires at least 15 days off" through in the next sentence, a claim about the contract no quote made.
  for (const clause of clausesOf(words)) {
    const named = idsNamed(clause);
    const mine = facts.filter((f) => [...f.owners].some((o) => named.has(o)));
    const allowed = new Set([...backed, ...mine.flatMap((f) => f.numbers)]);
    const hours = new Set([...quotedHours, ...decimalHoursIn(mine.map((f) => f.text), allowed)]);
    for (const n of numbersIn(dropHeldLengths(clause, allowed, hours))) {
      if (allowed.has(n)) continue;
      if (facts.some((f) => f.numbers.includes(n))) {
        return { ok: false, reason: `the answer says ${n} where it doesn't name the line or trip of the pilot's pack that has it. A pack's figure can't back what the contract says: quote the contract's words that hold ${n}, or say ${n} only of that line or trip` };
      }
      return { ok: false, reason: `the answer says ${n}, which isn't in the quotes. Quote the contract's words that hold ${n}, or leave ${n} out of the answer` };
    }
  }
  return { ok: true, answer: raw.answer.trim(), quotes };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "December 2026", "June 29, 2026", "June 29": a month, maybe a day, maybe a year. */
const DATED = new RegExp(`\\b(${MONTH_NAMES.join("|")})(?: (\\d{1,2}))?(?:,? (\\d{4}))?\\b`, "g");
const PHASE = /\bPhase ([1-4])\b/g;
/** R-24, R-1.5, RP-24: a reserve status's name. */
const RESERVE_STATUS = /\bRP?-\d+(?:\.\d+)?(?![\d.]*\d)/gi;

/**
 * The months, days and phases the quoted sections start in, per the implementation chart (CBA 2026 Implementation LOA,
 * Appendix A), plus the bid period asked about and any dates the quotes write out. A change the chart doesn't list
 * takes the Agreement's general effective date, June 29, 2026.
 */
function datesHeld(quotes: { section: string; quote: string }[], bidMonth: string | undefined) {
  const months = new Set<string>(bidMonth ? [bidMonth] : []);
  const days = new Set<string>();
  const phases = new Set<number>();
  const start = (phase: 1 | 2 | 3 | 4) => {
    phases.add(phase);
    months.add(PHASE_STARTS[phase].month);
  };
  const effective = () => {
    months.add("2026-06");
    days.add("2026-06-29");
  };
  for (const q of quotes) {
    const a = applicabilityOf(q.section, bidMonth ?? "2026-06");
    if (a.kind === "scheduled") {
      start(a.phase);
      if (a.manual || a.phase === 1) effective();
    } else if (a.kind === "mixed") {
      for (const p of a.phases) {
        start(p.phase);
        if (p.phase === 1) effective();
      }
    } else if (a.kind === "unlisted") effective();
    for (const m of q.quote.matchAll(DATED)) {
      const [, month, day, year] = m;
      if (!year) continue;
      const ym = `${year}-${String(MONTH_NAMES.indexOf(month) + 1).padStart(2, "0")}`;
      months.add(ym);
      if (day) days.add(`${ym}-${day.padStart(2, "0")}`);
    }
    for (const m of q.quote.matchAll(PHASE)) phases.add(Number(m[1]));
  }
  return { months, days, phases };
}

/** The reserve statuses the quoted pieces, the headings above them and the passages they were cited from write. */
function reserveStatusesHeld(raw: RawAnswer["quotes"], quotes: { section: string; quote: string; version: ContractVersion }[]): Set<string> {
  const texts = [
    ...quotes.map((q) => q.quote),
    ...raw.flatMap((q) => (findNode(q.section) ? [fullText(findNode(q.section)!.id, q.version)] : [])),
    ...quotes.flatMap((q) => ancestorsOf(q.section).map((n) => versionText(n, q.version))),
  ];
  return new Set(texts.flatMap((t) => (t.replace(/[‐‑‒–—−]/g, "-").match(RESERVE_STATUS) ?? []).map((s) => s.toUpperCase())));
}

function decimalHoursIn(texts: string[], allowed: Set<string>): string[] {
  return texts.flatMap((t) => [...t.matchAll(DECIMAL_HOURS)].flatMap((m) => (allowed.has(m[1]) ? [String(Number(m[1]))] : [])));
}

const NAMED_IDS = /\b(?:lines?|trips?|pairings?)\s*#?\s*(\d{1,5}(?:\s*(?:,|and|or|&)\s*#?\s*\d{1,5})*)/gi;
const idsNamed = (text: string) => new Set([...text.matchAll(NAMED_IDS)].flatMap((m) => m[1].match(/\d{1,5}/g) ?? []));

/**
 * The pack facts, each with its numbers and the lines and trips it's about: "Line 2016 as printed: 14 days off" is
 * line 2016's. A fact naming none, such as the pack's month and base, belongs to every line and trip the facts name.
 */
function packFactsOf(facts: string): { text: string; numbers: string[]; owners: Set<string> }[] {
  const all = facts
    .replace(LINE_NOT_IN_PACK, " ")
    .split("\n")
    .filter((t) => t.trim());
  const ownersOf = (t: string) => new Set([...t.matchAll(/\b(?:Line|Trip|trip)\s+(\d{1,5})\b/g)].map((m) => m[1]));
  const everyone = new Set(all.flatMap((t) => [...ownersOf(t)]));
  return all.map((text) => {
    const owners = ownersOf(text);
    return { text, numbers: numbersIn(text), owners: owners.size ? owners : everyone };
  });
}

/** An answer's sentences, and their parts after a semicolon or a ", and" or ", but": each makes its own claim. */
function clausesOf(text: string): string[] {
  return text.split(/(?<=[.;!?])\s+|;|,\s+(?=(?:and|but|so|while|whereas|which)\b)/).filter((c) => c.trim());
}

/** The other version's words of a piece, when it reads differently. */
export function otherWording(id: string, version: ContractVersion): string | undefined {
  const node = contractNode(id);
  if (!node?.changed) return undefined;
  const text = versionText(node, version === "2026" ? "2015" : "2026");
  return text.trim() || undefined;
}
