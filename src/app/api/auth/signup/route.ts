import { NextResponse } from "next/server";
import { AUTH_LIMITS, signUpProblem } from "@/lib/auth-limits";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { SESSION_COOKIE, sessionCookieOptions, signUp } from "@/lib/server/auth";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import { crossSiteRefusal } from "@/lib/server/same-origin";

export const runtime = "nodejs";

/** New accounts one address may make. */
const SIGNUPS_PER_ADDRESS = { hour: 3, day: 10 };

export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  // Per address, whatever the device: a new device costs nothing, and each account brings its own daily AI allowance,
  // so the old per-device limit let one address make 50 accounts an hour. A crew room's few new pilots a day still fit.
  const ip = clientIp(request);
  const [hour, day] = await Promise.all([
    checkRateLimit("auth-signup-address-hour", ip, SIGNUPS_PER_ADDRESS.hour, 60 * 60),
    checkRateLimit("auth-signup-address-day", ip, SIGNUPS_PER_ADDRESS.day, 24 * 60 * 60),
  ]);
  if (!hour.ok || !day.ok) return rateLimitedResponse();

  let body: { email?: string; password?: string; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const { email, password, displayName } = body;
  // Says which field is missing or too long, at the same lengths the form stops at.
  const problem = signUpProblem(email, password, displayName);
  if (problem || !isText(email, AUTH_LIMITS.email) || !isText(password, AUTH_LIMITS.password) || !isText(displayName, AUTH_LIMITS.displayName)) {
    return NextResponse.json({ error: problem ?? "Email, password, and display name are required." }, { status: 400 });
  }

  const result = await signUp(email, password, displayName);
  if (!result.ok || !result.user || !result.sessionToken) {
    return NextResponse.json({ error: result.error ?? "Something went wrong." }, { status: 400 });
  }

  const response = NextResponse.json({ user: result.user, recoveryCode: result.recoveryCode });
  response.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  return response;
}
