import { DOCS, NODES, childrenOf, contractNode, findNode, fullText, versionText } from "./index";
import type { ContractVersion } from "./types";

/**
 * The hard rule of the contract box: no made-up section, no misquote, enforced here and not left to the model. Every
 * section number must exist in the index, every quote must be in that section word for word, and every number in the
 * short answer must come from the quotes, the question or the pilot's own pack. Anything else turns into "not found".
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

/** Fewer words than this prove nothing by being found ("SMU", "New Year's Day"), so they're left out, not trusted. */
const MIN_QUOTE_WORDS = 4;

/** Section numbers as a sentence would write them: 25.E.6, 25.A.7.b.i.(c), Section 13. */
const SECTION_REF = /\b\d{1,2}\.[A-Z]{1,2}(?:\.(?:\([a-z0-9]+\)|[a-z0-9]+))*(?:\([a-z0-9]+\))*/g;
const BARE_SECTION = /\bSection\s+(\d{1,2})\b(?!\.[A-Z])/g;
/** A number as written in a contract or an answer: 115, 9:30, 1700, 2.25. */
const NUMBER = /\d+(?::\d+|\.\d+)*/g;

/** The deepest piece whose words hold the quote, so a quote cited to 25.E lands on 25.E.6. */
export function narrowestPiece(id: string, quote: string, version: ContractVersion): string {
  const wanted = normalizeForMatch(quote);
  for (const child of childrenOf(id)) {
    if (normalizeForMatch(fullText(child.id, version)).includes(wanted)) return narrowestPiece(child.id, quote, version);
  }
  return id;
}

/** Where a quote's words really are, to tell the model when it mislabels one. It never changes a label itself: words the model took for the current rule may be a deleted one. */
export function whereIsQuote(quote: string): { section: string; version: ContractVersion } | null {
  const wanted = normalizeForMatch(quote);
  for (const n of NODES) {
    for (const version of ["2026", "2015"] as const) {
      if (normalizeForMatch(versionText(n, version)).includes(wanted)) return { section: n.id, version };
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
    if (!normalizeForMatch(fullText(node.id, q.version)).includes(normalizeForMatch(q.quote))) {
      const actually = whereIsQuote(q.quote);
      const hint = actually ? ` Those words are in the ${actually.version} wording of ${actually.section}.` : "";
      return { ok: false, reason: `not word for word in ${node.id} (${q.version}): "${q.quote.slice(0, 80)}".${hint}` };
    }
    if (q.quote.trim().split(/\s+/).length < MIN_QUOTE_WORDS) continue;
    quotes.push({ section: narrowestPiece(node.id, q.quote, q.version), quote: q.quote.trim(), version: q.version });
  }
  if (!quotes.length) return { ok: false, reason: "no quote long enough to check" };

  for (const ref of raw.answer.match(SECTION_REF) ?? []) {
    if (!findNode(ref)) return { ok: false, reason: `the answer names ${ref}, which doesn't exist` };
  }
  for (const m of raw.answer.matchAll(BARE_SECTION)) {
    if (!DOCS.some((d) => d.id === m[1])) return { ok: false, reason: `the answer names Section ${m[1]}, which we don't have` };
  }

  const words = raw.answer.replace(SECTION_REF, " ").replace(BARE_SECTION, " ").replace(/\bPhase \d\b/g, " ");
  // The years and dates that name the versions and phases come from the chart: "the 2026 wording", "June 29, 2026".
  const allowed = new Set(["2015", "2026", "2027", "29", ...[...quotes.map((q) => q.quote), context.question, context.facts ?? ""].flatMap((t) => t.match(NUMBER) ?? [])]);
  for (const n of words.match(NUMBER) ?? []) {
    if (!allowed.has(n)) return { ok: false, reason: `the answer says ${n}, which isn't in the quotes` };
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
