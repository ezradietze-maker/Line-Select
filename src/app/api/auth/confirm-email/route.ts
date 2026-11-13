import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, confirmEmail, getUserForSessionToken, sessionCookieOptions } from "@/lib/server/auth";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { checkRequestLimit, deviceIdFrom, rateLimitedResponse } from "@/lib/server/rate-limit";
import { crossSiteRefusal } from "@/lib/server/same-origin";

export const runtime = "nodejs";

/**
 * Opens the link from a confirm email (the `/confirm-email` page sends its token here). A POST from that page, not the
 * link itself, so a mail program fetching links to check them doesn't spend it. What comes back says how it went:
 * "confirmed" (and how this device now stands, see `confirmEmail`), "used", "expired" or "invalid".
 */
export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  if (!(await checkRequestLimit("auth-confirm-email", request, 30, 60 * 60)).ok) return rateLimitedResponse();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body) || !isText(body.token, 200) || !body.token) return NextResponse.json({ status: "invalid" }, { status: 400 });

  const signedIn = await getUserForSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  const result = await confirmEmail(body.token, signedIn?.id ?? null, deviceIdFrom(request));
  if (result.status !== "confirmed") {
    return NextResponse.json(result, { status: result.status === "invalid" ? 400 : result.status === "expired" ? 410 : 409, headers: { "Cache-Control": "no-store" } });
  }
  const { sessionToken, ...shown } = result;
  // Another account signed in here sees only that the link worked, not whose account it was.
  const response = NextResponse.json(shown.signedIn === "other-account" ? { status: "confirmed", signedIn: "other-account" } : shown, { headers: { "Cache-Control": "no-store" } });
  if (sessionToken) response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  return response;
}
