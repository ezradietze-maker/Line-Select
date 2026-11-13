import type { NextConfig } from "next";

/**
 * Where the page may load from and talk to. Scripts stay 'unsafe-inline': Next's own inline scripts would otherwise
 * need a per-request nonce, which makes every page render on demand (node_modules/next/dist/docs/01-app/02-guides/
 * content-security-policy.md) — slower on hotel Wi-Fi, for little gain while nothing on the page renders others'
 * HTML. Everything else is strict: no framing, no plugins, no <base> tricks, forms post here or to VIPS only, and data goes
 * only to analytics, the weather service and the dictation service.
 */
const isDev = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  // No script from PostHog's servers: the SDK is bundled, and told not to fetch any (posthog-loader.ts).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https://*.posthog.com https://api.open-meteo.com https://archive-api.open-meteo.com wss://streaming.assemblyai.com${isDev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  // Send to VIPS posts the bid to pilot.fedex.com, which may pass it through FedEx's PurpleID sign-in (Okta) first: with
  // 'self' alone the browser blocked the post and the pilot's bid never reached VIPS.
  "form-action 'self' https://*.fedex.com https://*.okta.com",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  /* config options here */
  // Lets the dev server serve JS/CSS chunks and HMR when opened from a
  // phone or other device on the same LAN instead of localhost.
  allowedDevOrigins: ["192.168.0.183"],
  // No "X-Powered-By: Next.js" on every answer: it tells a stranger which framework, and so which known holes, to try.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
