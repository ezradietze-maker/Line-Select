import { formatValue } from "@/lib/brain/describe";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import type { PackMetrics } from "@/lib/metrics/compute";
import { scorePackV2, type CriterionResult } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice, PilotModel } from "@/types/pilot-model";

/**
 * "Would you actually bid this?" Near the end, the interview shows the pilot
 * real lines from their ranking as it stands and asks if they belong there:
 *
 * - top: a line near the top that does badly on one of their own top
 *   priorities — the kind a weighted score lets through when enough else is
 *   good about it (eight commutes, but the pay is great);
 * - middle: a line in the middle of the list that's among the pack's very
 *   worst on one of their priorities. A pilot's stated priorities and how
 *   they actually judge a line can differ — a pilot can name pay as the
 *   thing they'd give up last and still throw out every line with eight
 *   commutes the moment they see one. Only showing a line brings that out.
 *
 * Each verdict is the most direct evidence there is about whether that weak
 * spot can be bought back: it becomes a line-versus-line choice against a
 * line below it that doesn't have the problem (so `fit-choices.ts` learns
 * from it), and the brain reads it too ("Never" can mean a dealbreaker).
 */

/** How the question opens — how the transcript (and the brain) recognizes it. */
export const BID_CHECK_LEAD = "Bid check:";
/** A full interview asks at most this many: a top check, then a middle check, then whichever finds more at stake. */
export const MAX_BID_CHECKS = 3;

/** Lines this close to the top are the ones a top check asks about… */
const TOP_CHECKED = 6;
/** …and a middle check, lines from there down to this share of the list. */
const MIDDLE_TO_SHARE = 0.75;
/** A middle check's weak spot is among the pack's worst: no more than this share of lines as bad or worse, and this low on the scale. */
const EXTREME_SHARE = 0.3;
const EXTREME_UTILITY = 0.2;
/** A middle check's verdict is recorded against a line at least this many places below it. */
const MIDDLE_ALT_BELOW = 8;
/** The alternative comes from within this many places. */
const ALT_WITHIN = 25;
/** Only priorities that matter this much are a weak spot worth asking about. */
const MIN_WEIGHT = 0.3;
/** Doing this badly on it (utility, 0–1) counts as a weak spot… */
const WEAK = 0.35;
/** …and the alternative has to do at least this much better on it. */
const ALT_BETTER_BY = 0.4;

export const BID_CHECK_OPTIONS = ["Yes — it belongs near the top", "Somewhere in the middle", "Low — I'd hardly bid it", "Never — that rules it out"] as const;
export const MIDDLE_CHECK_OPTIONS = ["About right there", "Lower — near the bottom", "Never — that rules it out"] as const;

export type BidCheckKind = "top" | "middle";

export interface BidCheckQuestion {
  kind: BidCheckKind;
  line: string;
  rank: number;
  /** The best line below it that doesn't share its weak spot — what the verdict is recorded against. */
  alt: string;
  prompt: string;
  helpText: string;
  options: string[];
  transcript: string;
}

/** "a and b". */
const listed = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

const v = (r: CriterionResult) => {
  const def = METRICS_BY_ID.get(r.metric);
  return r.value === null || !def ? "—" : formatValue(r.value, def);
};

interface Candidate {
  kind: BidCheckKind;
  score: number;
  i: number;
  weak: CriterionResult;
  altIndex: number;
}

/**
 * The next check to ask, or null. `asked` is the kinds already asked, in order: the first is a top check, the second a
 * middle check (when there's one worth asking), and after that whichever has more at stake.
 */
