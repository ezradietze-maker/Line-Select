import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { parseCorrections } from "@/lib/learning/validate";
import { getCurrentServerUser } from "@/lib/server/auth";
import { isVerified } from "@/lib/server/verified-pilots";
import { hashUser } from "@/lib/server/forecast-store";
import { saveCorrections } from "@/lib/server/learning-store";
import { checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** A pilot changing values the interview set — the clearest sign of where it gets pilots wrong, and what stops it assuming an answer it shouldn't. */
export async function POST(request: Request) {
  const { ok } = await checkRequestLimit("learning-corrections", request, 20, 60 * 60);
  if (!ok) return rateLimitedResponse();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body) || !isText(body.base, 6) || !isText(body.aircraft, 8) || !isText(body.seat, 4)) {
    return NextResponse.json({ error: "Missing pack." }, { status: 400 });
  }
  const events = parseCorrections(body.events);
  if (!events) return NextResponse.json({ error: "Invalid corrections." }, { status: 400 });
  // Only confirmed pilots teach the fleet, as with interview outcomes.
  const user = await getCurrentServerUser();
  if (!user || !isVerified(user)) return NextResponse.json({ stored: false });
  try {
    await saveCorrections(events, { base: (body.base as string).toUpperCase(), aircraft: (body.aircraft as string).toUpperCase(), seat: (body.seat as string).toUpperCase() }, hashUser(user.id));
  } catch (e) {
    await reportProblem("learning", e, { action: "save corrections" });
    return NextResponse.json({ stored: false }, { status: 503 });
  }
  return NextResponse.json({ stored: true });
}
