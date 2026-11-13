import { DOCS, NODES, ancestorsOf, childrenOf, contractNode, findNode, fullText, versionText } from "./index";
import { LINE_NOT_IN_PACK } from "./pack-facts";
import { applicabilityOf, PHASE_STARTS } from "./phases";
import type { ContractVersion } from "./types";

/**
 * The hard rule of the contract box: no made-up section, no misquote, enforced here and not left to the model. Every
 * section number must exist in the index, every quote must be in that section word for word, every number in the
 * short answer must come from the quotes or from what the pilot's own pack says of the line or trip it's said of, and
 * every month, date and phase must be when the rule its clause speaks of starts. Anything else turns into "not found".
 *
 * What it can't catch: it checks sections, quotes, numbers and dates, not what the words around them say. "May"
 * turned into "may not", a "not" taken out, or hours swapped for days all pass, as long as the numbers stay backed.
 * Which quote a clause speaks of is read from the sections it names or the words it shares, so a clause that shares
 * words with two quotes may take either one's date. The quotes shown under the answer are the guarantee; the short
 * answer's meaning is not.
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
  if (!wanted || !stripped(text).includes(wanted)) return null;
  const { spaced, hay, at } = prepared(text);
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

// A section's text made matchable is kept, not redone for every quote: a quote cited to all of Section 25 (177,000
// characters) cost 12 ms each time, and an answer sending hundreds of them held the server for seconds.
const strippedTexts = new Map<string, string>();
const preparedTexts = new Map<string, { spaced: string; hay: string; at: number[] }>();
function stripped(text: string): string {
  let s = strippedTexts.get(text);
  if (s === undefined) {
    if (strippedTexts.size > 20_000) strippedTexts.clear();
    strippedTexts.set(text, (s = normalizeForMatch(text)));
  }
  return s;
}
function prepared(text: string): { spaced: string; hay: string; at: number[] } {
  let p = preparedTexts.get(text);
  if (!p) {
    const spaced = plainText(text);
    // Where each letter of the spaceless text sits in the spaced one.
    const at: number[] = [];
    for (let i = 0; i < spaced.length; i++) if (spaced[i] !== " ") at.push(i);
    p = { spaced, hay: at.map((i) => spaced[i]).join(""), at };
    if (preparedTexts.size > 500) preparedTexts.clear();
    preparedTexts.set(text, p);
  }
  return p;
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
 * and "one" standing for a thing named before: "not the current one.", "including a dropped one,", "each one pays 3
 * CH", "or one held by a junior pilot". Only these: "the one day", "only one of your vacations" and "only one is
 * allowed" are counts, and passed unbacked when every "the one" and "one of" was let off.
 */
const ONE_AS_A_WORD = new RegExp(
  [
    String.raw`\bno[- ]one\b|\b(?:any|every|some)one\b|\bone another\b`,
    String.raw`(?<!\b(?:only|just|exactly|least|most|than|to|but) )\bone of (?:these|those|them|the following|the listed)\b`,
    String.raw`\b(?:the|this|that|each|which|a|an|or|any|every|current|dropped|new|old|other|same|earlier|later|original|first|last|next|prior|such) one` +
      String.raw`(?=\s*(?:[.,;:!?)]|$)|\s+(?:held|that|which|who|whose|is|was|are|were|beyond|needs?|pays?|gets?|has|had|can|may|must|shall|will|would|counts?)\b)`,
  ].join("|"),
  "gi"
);
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

/** More quotes than an answer needs: each is matched against its section, and hundreds of them held the server. */
export const MAX_QUOTES = 30;

type Quote = { section: string; quote: string; version: ContractVersion };

/**
 * `bidMonth` is the bid period the question is about ("2026-11"). An answer may name it, or a bid period the question
 * itself names, as the period asked about ("for the November 2026 bid period"), never as when a rule starts.
 */
