/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *  THE ONE HARD BLOCKER — READ THIS BEFORE TOUCHING THIS FILE.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * This is the ONLY place a real FedEx request will ever be made. Right now it makes NONE. `fetchLiveOpenTime` is a STUB.
 *
 * Nobody on this project has FedEx access, and Claude cannot and must not sign in to FedEx or enter any credentials. So
 * the real request/response details are UNKNOWN:
 *   - the actual VIPS / CrewNAV endpoints and their response shapes,
 *   - the size of the per-pilot daily open-time quota,
 *   - how long a FedEx session lasts, and whether a session even works from a server's address.
 *
 * Until a current pilot helps with discovery (step-8 phase 1), this stub returns FIXTURE data only. Do NOT:
 *   - add a `fetch()` to pilot.fedex.com or any FedEx host here or anywhere — not even an unauthenticated one,
 *   - probe, scrape, or "just test" a FedEx URL,
 *   - hard-code endpoints you guessed. Endpoints get filled in from a real pilot's own captured traffic (phase 1),
 *     scrubbed of session tokens and other pilots' names, stored only in `private/`.
 *
 * When this is wired in a later discovery session, the real calls go BELOW the marked line, behind the same typed
 * interface, respecting the poller's quota/back-off (see `poller.ts`) and the five hard limits in `types.ts`.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 */

import type { OpenTimeSnapshot } from "@/lib/open-time/source";
import { parseOpenTimePaste } from "@/lib/open-time/parse";

/**
 * FedEx's own pilot sign-in page (PurpleID on Okta). Opening this is the PILOT'S OWN browser action — their click opens
 * FedEx's real page in a new tab, where they sign in themselves, exactly like Send to VIPS. We never render our own
 * password field, never see the password, and the server never requests this URL. It is only ever an `href` for a link
 * the pilot clicks, and only shown once the live feed is actually wired.
 */
export const FEDEX_SIGN_IN_URL = "https://pilot.fedex.com/";

/**
 * An opaque handle to a pilot's live FedEx session. NEVER the password. With a device-extension (method A) this is
 * resolved on the pilot's device; with a server-held session (method C) it points at the encrypted blob. Its real
 * contents are decided in phase 1, so it's intentionally opaque here.
 */
export interface FedexSessionRef {
  userId: string;
  /** Opaque session identifier — resolves to session material held by the chosen method, never a password. */
  handle: string;
}

/**
 * The raw result of reading open time from FedEx. Its true shape is UNKNOWN (VIPS may render HTML, text, or something
 * else) and is settled in phase 1. For now it carries the list as text, which flows through the SAME parser the pasted
 * list uses — so a live list scores and reads exactly like a pasted one. Structured fields are optional and additive.
 */
export interface LiveOpenTimeResponse {
  /** "fixture" today; "live" once wired. */
  origin: "fixture" | "live";
  /** When FedEx's data was true (epoch ms). */
  readAt: number;
  /** The open-time list as text, read by the existing parser. The live wiring fills this from the real response. */
  text: string;
}

/** Thrown when live reading is attempted before discovery has wired the real calls. Keeps the "coming soon" promise honest. */
export class LiveFeedNotWiredError extends Error {
  constructor() {
    super("The live FedEx feed isn't wired yet. It needs a discovery session with a current pilot (step-8 phase 1).");
    this.name = "LiveFeedNotWiredError";
  }
}

/** The injected interface the poller and live source depend on, so wiring the real client never changes their code. */
export interface FedexClient {
  fetchLiveOpenTime(ref: FedexSessionRef): Promise<LiveOpenTimeResponse>;
}

/**
 * STUB. Returns fixture text for dev, or throws when asked to go live. The real implementation replaces the body below
 * the marked line in a later discovery session — behind this exact signature.
 *
 * @param ref       the pilot's session handle (never a password).
 * @param fixture   dev-only open-time text to return instead of calling FedEx. Supplied by `lib/fedex-connect/fixtures.ts`.
 */
export async function fetchLiveOpenTime(ref: FedexSessionRef, fixture?: string): Promise<LiveOpenTimeResponse> {
  void ref; // the session handle is unused until the real calls exist.

  if (fixture !== undefined) {
    return { origin: "fixture", readAt: Date.now(), text: fixture };
  }

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  //  REAL FEDEX CALLS GO BELOW THIS LINE — and only after phase-1 discovery with a current pilot. Nothing here yet.
  //  Whatever lands here must: honour the poller's quota and back-off, never retry past the quota, decrypt the session
  //  via `lib/server/fedex-session.ts` (never log it), and never send a credential. Until then, we throw.
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  throw new LiveFeedNotWiredError();
}

/** Turn a raw live response into the snapshot the open-time engine reads — the same parser the paste uses, so same results. */
export function snapshotFromLive(response: LiveOpenTimeResponse): OpenTimeSnapshot {
  return { source: response.origin === "live" ? "live" : "fixture", readAt: response.readAt, ...parseOpenTimePaste(response.text) };
}

/** The default client used across the app: the stub. Swapped for the real one, behind `FedexClient`, after discovery. */
export const stubFedexClient: FedexClient = {
  fetchLiveOpenTime: (ref) => fetchLiveOpenTime(ref),
};
