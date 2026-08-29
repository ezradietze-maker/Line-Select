import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions, signUp } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { email?: string; password?: string; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { email, password, displayName } = body;
  if (!email || !password || !displayName) {
    return NextResponse.json({ error: "Email, password, and display name are required." }, { status: 400 });
  }

  const result = await signUp(email, password, displayName);
  if (!result.ok || !result.user || !result.sessionToken) {
    return NextResponse.json({ error: result.error ?? "Something went wrong." }, { status: 400 });
  }

  const response = NextResponse.json({ user: result.user });
  response.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  return response;
}
