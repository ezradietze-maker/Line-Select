/**
 * The interview's opening steps, before the questions: where the pilot is among them lives in the address
 * (`/interview?step=cities`), one history entry a step, so the browser's Back (or a swipe back on a phone) goes back a
 * step instead of leaving the interview.
 */
export type OpeningStep = "seniority" | "checkin" | "story" | "commuter" | "cities";

const STEP = "step";

/** The opening steps in order: a check-in's are shorter; the seniority step only when the pack has a seniority list. */
export function openingSteps(checkIn: boolean, hasSeniority: boolean): OpeningStep[] {
  const steps: OpeningStep[] = checkIn ? ["seniority", "checkin", "cities"] : ["seniority", "story", "commuter", "cities"];
  return hasSeniority ? steps : steps.slice(1);
}

/** The step an address is on: the first when it names none, or one this interview doesn't have. */
export function stepFromSearch(search: string, steps: readonly OpeningStep[]): OpeningStep {
  const named = new URLSearchParams(search).get(STEP);
  return steps.find((s) => s === named) ?? steps[0];
}

/** The address for a step: the interview's own for the first, so arriving there and coming back to it look the same. */
export function urlForStep(pathname: string, search: string, step: OpeningStep, steps: readonly OpeningStep[]): string {
  const params = new URLSearchParams(search);
  if (step === steps[0]) params.delete(STEP);
  else params.set(STEP, step);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** How many history entries past the interview's own a step sits — how far Back can go before it leaves. */
export function stepDepth(step: OpeningStep, steps: readonly OpeningStep[]): number {
  return Math.max(0, steps.indexOf(step));
}

/**
 * What the interview writes into each history entry it makes: which visit to the page made it (a reload or coming
 * back is a new visit), the step, and the entry's place in the tab's history. An earlier visit's entries stay in the
 * history, ahead and behind, and Back used to walk into them: onto a later step of an interview that wasn't on screen,
 * blank, or through the same steps twice after a Resume.
 */
export interface StepEntry {
  visit: string;
  step: OpeningStep;
  at: number;
}

const ENTRY = "lineSelectInterview";

export function stepEntryOf(state: unknown): StepEntry | null {
  const e = state && typeof state === "object" ? (state as Record<string, unknown>)[ENTRY] : null;
  if (!e || typeof e !== "object") return null;
  const { visit, step, at } = e as Partial<StepEntry>;
  return typeof visit === "string" && typeof step === "string" && typeof at === "number" ? { visit, step, at } : null;
}

/** The history state for an entry. Only ours: the router copies its own in (see the app router's pushState). */
export function stateForEntry(entry: StepEntry): Record<string, StepEntry> {
  return { [ENTRY]: entry };
}

/**
 * What to do when Back or Forward lands on an entry. One of this visit's: show its step. One of an earlier visit's:
 * step on over it, the way the pilot was going — or, going forward with nothing past it, back to this visit's own.
 * One without a mark (from before the interview marked them): the address says the step, as it always did.
 */
export type PopMove = { kind: "show"; step: OpeningStep } | { kind: "go"; by: number } | { kind: "address" };

export function popMove(entry: StepEntry | null, visit: string, lastOwnAt: number, historyLength: number): PopMove {
  if (!entry) return { kind: "address" };
  if (entry.visit === visit) return { kind: "show", step: entry.step };
  if (entry.at < lastOwnAt) return { kind: "go", by: -1 };
  if (entry.at < historyLength - 1) return { kind: "go", by: 1 };
  return { kind: "go", by: lastOwnAt - entry.at };
}

/**
 * The history moves that take the pilot from the entry `fromDepth` past the interview's own to a step, as if they'd
 * stepped there: entries pushed for each step forward, or back over this visit's own. Never a step pushed twice.
 */
export function stepsBetween(fromDepth: number, to: OpeningStep, steps: readonly OpeningStep[]): { push: OpeningStep[]; back: number } {
  const a = fromDepth;
  const b = stepDepth(to, steps);
  return b >= a ? { push: steps.slice(a + 1, b + 1), back: 0 } : { push: [], back: a - b };
}
