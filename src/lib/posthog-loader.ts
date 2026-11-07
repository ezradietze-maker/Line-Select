import type { CaptureResult, PostHog } from "posthog-js";

/**
 * PostHog, fetched and started only when something first needs it — after
 * the page has gone idle (see `instrumentation-client.ts`), or the first
 * event, whichever comes first. The SDK is several hundred KB; loaded up
 * front it sat in the way of every screen's first paint for something that
 * is instrumentation, not a feature. Resolves null without a key configured
 * or if the SDK fails to load — every caller treats it as optional.
 */
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let loading: Promise<PostHog | null> | null = null;

/** Every URL-ish property of an event with any `token=` value blanked out. */
function withoutTokens(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  const scrub = (props: Record<string, unknown> | undefined) => {
    if (!props) return;
    for (const [k, v] of Object.entries(props)) if (typeof v === "string" && v.includes("token=")) props[k] = v.replace(/([?&#]token=)[^&#]*/g, "$1removed");
  };
  scrub(event.properties);
  scrub(event.$set);
  scrub(event.$set_once);
  return event;
}

export const posthogConfigured = !!key;

export function loadPosthog(): Promise<PostHog | null> {
  if (!key || typeof window === "undefined") return Promise.resolve(null);
  loading ??= import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: host,
        // The page they're on when it starts, then each change of path. Sent by hand from the router's transition
        // start, a pageview carried the page being left (the address hadn't changed yet) and the first page of
        // every visit was never counted.
        capture_pageview: "history_change",
        // A reset link's token never leaves the browser, even when a pageview is sent before the page takes it out
        // of the address bar.
        before_send: withoutTokens,
        capture_pageleave: true,
        // No session replay, no autocapture of clicks/form inputs, no
        // rageclick heuristics, no surveys — this app's whole pitch to pilots
        // is that it doesn't watch what they do, and error/usage monitoring
        // shouldn't quietly become behavioral tracking it never disclosed.
        disable_session_recording: true,
        disable_surveys: true,
        autocapture: false,
        // Off here, whatever the PostHog project's remote settings say: dead-click and heatmap capture record clicks.
        capture_dead_clicks: false,
        capture_heatmaps: false,
        // Page speed only (how fast pages load and answer taps — Google's four web vitals), as the Privacy Policy
        // says: no network timings (they'd list the requests made), and no attribution naming what was tapped.
        capture_performance: { web_vitals: true, network_timing: false, web_vitals_attribution: false },
        person_profiles: "identified_only",
      });
      return posthog;
    })
    .catch(() => null);
  return loading;
}

/** Runs `f` against PostHog once it's loaded; never throws, never blocks the caller. */
export function withPosthog(f: (posthog: PostHog) => void): void {
  if (!key) return;
  void loadPosthog().then((posthog) => {
    if (!posthog) return;
    try {
      f(posthog);
    } catch {
      // instrumentation only — never let this break the app
    }
  });
}
