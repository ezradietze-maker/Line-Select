import { DOCS, NODES, childrenOf, contractNode, findNode, fullText, versionText } from "./index";
import { LINE_NOT_IN_PACK } from "./pack-facts";
import type { ContractVersion } from "./types";

/**
 * The hard rule of the contract box: no made-up section, no misquote, enforced here and not left to the model. Every
 * section number must exist in the index, every quote must be in that section word for word, and every number in the
 * short answer must come from the quotes or the pilot's own pack. Anything else turns into "not found".
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

export function validateAnswer(raw: RawAnswer, context: { question: string; facts?: string }): Verdict {
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

  // A section named in the answer must be one it quotes (or holds, or sits in): naming one it didn't quote passed it
  // off as backed when it wasn't.
  const quoted = [...quotes.map((q) => q.section), ...raw.quotes.flatMap((q) => findNode(q.section)?.id ?? [])];
  for (const ref of raw.answer.match(SECTION_REF) ?? []) {
    const node = findNode(ref);
    if (!node) return { ok: false, reason: `the answer names ${ref}, which doesn't exist` };
    if (!quoted.some((s) => s === node.id || s.startsWith(`${node.id}.`) || node.id.startsWith(`${s}.`))) {
      return { ok: false, reason: `the answer names ${node.id} but quotes nothing from it. Quote it, or leave its name out` };
    }
  }
  for (const m of raw.answer.matchAll(BARE_SECTION)) {
    if (!DOCS.some((d) => d.id === m[1])) return { ok: false, reason: `the answer names Section ${m[1]}, which we don't have` };
  }

  // The years and dates that name the versions and phases come from the chart: "the 2026 wording", "June 29, 2026".
  // Nothing comes from the question itself: any number in it let "Is minimum rest 8 hours?" have its 8 confirmed
  // against a quote that says 9:30, and even its line and trip numbers did ("Do trips 3 days long count?" backed "3
  // days", "begin at 1800?" backed 1800). A line or trip the question names counts only once the pack facts, worked
  // out from the pilot's own pack, show it's really there: "Line 1800 isn't in this pack" backs no 1800.
  const facts = (context.facts ?? "").replace(LINE_NOT_IN_PACK, " ");
  const allowed = new Set(["2015", "2026", "2027", ...quotedNumbers, ...numbersIn(facts)]);
  const decimalHours = new Set([...quotes.map((q) => q.quote), facts].flatMap((t) => [...t.matchAll(DECIMAL_HOURS)].flatMap((m) => (allowed.has(m[1]) ? [String(Number(m[1]))] : []))));
  const words = dropHeldLengths(raw.answer.replace(SECTION_REF, " ").replace(BARE_SECTION, " ").replace(/\bPhase \d\b/g, " ").replace(/\bJune 29\b/g, " "), allowed, decimalHours);
  for (const n of numbersIn(words)) {
    if (!allowed.has(n)) return { ok: false, reason: `the answer says ${n}, which isn't in the quotes. Quote the contract's words that hold ${n}, or leave ${n} out of the answer` };
  }
  return { ok: true, answer: raw.answer.trim(), quotes };
}

/** The other version's words of a piece, when it reads differently. */
export function otherWording(id: string, version: ContractVersion): string | undefined {
  const node = contractNode(id);
  if (!node?.changed) return undefined;
  const text = versionText(node, version === "2026" ? "2015" : "2026");
  return text.trim() || undefined;
}
