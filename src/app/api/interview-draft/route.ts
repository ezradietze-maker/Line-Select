import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { getJson, setJson } from "@/lib/server/kv";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** A long interview's answers, its pilot model and the question on screen come to well under this. */
const MAX_CHARS = 600_000;
/** The interview drops a draft older than a day; the copy here outlives that a little, then goes on its own. */
const TTL_SECONDS = 2 * 24 * 60 * 60;

const keyOf = (userId: string, packId: string) => `line-select:interview-draft:${userId}:${packId}`;
const packOf = (request: Request) => {
  const pack = new URL(request.url).searchParams.get("pack");
  return isText(pack, 200) ? pack : null;
};

/**
 * A signed-in pilot's unfinished interview, kept on the server as they answer — so it follows them to another device
 * and survives the browser clearing its storage, as the finished interview does in their profile. One draft per bid
 * pack; the body is the interview's own draft record, which only the interview reads.
 */
export async function GET(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to load your interview." }, { status: 401 });
  const pack = packOf(request);
  if (!pack) return NextResponse.json({ error: "Which bid pack?" }, { status: 400 });
  const draft = await getJson<unknown>(keyOf(user.id, pack));
  return NextResponse.json({ draft: draft ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to save your interview." }, { status: 401 });
  // Saved after each answer: a long interview is 40 or so; this leaves room for a second device and retries.
  if (!(await checkRateLimit("interview-draft-save", user.id, 240, 60 * 60)).ok) return rateLimitedResponse();
  const body = await readJsonBody(request, MAX_CHARS);
  if (!isJsonObject(body) || !isText(body.pack, 200) || !isJsonObject(body.draft)) {
    return NextResponse.json({ error: "That isn't an interview draft." }, { status: 400 });
  }
  try {
    await setJson(keyOf(user.id, body.pack), body.draft, { ttlSeconds: TTL_SECONDS });
  } catch (e) {
    await reportProblem("profile-save", e, { what: "interview draft" });
    return NextResponse.json({ error: "Couldn't save your interview just now." }, { status: 503 });
  }
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const pack = packOf(request);
  if (!pack) return NextResponse.json({ error: "Which bid pack?" }, { status: 400 });
  // The store has no delete: an empty draft that lapses in a minute reads back as none.
  await setJson(keyOf(user.id, pack), null, { ttlSeconds: 60 });
  return NextResponse.json({ ok: true });
}
