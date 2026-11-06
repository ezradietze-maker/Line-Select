import type { NextConfig } from "next";

/**
 * Where the page may load from and talk to. Scripts stay 'unsafe-inline': Next's own inline scripts would otherwise
 * need a per-request nonce, which makes every page render on demand (node_modules/next/dist/docs/01-app/02-guides/
 * content-security-policy.md) — slower on hotel Wi-Fi, for little gain while nothing on the page renders others'
 * HTML. Everything else is strict: no framing, no plugins, no <base> tricks, forms post here only, and data goes
 * only to analytics, the weather service and the dictation service.
 */
const isDev = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://*.posthog.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https://*.posthog.com https://api.open-meteo.com https://archive-api.open-meteo.com wss://streaming.assemblyai.com${isDev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
