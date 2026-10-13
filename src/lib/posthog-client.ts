import { withPosthog } from "@/lib/posthog-loader";

/**
 * Thin wrapper around PostHog, which loads lazily (`lib/posthog-loader.ts`)
 * — every call here fails soft (no key configured, posthog-js not loaded, a
 * thrown error inside the SDK itself) since this is instrumentation, not a
 * feature, and should never be the reason something else in the app breaks.
 */

/** Ties events to the real account instead of an anonymous device id — never pass a name or email, only the opaque userId (see Privacy Policy Section 12). */
export function identifyPilot(userId: string): void {
  withPosthog((posthog) => posthog.identify(userId));
}

/** Call on sign-out so the next session (guest or a different account) doesn't get folded into the outgoing pilot's identity. */
export function resetPilotIdentity(): void {
  withPosthog((posthog) => posthog.reset());
}

/**
 * A small, deliberately short list of named usage events — aggregate
 * signal only. Never pass bid pack content, interview answers, preference
 * facts, or free text here; see Privacy Policy Section 12 for the line
 * this app draws.
 */
export type UsageEvent = "bid_pack_confirmed" | "interview_completed";

export function captureUsageEvent(event: UsageEvent): void {
  withPosthog((posthog) => posthog.capture(event));
}

export function captureClientException(error: unknown): void {
  withPosthog((posthog) => posthog.captureException(error));
}