export function validateAnswer(raw: RawAnswer, context: { question: string; facts?: string; bidMonth?: string }): Verdict {
  if (!raw.found) return { ok: false, reason: "the model found nothing" };
  if (!raw.answer.trim()) return { ok: false, reason: "empty answer" };
  if (!raw.quotes.length) return { ok: false, reason: "an answer with no quote" };
  if (raw.quotes.length > MAX_QUOTES) return { ok: false, reason: `${raw.quotes.length} quotes is more than an answer needs. Quote at most ${MAX_QUOTES} places` };

  const quotes: Quote[] = [];
  // The numbers each quote holds, as the contract itself writes them: the match ignores spacing, so a quote that ran two
  // cells of a pay table together ("5 433.94" as "5433.94") would otherwise back a number no cell holds. A reserve
  // status in it is a name: the "R-24" of a quote backed "24 hours' notice".
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
    const written = new Set(numbersIn(withoutStatuses(span)));
    quotedNumbers.push(...numbersIn(withoutStatuses(q.quote)).filter((n) => written.has(n)));
  }
  if (!quotes.length) return { ok: false, reason: "no quote long enough to check" };

  // A section named in the answer must be a piece a quote landed on, one above it, a piece under it whose words the quote
  // holds, or exactly one the quoted words name ("…as provided in Section 12.C.", "Section 7.I.2. and 3"). Taken from
  // the model's own labels, any piece under a label passed (25.G.3.b let the answer point at 25.G.3.b.vii), and a
  // piece a quote names opened everything above it (25.L.3.a let in "Section 25.L.3").
  const cited = new Set(quotes.flatMap((q) => citedIn(q.quote)));
  const landed = quotes.map((q) => q.section);
  const holdsPartOf = (id: string) => {
    const node = contractNode(id);
    return quotes.some((q) => {
      const own = node ? normalizeForMatch(versionText(node, q.version)) : "";
      return !!own && id.startsWith(`${q.section}.`) && normalizeForMatch(q.quote).includes(own);
    });
  };
  const blanks: [number, number][] = [];
  const named: { at: number; id: string }[] = [];
  for (const m of raw.answer.matchAll(SECTION_REF)) {
    const node = findNode(m[0]);
    if (!node) return { ok: false, reason: `the answer names ${m[0]}, which doesn't exist` };
    if (!cited.has(node.id) && !landed.some((s) => s === node.id || s.startsWith(`${node.id}.`)) && !holdsPartOf(node.id)) {
      return { ok: false, reason: `the answer names ${node.id} but quotes nothing from it. Quote it, or leave its name out` };
    }
    blanks.push([m.index, m.index + m[0].length]);
    named.push({ at: m.index, id: node.id });
  }
  for (const m of raw.answer.matchAll(BARE_SECTION)) {
    if (!DOCS.some((d) => d.id === m[1])) return { ok: false, reason: `the answer names Section ${m[1]}, which we don't have` };
    blanks.push([m.index, m.index + m[0].length]);
  }

  // Dates and phases are checked where they're said; their numbers aren't counted again. A reserve status the contract
  // writes is a name, not a count, unless an hour or day word follows it ("R-24 hours").
  const dates = datesIn(raw.answer);
  const phases = phasesIn(raw.answer);
  for (const d of dates) if (d.checked) blanks.push([d.at, d.end]);
  for (const p of phases) blanks.push([p.at, p.end]);
  const statuses = reserveStatusesHeld(raw.quotes, quotes);
  for (const m of raw.answer.matchAll(RESERVE_STATUS)) if (statuses.has(statusKey(m[0]))) blanks.push([m.index, m.index + m[0].length]);
  const masked = blankOut(raw.answer, blanks);

  const bidYear = Number((context.bidMonth ?? "2026").slice(0, 4));
  const asked = new Set([...(context.bidMonth ? [context.bidMonth] : []), ...datesIn(context.question).flatMap((d) => (d.ym ? [d.ym] : []))]);
  // Nothing comes from the question itself: any number in it let "Is minimum rest 8 hours?" have its 8 confirmed
  // against a quote that says 9:30, and even its line and trip numbers did ("Do trips 3 days long count?" backed "3
  // days", "begin at 1800?" backed 1800). A line or trip the question names counts only once the pack facts, worked
  // out from the pilot's own pack, show it's really there: "Line 1800 isn't in this pack" backs no 1800. The years
  // that name the wordings, 2015 and 2026, are let through; 2027 names none, so only a checked date holds it.
  const backed = new Set(["2015", "2026", ...quotedNumbers]);
  const quotedHours = decimalHoursIn(quotes.map((q) => q.quote), backed);
  const facts = packFactsOf(context.facts ?? "");
  const owners = new Set(facts.lines.flatMap((f) => [...f.owners]));

  const quotedMonths = new Set(quotes.flatMap((q) => datesIn(q.quote).map((d) => d.month)));
  let before: { ids: Set<string>; pieces: Quote[] | null } = { ids: new Set(), pieces: null };
  for (const clause of clausesOf(masked)) {
    const { text } = clause;
    const inside = <T extends { at: number }>(xs: T[]) => xs.filter((x) => x.at >= clause.start && x.at < clause.end);

    // When the rule this clause speaks of starts: dates and phases are held to the pieces it names, or else to the
    // quotes it shares words with, or else to the ones the clause before spoke of. Pooled across every quote, a
    // throwaway quote from a Phase 4 piece let "the SWW starts by the October 2027 bid period" through.
    const refs = inside(named).map((n) => n.id);
    let pieces = refs.length ? quotes.filter((q) => refs.some((r) => q.section === r || q.section.startsWith(`${r}.`))) : closestQuotes(text, quotes) ?? before.pieces ?? quotes;
    let starts = startsOf([...refs, ...pieces.map((q) => q.section)], pieces.map((q) => q.quote), context.bidMonth);
    // Matched only by shared words to pieces with no start at all (unchanged ones), the clause may speak of another.
    if (!refs.length && !starts.phases.size && !starts.since.months.size) {
      pieces = quotes;
      starts = startsOf(quotes.map((q) => q.section), quotes.map((q) => q.quote), context.bidMonth);
    }
    for (const d of inside(dates)) {
      if (!d.checked) continue;
      const years = d.ym ? [d.ym] : [bidYear, bidYear + 1].map((y) => `${y}-${String(d.month + 1).padStart(2, "0")}`);
      const holds = (s: { months: Set<string>; days: Set<string> }, ym: string) => (d.day ? s.days.has(`${ym}-${d.day.padStart(2, "0")}`) : s.months.has(ym));
      // A month on its own that isn't a start ("before the December bid package") is one the quotes may name.
      const ok =
        (!d.ym && !d.day && (starts.monthNames.has(d.month) || (!d.claim && quotedMonths.has(d.month)))) ||
        years.some((ym) => (d.claim === "since" ? holds(starts.since, ym) : d.claim === "by" ? holds(starts.by, ym) : holds(starts.since, ym) || holds(starts.by, ym) || (!d.day && asked.has(ym))));
      if (!ok) {
        return { ok: false, reason: `the answer says ${d.text}, which isn't when the rule it speaks of starts${d.claim ? "" : " or the bid period asked about"}. Give the start that section's notes give, or leave the date out` };
      }
    }
    for (const p of inside(phases)) {
      if (!starts.phases.has(p.phase)) return { ok: false, reason: `the answer says ${p.text}, but the rule it speaks of isn't in Phase ${p.phase}. Give the phase that section's notes give, or leave it out` };
    }

    // A pack's figure backs only what's said of its own line or trip, and never a rule: "Line 1001 has 15 days off"
    // let "the contract requires at least 15 days off" through. A clause that names no line but goes on from one
    // ("…, and 78.6 CH", "…, which totals 78.6 CH", "It has 78.6 CH") speaks of the line before it.
    let ids = new Set([...idsNamed(text)].filter((id) => owners.has(id)));
    if (!ids.size && GOES_ON.test(text)) ids = before.ids;
    const rule = RULE_WORDS.test(text) || refs.length > 0;
    const mine = facts.lines.filter((f) => [...f.owners].some((o) => ids.has(o)));
    const allowed = new Set([...backed, ...ids]);
    if (!rule) {
      for (const n of mine.flatMap((f) => f.numbers)) allowed.add(n);
      if (ids.size) for (const token of facts.header) if (new RegExp(`(?<![\\w-])${escapeRegExp(token)}(?![\\w-])`, "i").test(text)) for (const n of numbersIn(token)) allowed.add(n);
    }
    const hours = new Set([...quotedHours, ...decimalHoursIn(rule ? [] : mine.map((f) => f.text), allowed)]);
    for (const n of numbersIn(dropHeldLengths(text, allowed, hours))) {
      if (allowed.has(n)) continue;
      if (facts.lines.some((f) => f.numbers.includes(n)) || facts.header.some((t) => numbersIn(t).includes(n))) {
        return {
          ok: false,
          reason: rule
            ? `the answer says ${n}, a figure of the pilot's pack, in a sentence about what the contract requires. A pack's figure can't back a rule: quote the contract's words that hold ${n}, or say ${n} only of the pilot's line or trip`
            : `the answer says ${n} where it doesn't name the line or trip of the pilot's pack that has it. Quote the contract's words that hold ${n}, or say ${n} only of that line or trip`,
        };
      }
      return { ok: false, reason: `the answer says ${n}, which isn't in the quotes. Quote the contract's words that hold ${n}, or leave ${n} out of the answer` };
    }
    if (text.replace(/·/g, "").trim()) before = { ids, pieces };
  }
  return { ok: true, answer: raw.answer.trim(), quotes };
}

