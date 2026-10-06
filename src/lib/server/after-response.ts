import { after } from "next/server";

/**
 * Runs work after the response is sent (Next's `after`), so recording data
 * for the learning never slows a pilot down. Outside a request — a route
 * handler called directly from a test — it simply runs the work, unawaited.
 */
export function afterResponse(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work().catch((e) => console.error("[after-response] background work failed", e));
  }
}
