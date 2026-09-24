import { NextResponse } from "next/server";
import { SESSION_COOKIE, resetPasswordWithEmailToken, sessionCookieOptions } from "@/lib/server/auth";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { ok } = await checkRateLimit("auth-reset-email", clientIp(request), 20, 60 * 60);
  if (!ok) return rateLimitedResponse();

  let body: { token?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.token || !body.newPassword) {
    return NextResponse.json({ error: "A reset link and a new password are required." }, { status: 400 });
  }

  const result = await resetPasswordWithEmailToken(body.token, body.newPassword);
  if (!result.ok || !result.user || !result.sessionToken) {
    return NextResponse.json({ error: result.error ?? "Something went wrong." }, { status: 400 });
  }

  const response = NextResponse.json({ user: result.user });
  response.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  return response;
}