/** A clause that goes on from the one before: "and 78.6 CH", "which totals…", "It has…", a bullet's "- 15 days off". */
const GOES_ON = /^\s*(?:[-•*]\s*)?(?:(?:and|which|it|its|it's|with|plus|this line|that line|the line)\b|\d)/i;
/** Words that make a clause about what the contract requires, which a pack's figures can't back. */
const RULE_WORDS = /\b(?:contract|contract's|CBA|agreement|requires?|required|requirement|minimum|maximum|allows?|allowed|caps?|capped)\b/i;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * The text with each span filled in, so what's left keeps its places. Not with spaces: a clause break eats the spaces
 * around it, and a date blanked to spaces right after a dash fell between clauses, unchecked.
 */
const BLANK = "·";
const blankOut = (text: string, spans: [number, number][]) => {
  let out = text;
  for (const [a, b] of spans) out = out.slice(0, a) + BLANK.repeat(b - a) + out.slice(b);
  return out;
};

/**
 * The sections a quote's words name, each exactly: "Section 7.I.2. and 3" names 7.I.2 and 7.I.3, "12.D.1.d.i. and
 * ii." names 12.D.1.d.i and 12.D.1.d.ii.
 */
function citedIn(quote: string): string[] {
  const out: string[] = [];
  const more = /^\.?\s*(?:,|and|or|&|through)\s+(?:Section\s+)?(\([a-z0-9]{1,4}\)|[ivx]{1,4}|[a-z]|\d{1,2})\.?(?=[\s,;)]|$)/i;
  for (const m of quote.matchAll(SECTION_REF)) {
    let ref = m[0];
    const first = findNode(ref)?.id;
    if (!first) continue;
    out.push(first);
    let rest = quote.slice(m.index + m[0].length);
    for (let t = rest.match(more); t; t = rest.match(more)) {
      ref = ref.replace(/(?:\.\([a-z0-9]+\)|\.[a-z0-9]+|\([a-z0-9]+\))$/i, t[1].startsWith("(") ? t[1] : `.${t[1]}`);
      const id = findNode(ref)?.id;
      if (!id) break;
      out.push(id);
      rest = rest.slice(t[0].length);
    }
  }
  return out;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH = String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?`;
const ORDINAL = String.raw`(?:st|nd|rd|th)?`;
/**
 * A date as an answer may write it: "December 2026", "Dec. 2026", "October of 2027", "June 29, 2026", "June 29th,
 * 2026", "29 June 2026", "the July bid period". Any spacing, a non-breaking space too.
 */
const DATE = new RegExp(
  String.raw`(?<![\w-])(?:(\d{1,2})${ORDINAL}\s+(?:of\s+)?(${MONTH})(?:,?\s+(?:of\s+)?(\d{4}))?|(${MONTH})(?:\s+(\d{1,2})${ORDINAL}(?![\d:]))?(?:,?\s+(?:of\s+)?(\d{4}))?)(?![\w-])`,
  "g"
);
/**
 * Words before a date that make it a start. "Since" says when a rule came into force; "by", "until", "starts" when it
 * starts or, for one applied by hand, when it's automated: a rule in force by hand since June 29, 2026 and automated by
 * the December 2026 bid period had its two dates swapped unnoticed.
 */
const SINCE_BEFORE = /\b(?:since|from|as\s+of|effective(?:\s+(?:on|from))?|(?:takes?|took)\s+effect(?:\s+(?:on|from))?)\s+(?:the\s+)?$/i;
const BY_BEFORE = /\b(?:start(?:s|ed|ing)?(?:\s+(?:in|on|with|by))?|by|until|till|begin(?:s|ning)?(?:\s+(?:in|on|with|by))?|began(?:\s+(?:in|on|with))?|after|replaced(?:\s+(?:in|on|by))?|implemented(?:\s+(?:in|on|by))?|automated(?:\s+(?:in|on|by))?)\s+(?:the\s+)?(?:first\s+day\s+of\s+(?:the\s+)?)?$/i;

type FoundDate = { at: number; end: number; text: string; month: number; day?: string; ym?: string; checked: boolean; claim: "since" | "by" | null };

/**
 * Every date a text writes, with whether it's checked: a month with a year, "June 29", or a month on its own written
 * in full ("the July bid period"), read as the bid month's year or the next. A day with no year ("December 31") is a
 * date the quotes give, left to the number checks.
 */
const claimBefore = (before: string) => (SINCE_BEFORE.test(before) ? "since" : BY_BEFORE.test(before) ? "by" : null);

function datesIn(text: string): FoundDate[] {
  return [...text.matchAll(DATE)].map((m) => {
    const word = m[2] ?? m[4];
    const month = MONTH_NAMES.findIndex((n) => n.slice(0, 3) === word.slice(0, 3));
    const day = m[1] ?? m[5];
    const year = m[3] ?? m[6];
    const full = MONTH_NAMES.includes(word);
    const alone = !day && !year && full && (word !== "May" || /^\s+bid period/i.test(text.slice(m.index + m[0].length)));
    const june29 = !year && month === 5 && day === "29";
    return {
      at: m.index,
      end: m.index + m[0].length,
      text: m[0],
      month,
      day: day ?? undefined,
      ym: year ? `${year}-${String(month + 1).padStart(2, "0")}` : june29 ? "2026-06" : undefined,
      checked: !!year || june29 || alone,
      claim: claimBefore(text.slice(Math.max(0, m.index - 48), m.index)),
    };
  });
}

/** "Phase 3", "phase three", "Phase III", "the fourth phase". "Phase-in" is no phase. */
const PHASE = /\bphase\s+(4|3|2|1|four|three|two|one|iv|iii|ii|i)\b(?!-)|\b(first|second|third|fourth)\s+phase\b/gi;
const PHASE_WORDS: Record<string, number> = { "1": 1, "2": 2, "3": 3, "4": 4, one: 1, two: 2, three: 3, four: 4, i: 1, ii: 2, iii: 3, iv: 4, first: 1, second: 2, third: 3, fourth: 4 };
function phasesIn(text: string): { at: number; end: number; text: string; phase: number }[] {
  return [...text.matchAll(PHASE)].map((m) => ({ at: m.index, end: m.index + m[0].length, text: m[0], phase: PHASE_WORDS[(m[1] ?? m[2]).toLowerCase()] }));
}

/**
 * When the given pieces start, per the implementation chart (CBA 2026 Implementation LOA, Appendix A), with any dates
 * and phases their quotes write out. A change the chart doesn't list takes the Agreement's general effective date,
 * June 29, 2026; one it doesn't date gives none.
 */
function startsOf(pieces: string[], texts: string[], bidMonth: string | undefined) {
  // When each came into force ("since"), and when it starts or is automated ("by").
  const since = { months: new Set<string>(), days: new Set<string>() };
  const by = { months: new Set<string>(), days: new Set<string>() };
  const phases = new Set<number>();
  const monthNames = new Set<number>();
  const add = (s: typeof since, month: string, day?: string) => {
    s.months.add(month);
    if (day) s.days.add(day);
  };
  const effective = (s: typeof since) => add(s, "2026-06", "2026-06-29");
  const scheduled = (phase: 1 | 2 | 3 | 4, manual: boolean) => {
    phases.add(phase);
    add(by, PHASE_STARTS[phase].month);
    if (phase === 1) effective(by);
    // By hand since signing, automated by its phase; otherwise in force from its phase's start.
    if (manual || phase === 1) effective(since);
    else add(since, PHASE_STARTS[phase].month);
  };
  const of = (id: string) => applicabilityOf(id, bidMonth ?? "2026-06");
  for (const id of new Set(pieces)) {
    const a = of(id);
    if (a.kind === "scheduled") scheduled(a.phase, a.manual);
    else if (a.kind === "mixed") {
      // A part in force by hand since signing counts as one: 25.G.3.b's order, under 25.G.3.b.iii.
      for (const p of a.phases)
        scheduled(
          p.phase,
          p.refs.some((r) => {
            const part = of(r);
            return part.kind === "scheduled" && part.manual;
          })
        );
    } else if (a.kind === "unlisted") {
      effective(since);
      effective(by);
    }
  }
  for (const t of texts) {
    for (const d of datesIn(t)) {
      if (d.ym) for (const s of [since, by]) add(s, d.ym, d.day ? `${d.ym}-${d.day.padStart(2, "0")}` : undefined);
      monthNames.add(d.month);
    }
    for (const p of phasesIn(t)) phases.add(p.phase);
  }
  return { since, by, phases, monthNames };
}

/** Words too common to tell which quote a clause speaks of. */
const COMMON = new Set(
  "the and for that this with from under shall will may can not are was were has have had its into than then when which who any all each per bid period periods wording rule rules force start starts started applies apply applied since until contract section pilot pilots company new old now phase hand automated also only more less but they their you your does did been being also there here what where while such other same both either neither must would could should 2015 2026 2027 january february march april june july august september october november december".split(" ")
);
/** A clause's telling words, roughly stemmed so "dropped" meets "drop" and "62-hour" meets "62 hours". */
const stem = (w: string) => w.replace(/'s$/, "").replace(/(?:ing|ed|ly|es|s)$/, "").replace(/([b-df-hj-np-tv-z])\1$/, "$1");
const COMMON_STEMS = new Set([...COMMON].map(stem));
const wordsOf = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []).map(stem).filter((w) => (w.length >= 3 || /^\d{2,}$/.test(w)) && !COMMON.has(w) && !COMMON_STEMS.has(w)));

/** The quotes a clause shares the most words with, or null when it shares none. */
function closestQuotes(text: string, quotes: Quote[]): Quote[] | null {
  const mine = wordsOf(text);
  const scored = quotes.map((q) => ({ q, score: [...wordsOf(q.quote)].filter((w) => mine.has(w)).length }));
  const best = Math.max(...scored.map((s) => s.score));
  return best > 0 ? scored.filter((s) => s.score === best).map((s) => s.q) : null;
}

/** R-24, R-1.5, RP-24, R‑24: a reserve status's name, unless an hour or day word follows it ("R-24 hours"). */
const RESERVE_STATUS = /\bRP?[-‐‑‒–—−]\d+(?:\.\d+)?(?![\d.]*\d)(?!\s*(?:hours?|hrs?|days?|minutes?|mins?)\b)/gi;
const statusKey = (s: string) => s.replace(/[‐‑‒–—−]/g, "-").toUpperCase();
const withoutStatuses = (t: string) => t.replace(/\bnon[- ](?=RP?[-‐‑‒–—−]\d)/gi, " ").replace(RESERVE_STATUS, " ");

/** The reserve statuses the quoted pieces, the headings above them and the passages they were cited from write. */
function reserveStatusesHeld(raw: RawAnswer["quotes"], quotes: Quote[]): Set<string> {
  const texts = [
    ...quotes.map((q) => q.quote),
    ...raw.flatMap((q) => (findNode(q.section) ? [fullText(findNode(q.section)!.id, q.version)] : [])),
    ...quotes.flatMap((q) => ancestorsOf(q.section).map((n) => versionText(n, q.version))),
  ];
  return new Set(texts.flatMap((t) => (t.match(RESERVE_STATUS) ?? []).map(statusKey)));
}

function decimalHoursIn(texts: string[], allowed: Set<string>): string[] {
  return texts.flatMap((t) => [...t.matchAll(DECIMAL_HOURS)].flatMap((m) => (allowed.has(m[1]) ? [String(Number(m[1]))] : [])));
}

const NAMED_IDS = /\b(?:lines?|trips?|pairings?)\s*#?\s*(\d{1,5}(?:\s*(?:,|and|or|&)\s*#?\s*\d{1,5})*)/gi;
const idsNamed = (text: string) => new Set([...text.matchAll(NAMED_IDS)].flatMap((m) => m[1].match(/\d{1,5}/g) ?? []));

/**
 * The pack facts: each line with its numbers and the lines and trips it's about ("Line 2016 as printed: 14 days off" is
 * line 2016's), and the pack's own header ("OCT26, IND B767 CAP, a 28-day bid period"), whose figures back only
 * themselves as written: "a 28-day bid period", never "26 work days" or "28 days in a row".
 */
function packFactsOf(facts: string): { lines: { text: string; numbers: string[]; owners: Set<string> }[]; header: string[] } {
  const all = facts
    .replace(LINE_NOT_IN_PACK, " ")
    .split("\n")
    .filter((t) => t.trim());
  const header = all.filter((t) => t.startsWith("The pilot's bid pack:")).flatMap((t) => (t.match(/[A-Za-z]*\d[\w-]*/g) ?? []).map((w) => w.replace(/-$/, "")));
  const lines = all
    .filter((t) => !t.startsWith("The pilot's bid pack:"))
    .map((text) => ({ text, numbers: numbersIn(text), owners: new Set([...text.matchAll(/\b(?:Line|Trip|trip)\s+(\d{1,5})\b/g)].map((m) => m[1])) }));
  return { lines, header };
}

/**
 * An answer's clauses, each making its own claim: split at sentence ends, semicolons, colons, dashes, brackets, line
 * breaks and bullets, and a ", and", ", but" or ", which". Dates and section numbers are blanked out first, so "Dec."
 * and "25.E.6." end no sentence.
 */
function clausesOf(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const cut = /(?<=[.;!?])\s+|;|\n+|\s*[—–]\s*|\s-\s|:\s|[()[\]]|,\s+(?=(?:and|but|so|while|whereas|which)\b)/g;
  let from = 0;
  for (const m of text.matchAll(cut)) {
    if (m.index > from) out.push({ start: from, end: m.index, text: text.slice(from, m.index) });
    from = m.index + m[0].length;
  }
  if (from < text.length) out.push({ start: from, end: text.length, text: text.slice(from) });
  // A clause left blank by its dates still has them to check: "(November 2027)" on its own was skipped.
  return out;
}

/** The other version's words of a piece, when it reads differently. */
export function otherWording(id: string, version: ContractVersion): string | undefined {
  const node = contractNode(id);
  if (!node?.changed) return undefined;
  const text = versionText(node, version === "2026" ? "2015" : "2026");
  return text.trim() || undefined;
}
