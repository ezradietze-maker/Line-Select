import { DOCS, NODES, childrenOf, contractNode, findNode, fullText, versionText } from "./index";
import type { ContractVersion } from "./types";

/**
 * The hard rule of the contract box: no made-up section, no misquote, enforced here and not left to the model. Every
 * section number must exist in the index, every quote must be in that section word for word, and every number in the
 * short answer must come from the quotes, the lines and trips the question names, or the pilot's own pack. Anything else turns into "not found".
 */

export interface RawAnswer {
  found: boolean;
  answer: string;
  quotes: { section: string; quote: string; version: ContractVersion }[];
}

export type Verdict =
  | { ok: true; answer: string; quotes: { section: string; quote: string; version: ContractVersion }[] }
  | { ok: false; reason: string };

/** Same words, same order: only spacing and the PDF's typography can differ. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * Whether a section's text holds the quote word for word, with no number cut in two at either end: matched anywhere,
 * "…in writing at least 3" was found inside "at least 30 days", and its 3 then backed an answer of "3 days".
 */
export function holdsQuote(text: string, quote: string): boolean {
  const hay = normalizeForMatch(text);
  const wanted = normalizeForMatch(quote);
  if (!wanted) return false;
  const digit = /\d/;
  for (let at = hay.indexOf(wanted); at >= 0; at = hay.indexOf(wanted, at + 1)) {
    const before = hay.slice(Math.max(0, at - 2), at);
    const after = hay.slice(at + wanted.length, at + wanted.length + 2);
    const cutBefore = digit.test(wanted[0]) && (digit.test(before.slice(-1)) || (/^\d[.:]$/.test(before) && before.length === 2));
    const cutAfter = digit.test(wanted[wanted.length - 1]) && (digit.test(after[0] ?? "") || /^[.:]\d$/.test(after));
    if (!cutBefore && !cutAfter) return true;
  }
  return false;
}

/** Fewer words than this prove nothing by being found ("SMU", "New Year's Day"), so they're left out, not trusted. */
const MIN_QUOTE_WORDS = 4;

/** Section numbers as a sentence would write them: 25.E.6, 25.A.7.b.i.(c), Section 13. */
const SECTION_REF = /\b\d{1,2}\.[A-Z]{1,2}(?:\.(?:\([a-z0-9]+\)|[a-z0-9]+))*(?:\([a-z0-9]+\))*/g;
const BARE_SECTION = /\bSection\s+(\d{1,2})\b(?!\.[A-Z])/g;
/** A number as written in a contract or an answer: 115, 9:30, 1700, 2.25. */
const NUMBER = /\d+(?::\d+|\.\d+)*/g;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/** "One" that counts nothing: "no one can drop…", "one of the days", "one another". */
const ONE_AS_A_WORD = /\b(?:no|any|every|each|the|this|that|which)[- ]one\b|\bone (?:of|another|or more|who|that|which)\b/gi;
const SPELLED = new RegExp(`\\b(?:(${TENS.slice(2).join("|")})(?:[- ](${ONES.slice(1, 10).join("|")}))?|(${ONES.join("|")}))\\b`, "gi");

/**
 * Every number a text holds, written in digits or in words: the contract writes "twelve (12)", and an answer saying
 * "twelve hours" makes the same claim as "12 hours" — it has to be backed the same way.
 */
function numbersIn(text: string): string[] {
  const spelled = [...text.replace(ONE_AS_A_WORD, " ").matchAll(SPELLED)].map((m) =>
    m[3] !== undefined ? String(ONES.indexOf(m[3].toLowerCase())) : String(TENS.indexOf(m[1].toLowerCase()) * 10 + (m[2] ? ONES.indexOf(m[2].toLowerCase()) : 0))
  );
  return [...(text.match(NUMBER) ?? []), ...spelled];
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
  for (const q of raw.quotes) {
    const node = findNode(q.section);
    if (!node) return { ok: false, reason: `no section ${q.section}` };
    if (!holdsQuote(fullText(node.id, q.version), q.quote)) {
      const actually = whereIsQuote(q.quote);
      const hint = actually ? ` Those words are in the ${actually.version} wording of ${actually.section}.` : "";
      return { ok: false, reason: `not word for word in ${node.id} (${q.version}): "${q.quote.slice(0, 80)}".${hint}` };
    }
    if (q.quote.trim().split(/\s+/).length < MIN_QUOTE_WORDS) continue;
    quotes.push({ section: narrowestPiece(node.id, q.quote, q.version), quote: q.quote.trim(), version: q.version });
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
  const words = raw.answer.replace(SECTION_REF, " ").replace(BARE_SECTION, " ").replace(/\bPhase \d\b/g, " ").replace(/\bJune 29\b/g, " ");
  // From the question, only the lines and trips it names: any number in it let "Is minimum rest 8 hours?" have its 8
  // confirmed against a quote that says 9:30.
  const asked = [...context.question.matchAll(/\b(?:lines?|trips?)\s*#?\s*(\d{1,4})\b|#\s*(\d{1,4})\b|\b(\d{4})\b/gi)].map((m) => m[1] ?? m[2] ?? m[3]);
  const allowed = new Set(["2015", "2026", "2027", ...asked, ...[...quotes.map((q) => q.quote), context.facts ?? ""].flatMap(numbersIn)]);
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
