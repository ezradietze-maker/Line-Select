import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { renderFeed } from "@/lib/calendar-feed";
import { reportProblem } from "@/lib/server/alerts";
import { feedForToken, hashFeedToken, isFeedToken } from "@/lib/server/calendar-feeds";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** Calendars refresh every few hours; this leaves room for several devices and a pilot who presses refresh. */
const LIMIT_PER_HOUR = 120;
const ADDRESS_LIMIT_PER_HOUR = 2000;
const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * A pilot's private calendar, read by their calendar app with no session: the secret link is the only key, so an unknown
 * or revoked link gets a plain 404. It reads one row and spends nothing: the row holds the trips as last built, and no
 * AI or flight lookup runs here.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/, "");
  if (!isFeedToken(token)) return notFound();
  // Per address as well as per link: each guess at a link is a link of its own, so the per-link limit never met them.
  // Generous, since a crew room's calendars may all come from one address.
  if (!(await checkRateLimit("calendar-feed:address", clientIp(request), ADDRESS_LIMIT_PER_HOUR, 60 * 60)).ok) return rateLimitedResponse();
  if (!(await checkRateLimit("calendar-feed", hashFeedToken(token), LIMIT_PER_HOUR, 60 * 60)).ok) return rateLimitedResponse();
  let feed;
  try {
    feed = await feedForToken(token);
  } catch (e) {
    await reportProblem("calendar-feed", e, { what: "feed read" });
    return new NextResponse("Try again shortly", { status: 503, headers: { "Retry-After": "3600", "Cache-Control": "no-store" } });
  }
  if (!feed) return notFound();
  const body = renderFeed(feed.months, feed.options);
  const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
  const headers = {
    // Always asked afresh, and answered with a 304 if nothing changed: "refresh" has to show a new #1, so the pace is set by REFRESH-INTERVAL in the feed, not by a cache.
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
  };
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(body, {
    headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="line-select.ics"' },
  });
}
