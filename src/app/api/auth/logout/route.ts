import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, endSession, getUserForSessionToken } from "@/lib/server/auth";
import { ACCOUNT_HEADER } from "@/lib/shown-account";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  // A tab still showing one pilot after another signed in in another tab: its Sign out would end the other pilot's
  // session. It's told so instead, and catches up.
  const claimed = (await headers()).get(ACCOUNT_HEADER);
  if (token && claimed) {
    const user = await getUserForSessionToken(token);
    if (user && user.id !== claimed) return NextResponse.json({ ok: false, otherAccount: true }, { status: 409 });
  }
  if (token) await endSession(token);

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
