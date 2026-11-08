import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { feedStatus, revokeFeed, setFeedOptions, startFeed, syncFeed, type FeedChoice } from "@/lib/server/calendar-feeds";
import { isJsonObject } from "@/lib/server/json-body";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function signedIn() {
  const user = await getCurrentServerUser();
  if (!user) return { error: NextResponse.json({ error: "Sign in to use a calendar link." }, { status: 401 }) };
  if (!(await checkRateLimit("calendar-feed-manage", user.id, 120, 60 * 60)).ok) return { error: rateLimitedResponse() };
  return { user };
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return isJsonObject(body) ? body : null;
}

const failed = async (e: unknown, what: string) => {
  await reportProblem("calendar-feed", e, { what });
  return NextResponse.json({ error: "Couldn't update your calendar link just now." }, { status: 503 });
};

/** Whether the pilot has a live link. The link itself can't be read back. */
export async function GET() {
  const { user, error } = await signedIn();
  if (error) return error;
  try {
    return NextResponse.json(await feedStatus(user.id), { headers: NO_STORE });
  } catch (e) {
    return failed(e, "status");
  }
}

/** Makes a link, replacing any old one. The one time the link is ever sent. */
export async function POST(request: Request) {
  const { user, error } = await signedIn();
  if (error) return error;
  const body = await bodyOf(request);
  const options = typeof body?.homeDays === "boolean" ? { homeDays: body.homeDays } : undefined;
  try {
    const { token, status } = await startFeed(user.id, options);
    return NextResponse.json({ ...status, url: `${new URL(request.url).origin}/api/calendar/${token}.ics` }, { headers: NO_STORE });
  } catch (e) {
    return failed(e, "start");
  }
}

export async function PATCH(request: Request) {
  const { user, error } = await signedIn();
  if (error) return error;
  const body = await bodyOf(request);
  if (typeof body?.homeDays !== "boolean") return NextResponse.json({ error: "Invalid option." }, { status: 400 });
  try {
    return NextResponse.json(await setFeedOptions(user.id, { homeDays: body.homeDays }), { headers: NO_STORE });
  } catch (e) {
    return failed(e, "options");
  }
}

function readChoice(body: Record<string, unknown> | null): FeedChoice | null {
  if (!body) return null;
  const { packId, lineNumber, lineSource, pilotClose } = body;
  if (typeof packId !== "string" || !packId || packId.length > 200) return null;
  if (lineNumber !== null && (typeof lineNumber !== "string" || lineNumber.length > 20)) return null;
  if (lineSource !== null && lineSource !== "awarded" && lineSource !== "top") return null;
  if (pilotClose !== null && (typeof pilotClose !== "string" || !Number.isFinite(Date.parse(pilotClose)))) return null;
  return { packId, lineNumber, lineSource, pilotClose };
}

/** The pilot's choice has changed in the browser: which line this pack's month shows. Quietly does nothing with no live link. */
export async function PUT(request: Request) {
  const { user, error } = await signedIn();
  if (error) return error;
  const choice = readChoice(await bodyOf(request));
  if (!choice) return NextResponse.json({ error: "Invalid choice." }, { status: 400 });
  try {
    const result = await syncFeed(user.id, choice);
    return NextResponse.json({ result }, { headers: NO_STORE });
  } catch (e) {
    return failed(e, "sync");
  }
}

export async function DELETE() {
  const { user, error } = await signedIn();
  if (error) return error;
  try {
    await revokeFeed(user.id);
    return NextResponse.json({ on: false }, { headers: NO_STORE });
  } catch (e) {
    return failed(e, "revoke");
  }
}
