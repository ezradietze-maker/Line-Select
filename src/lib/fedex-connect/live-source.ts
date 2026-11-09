/**
 * A live open-time source, behind the existing `OpenTimeSource` seam (`lib/open-time/source.ts`).
 *
 * Everything past `OpenTimeSource` reads an `OpenTimeSnapshot` and doesn't care how it was made. The pasted list builds
 * one with `pasteSnapshot`; this builds the same shape from a FedEx read. So a live snapshot flows into
 * `evaluateOpenTime` exactly as a pasted one does — same scores, same contract checks, same reasons. The only new thing
 * is where the rows come from.
 *
 * The read goes through `FedexClient.fetchLiveOpenTime`, which is a STUB today (see `fedex-client.ts`): it returns
 * fixture text, or throws `LiveFeedNotWiredError` when asked to go live. Nothing here touches a FedEx host.
 */

import type { FedexClient, FedexSessionRef } from "@/lib/fedex-connect/fedex-client";
import { fetchLiveOpenTime, snapshotFromLive, stubFedexClient } from "@/lib/fedex-connect/fedex-client";
import type { OpenTimeSnapshot, OpenTimeSource } from "@/lib/open-time/source";

export interface LiveSourceOptions {
  ref: FedexSessionRef;
  /** Dev-only text to read instead of calling FedEx, passed through to the stub. Omit once the real feed is wired. */
  fixture?: string;
  /** The client to read through. Defaults to the stub; the real client is injected after phase-1 discovery. */
  client?: FedexClient;
}

/**
 * Reads this pilot's open time from their own FedEx connection and returns an `OpenTimeSnapshot`. Marked source "live"
 * (or "fixture" in dev) so the board can say where the list came from; nothing in the rules or scoring branches on it.
 */
export function liveOpenTimeSource({ ref, fixture, client = stubFedexClient }: LiveSourceOptions): OpenTimeSource {
  return {
    async read(): Promise<OpenTimeSnapshot> {
      // With a fixture we read it directly (dev); otherwise we read through the injected client (the stub until wired).
      const response = fixture !== undefined ? await fetchLiveOpenTime(ref, fixture) : await client.fetchLiveOpenTime(ref);
      return snapshotFromLive(response);
    },
  };
}
