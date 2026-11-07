import { NextResponse } from "next/server";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { SESSION_COOKIE, login, sessionCookieOptions } from "@/lib/server/auth";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import { crossSiteRefusal } from "@/lib/server/same-origin";

export const runtime = "nodejs";

/** Sign-in attempts from one address in 15 minutes, across every email — enough for a crew room signing in at once, not for trying passwords on many accounts. */
const ATTEMPTS_PER_ADDRESS = 60;

// login() (lib/server/auth.ts) also limits attempts per email, protecting each account whatever address the
// guesses come from; this limit is the other half, against one address working through many accounts.
export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  const { ok } = await checkRateLimit("auth-login", clientIp(request), ATTEMPTS_PER_ADDRESS, 15 * 60);
  if (!ok) return rateLimitedResponse();

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const { email, password } = body;
  if (!isText(email, 200) || !isText(password, 500)) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const result = await login(email, password, clientIp(request));
  if (!result.ok || !result.user || !result.sessionToken) {
    return NextResponse.json({ error: result.error ?? "Something went wrong." }, { status: 401 });
  }

  const response = NextResponse.json({ user: result.user });
  response.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  return response;
}
