import posthog from "posthog-js";

/**
 * Runs before hydration (Next.js's `instrumentation-client` convention —
 * see node_modules/next/dist/docs/01-app/03-api-reference/03-file-
 * conventions/instrumentation-client.md), so this is the one place PostHog
 * actually gets initialized for the browser. See Privacy Policy Section 12
 * for exactly what this collects and doesn't: page views, a small number of
 * named usage events, and unhandled errors — never bid pack content,
 * interview answers, or preference facts, and no name/email are ever
 * attached (see `lib/posthog-client.ts` for where identify() is called).
 *
 * Silently does nothing without a key configured (e.g. local dev without
 * the env var set) — this is instrumentation, not a feature, and should
 * never be the thing that breaks the app.
 */
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

if (key) {
  posthog.init(key, {
    api_host: host,
    // Pageviews are sent manually via onRouterTransitionStart below, which
    // fires on every App Router navigation — the automatic capture this
    // would otherwise do doesn't reliably see client-side route changes.
    capture_pageview: false,
    capture_pageleave: true,
    // No session replay, no autocapture of clicks/form inputs, no
    // rageclick heuristics — this app's whole pitch to pilots is that it
    // doesn't watch what they do, and error/usage monitoring shouldn't
    // quietly become behavioral tracking it never disclosed.
    disable_session_recording: true,
    autocapture: false,
    person_profiles: "identified_only",
  });
}

export function onRouterTransitionStart(url: string) {
  posthog.capture("$pageview", { $current_url: url });
}
