/**
 * A live View/Add source: reads the pilot's View/Add make-up list straight from FedEx, instead of them pasting it.
 *
 * It mirrors `liveOpenTimeSource` exactly — the SAME shared scanner (`FedexScanner` in `fedex-client.ts`), the same
 * encrypted session store and contract-aware poller — only pointed at the View/Add make-up screen ("view-add-makeup")
 * rather than the open-time screen. The list comes back as text and flows through View/Add's own parser
 * (`parseOpenTimeList`, which itself calls the open-time parser), then into View/Add's existing combination and ranking
 * logic (`buildViewAdd`), exactly the way a pasted list does today. Scanning is READ-ONLY: it never submits. The pilot's
 * preference list still goes into VIPS the unchanged way (the VIPS form in a new tab, the pilot signed in).
 *
 * Why its live value is lower than open time's: the View/Add window is a planned block of at least ~48 hours
 * (CBA 2026 25.E.4), not a race for a trip that could vanish in minutes. So reading it live is a convenience — skip the
 * copy-paste — not a "be first" edge. Open time is where live reading actually wins.
 *
 * The read is a STUB today (see `fedex-client.ts`): fixture text, or `LiveFeedNotWiredError` when asked to go live.
 * Nothing here touches a FedEx host.
 */

import type { FedexScanner, FedexSessionRef } from "@/lib/fedex-connect/fedex-client";
import { readLoggedInList, stubFedexScanner } from "@/lib/fedex-connect/fedex-client";
import { parseOpenTimeList, type PastedEntry } from "@/lib/view-add";

export interface LiveViewAddOptions {
  ref: FedexSessionRef;
  /** Dev-only text to read instead of calling FedEx, passed through to the stub. Omit once the real feed is wired. */
  fixture?: string;
  /** The scanner to read through. Defaults to the stub; the real scanner is injected after phase-1 discovery. */
  scanner?: FedexScanner;
}

/** What a live View/Add read yields: the raw list text (to drop into the paste box / build) plus the parsed entries. */
export interface LiveViewAddResult {
  /** "fixture" in dev, "live" once wired. */
  origin: "fixture" | "live";
  /** When FedEx's data was true (epoch ms). */
  readAt: number;
  /** The list as text, exactly what a pilot would paste. `buildViewAdd` takes this as its `pasted` input. */
  text: string;
  /** The same parse `parseOpenTimeList` gives the paste, so callers can show/preview without re-parsing. */
  entries: PastedEntry[];
  /** Lines the parser couldn't read, shown to the pilot, never guessed at. */
  notRead: string[];
}

/** A source that reads the View/Add make-up list for one pilot from their own FedEx connection. */
export interface ViewAddLiveSource {
  read(): Promise<LiveViewAddResult>;
}

export function liveViewAddSource({ ref, fixture, scanner = stubFedexScanner }: LiveViewAddOptions): ViewAddLiveSource {
  return {
    async read(): Promise<LiveViewAddResult> {
      // With a fixture we read it directly (dev); otherwise through the injected scanner (the stub until wired).
      const response = fixture !== undefined ? await readLoggedInList(ref, "view-add-makeup", fixture) : await scanner.readList(ref, "view-add-makeup");
      const { entries, notRead } = parseOpenTimeList(response.text);
      return { origin: response.origin, readAt: response.readAt, text: response.text, entries, notRead };
    },
  };
}
