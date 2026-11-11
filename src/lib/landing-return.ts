/**
 * Marks the browser's history entry for the landing page once it has been shown, so coming back to it with Back is
 * told apart from arriving at it. A pilot with a pack who arrives is sent on to their rankings; one who taps Back
 * after "Try it with sample data" meant to come back here, and sending them straight on made Back seem to do nothing.
 * The mark lives in the entry's own state (which the router keeps on a return), so a fresh visit never has it.
 */
const SHOWN = "lineSelectLandingShown";

/** Whether this history entry has shown the landing page before: a return by Back or Forward, or a reload of it. */
export function landingShownBefore(historyState: unknown): boolean {
  return typeof historyState === "object" && historyState !== null && (historyState as Record<string, unknown>)[SHOWN] === true;
}

/** The entry's state with the mark added, everything the router keeps there left as it was. */
export function withLandingShown(historyState: unknown): Record<string, unknown> {
  return { ...(typeof historyState === "object" && historyState !== null ? (historyState as Record<string, unknown>) : {}), [SHOWN]: true };
}