export function bidCheckQuestion(
  bidPack: BidPack,
  model: PilotModel,
  choices: LineChoice[],
  pack: PackMetrics,
  alreadyChecked: string[],
  asked: BidCheckKind[] = [],
  /** Weak spots already asked about, by label — each check asks about a different one. */
  askedWeakSpots: string[] = []
): BidCheckQuestion | null {
  // The ranking as it would come out now, line choices included.
  const fitted = choices.length ? fitWeightsToChoices(bidPack, model, choices, pack).model : model;
  const ranked = scorePackV2(bidPack, fitted, { pack }).sort((a, b) => b.score - a.score);
  const important = new Set(fitted.criteria.filter((c) => c.weight >= MIN_WEIGHT).map((c) => c.id));
  const utilityOn = (j: number, id: string) => ranked[j].results.find((x) => x.criterionId === id)?.utility ?? 0;
  const free = (j: number) => !alreadyChecked.includes(ranked[j].lineNumber);
  const middleTo = Math.max(TOP_CHECKED + 1, Math.round(ranked.length * MIDDLE_TO_SHARE));
  let top: Candidate | null = null;
  let middle: Candidate | null = null;
  for (let i = 0; i < Math.min(middleTo, ranked.length); i++) {
    if (!free(i)) continue;
    const isTop = i < TOP_CHECKED;
    for (const r of ranked[i].results) {
      if (!important.has(r.criterionId) || r.value === null || askedWeakSpots.includes(r.label)) continue;
      if (isTop) {
        if (r.utility > WEAK) continue;
        const altIndex = ranked.findIndex((_, j) => j > i && j < ALT_WITHIN && free(j) && utilityOn(j, r.criterionId) >= r.utility + ALT_BETTER_BY);
        if (altIndex < 0) continue;
        // How much is at stake: how much the weak spot matters, how weak it is, and how high the line sits — #1 most of all.
        const score = r.weight * (1 - r.utility) * ((TOP_CHECKED - i) / TOP_CHECKED);
        if (!top || score > top.score) top = { kind: "top", score, i, weak: r, altIndex };
      } else {
        // Among the pack's very worst on it — by the real value, since past a stated "worst" every line's utility is the
        // same zero — and still sitting in the middle of their list.
        if (r.utility > EXTREME_UTILITY) continue;
        const kind = fitted.criteria.find((c) => c.id === r.criterionId)?.shape.kind;
        if (kind !== "less" && kind !== "more") continue;
        const valueOn = (j: number) => ranked[j].results.find((x) => x.criterionId === r.criterionId)?.value ?? null;
        const asBad = ranked.filter((_, j) => { const x = valueOn(j); return x !== null && (kind === "less" ? x >= r.value! : x <= r.value!); }).length / ranked.length;
        if (asBad > EXTREME_SHARE) continue;
        const altIndex = ranked.findIndex((_, j) => j >= i + MIDDLE_ALT_BELOW && free(j) && utilityOn(j, r.criterionId) >= r.utility + ALT_BETTER_BY);
        if (altIndex < 0) continue;
        // Mostly how much the weak spot matters; a little more when the line sits higher up the list.
        const score = r.weight * (1 - r.utility) * (0.6 + (0.4 * (middleTo - i)) / middleTo);
        if (!middle || score > middle.score) middle = { kind: "middle", score, i, weak: r, altIndex };
      }
    }
  }
  const want: BidCheckKind | null = !asked.includes("top") ? "top" : !asked.includes("middle") ? "middle" : null;
  const pick = want === "top" ? (top ?? middle) : want === "middle" ? (middle ?? top) : [top, middle].filter((c): c is Candidate => !!c).sort((a, b) => b.score - a.score)[0];
  if (!pick) return null;
  const line = ranked[pick.i];
  const alt = ranked[pick.altIndex];
  // What it has going for it: its two strongest points among what they care about.
  const strengths = line.results
    .filter((r) => r.criterionId !== pick.weak.criterionId && r.value !== null && r.utility >= 0.7 && important.has(r.criterionId))
    .sort((a, b) => b.weight * b.utility - a.weight * a.utility)
    .slice(0, 2);
  // Each value says what it counts ("2 departures", "4 long duty days"), so the line is described the way a pilot would.
  const good = strengths.length ? `${listed(strengths.map(v))}, which fits what you've told us` : "most of it fits what you've told us";
  const options = pick.kind === "top" ? [...BID_CHECK_OPTIONS] : [...MIDDLE_CHECK_OPTIONS];
  // Too little of something they want more of reads "only has 5.8 credit hours a day"; too much of the rest, "also has".
  const short = fitted.criteria.find((c) => c.id === pick.weak.criterionId)?.shape.kind === "more";
  const has = short ? "only has" : "also has";
  const prompt =
    pick.kind === "top"
      ? `Line ${line.lineNumber} is #${pick.i + 1} on your list right now — ${good}. But it ${has} ${v(pick.weak)}. Would you actually bid it that high?`
      : `Line ${line.lineNumber} is #${pick.i + 1} of ${ranked.length} on your list right now — ${good}. But it ${has} ${v(pick.weak)}, among the worst in this pack. Is #${pick.i + 1} about right for it?`;
  return {
    kind: pick.kind,
    line: line.lineNumber,
    rank: pick.i + 1,
    alt: alt.lineNumber,
    prompt,
    helpText: "Tell us if that's the reason — or something else about it is.",
    options,
    // The priority it asks about, by name, for the brain and for `checkedWeakSpots` — the question itself says only the value.
    transcript: `${BID_CHECK_LEAD} ${prompt} [weak spot: “${pick.weak.label}”] (options: ${options.join(" / ")})`,
  };
}

