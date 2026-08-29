import { NextResponse } from "next/server";
import { SESSION_COOKIE, login, sessionCookieOptions } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const result = await login(email, password);
  if (!result.ok || !result.user || !result.sessionToken) {
    return NextResponse.json({ error: result.error ?? "Something went wrong." }, { status: 401 });
  }

  const response = NextResponse.json({ user: result.user });
  response.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  return response;
}
