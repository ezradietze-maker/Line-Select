import { NextResponse } from "next/server";
import { AUTH_LIMITS, signUpProblem } from "@/lib/auth-limits";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { SESSION_COOKIE, sessionCookieOptions, signUp } from "@/lib/server/auth";
import { checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { crossSiteRefusal } from "@/lib/server/same-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  const { ok } = await checkRequestLimit("auth-signup", request, 5, 60 * 60);
  if (!ok) return rateLimitedResponse();

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
