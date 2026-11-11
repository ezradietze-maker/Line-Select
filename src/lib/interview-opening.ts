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
