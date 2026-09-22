import posthog from "posthog-js";

/**
 * Thin wrapper around the posthog-js singleton `instrumentation-client.ts`
 * already initialized — every call here fails soft (no key configured,
 * posthog-js not yet loaded, a thrown error inside the SDK itself) since
 * this is instrumentation, not a feature, and should never be the reason
 * something else in the app breaks.
 */
const configured = !!process.env.NEXT_PUBLIC_POSTHOG_KEY;

/** Ties events to the real account instead of an anonymous device id — never pass a name or email, only the opaque userId (see Privacy Policy Section 12). */
export function identifyPilot(userId: string): void {
  if (!configured) return;
  try {
    posthog.identify(userId);
  } catch {
    // instrumentation only — never let this break the app
  }
}

/** Call on sign-out so the next session (guest or a different account) doesn't get folded into the outgoing pilot's identity. */
export function resetPilotIdentity(): void {
  if (!configured) return;
  try {
    posthog.reset();
  } catch {
    // ignore
  }
}

/**
 * A small, deliberately short list of named usage events — aggregate
 * signal only. Never pass bid pack content, interview answers, preference
 * facts, or free text here; see Privacy Policy Section 12 for the line
 * this app draws.
 */
export type UsageEvent = "bid_pack_confirmed" | "interview_completed";

export function captureUsageEvent(event: UsageEvent): void {
  if (!configured) return;
  try {
    posthog.capture(event);
  } catch {
    // ignore
  }
}

export function captureClientException(error: unknown): void {
  if (!configured) return;
  try {
    posthog.captureException(error);
  } catch {
    // ignore
  }
}
