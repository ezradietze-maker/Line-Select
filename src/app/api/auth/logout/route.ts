import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, endSession } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await endSession(token);

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
