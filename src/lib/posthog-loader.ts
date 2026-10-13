import type { PostHog } from "posthog-js";

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

export const posthogConfigured = !!key;

export function loadPosthog(): Promise<PostHog | null> {
  if (!key || typeof window === "undefined") return Promise.resolve(null);
  loading ??= import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: host,
        // Pageviews are sent manually from `onRouterTransitionStart` in
        // instrumentation-client.ts, which fires on every App Router
        // navigation — the automatic capture doesn't reliably see client-side
        // route changes.
        capture_pageview: false,
        capture_pageleave: true,
        // No session replay, no autocapture of clicks/form inputs, no
        // rageclick heuristics, no surveys — this app's whole pitch to pilots
        // is that it doesn't watch what they do, and error/usage monitoring
        // shouldn't quietly become behavioral tracking it never disclosed.
        disable_session_recording: true,
        disable_surveys: true,
        autocapture: false,
        // Off here, whatever the PostHog project's remote settings say: dead-click and heatmap capture record clicks,
        // and web-vitals reporting isn't among what the Privacy Policy says is collected.
        capture_dead_clicks: false,
        capture_heatmaps: false,
        capture_performance: false,
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
