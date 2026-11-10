/**
 * A live open-time source, behind the existing `OpenTimeSource` seam (`lib/open-time/source.ts`).
 *
 * Everything past `OpenTimeSource` reads an `OpenTimeSnapshot` and doesn't care how it was made. The pasted list builds
 * one with `pasteSnapshot`; this builds the same shape from a FedEx read. So a live snapshot flows into
 * `evaluateOpenTime` exactly as a pasted one does — same scores, same contract checks, same reasons. The only new thing
 * is where the rows come from.
 *
 * The read goes through the shared `FedexScanner` (see `fedex-client.ts`) with screen "open-time" — the SAME scanner
 * View/Add uses. It is a STUB today: it returns fixture text, or throws `LiveFeedNotWiredError` when asked to go live.
 * Nothing here touches a FedEx host.
 */

import type { FedexScanner, FedexSessionRef, LiveListResponse } from "@/lib/fedex-connect/fedex-client";
import { readLoggedInList, stubFedexScanner } from "@/lib/fedex-connect/fedex-client";
import { parseOpenTimePaste } from "@/lib/open-time/parse";
import type { OpenTimeSnapshot, OpenTimeSource } from "@/lib/open-time/source";

export interface LiveSourceOptions {
  ref: FedexSessionRef;
  /** Dev-only text to read instead of calling FedEx, passed through to the stub. Omit once the real feed is wired. */
  fixture?: string;
  /** The scanner to read through. Defaults to the stub; the real scanner is injected after phase-1 discovery. */
  scanner?: FedexScanner;
}

/** Turn a raw list read into the snapshot the open-time engine reads — the same parser the paste uses, so same results. */
export function snapshotFromLive(response: LiveListResponse): OpenTimeSnapshot {
  return { source: response.origin === "live" ? "live" : "fixture", readAt: response.readAt, ...parseOpenTimePaste(response.text) };
}

/**
 * Reads this pilot's open time from their own FedEx connection and returns an `OpenTimeSnapshot`. Marked source "live"
 * (or "fixture" in dev) so the board can say where the list came from; nothing in the rules or scoring branches on it.
 */
export function liveOpenTimeSource({ ref, fixture, scanner = stubFedexScanner }: LiveSourceOptions): OpenTimeSource {
  return {
    async read(): Promise<OpenTimeSnapshot> {
      // With a fixture we read it directly (dev); otherwise we read through the injected scanner (the stub until wired).
      const response = fixture !== undefined ? await readLoggedInList(ref, "open-time", fixture) : await scanner.readList(ref, "open-time");
      return snapshotFromLive(response);
    },
  };
}