/**
 * The verdict, as a line choice against the line it's recorded against — only when it says something that specific.
 * "Never" does: whatever's below it is ahead of it. "Yes"/"About right" does: it holds its place over the line below.
 * "Lower" (or "Low") doesn't — it says the line belongs lower than where it is, not below that particular line, and
 * counted as a choice against it, it dragged the whole model to push one line past another (Oct 13 2026 runs: one
 * "Lower" took the judge's agreement from 0.78 to 0.60). The brain still reads it, in the pilot's words.
 */
export function bidCheckChoice(q: Pick<BidCheckQuestion, "line" | "alt"> & { kind?: BidCheckKind }, optionIndex: number, why?: string): LineChoice | null {
  const note = why?.trim() ? { why: why.trim() } : {};
  const keep = { preferred: q.line, other: q.alt, strength: "slightly" as const, ...note };
  const never = { preferred: q.alt, other: q.line, strength: "strongly" as const, ...note };
  if (q.kind === "middle") return [keep, null, never][optionIndex] ?? null;
  // A top check's "Somewhere in the middle" and "Low" don't say which line it belongs below either.
  return [keep, null, null, never][optionIndex] ?? null;
}

/** The kinds of check the interview has already asked, in order. */
export function checkedKinds(exchanges: { question: string }[]): BidCheckKind[] {
  return exchanges.filter((e) => e.question.startsWith(BID_CHECK_LEAD)).map((e) => (/ is #\d+ of \d+ on your list/.test(e.question) ? "middle" : "top"));
}

/** The weak spots the interview has already asked about, by label. */
export function checkedWeakSpots(exchanges: { question: string }[]): string[] {
  // "[weak spot: “…”]"; interviews saved before Oct 2026 named it in the question ("But on “…” it has").
  return exchanges.flatMap((e) => (e.question.startsWith(BID_CHECK_LEAD) ? [(e.question.match(/\[weak spot: “([^”]+)”\]/) ?? e.question.match(/But on “([^”]+)”/))?.[1] ?? ""] : [])).filter(Boolean);
}

/** Lines the interview has already asked about. */
export function checkedLines(exchanges: { question: string }[]): string[] {
  return exchanges.flatMap((e) => (e.question.startsWith(BID_CHECK_LEAD) ? [e.question.match(/Line (\w+) is #/)?.[1] ?? ""] : [])).filter(Boolean);
}
