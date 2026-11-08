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

/** One draft per pilot, with the pack it's for: a key per pack let one account fill the store with drafts for made-up packs. */
const keyOf = (userId: string) => `line-select:interview-draft:${userId}`;
/** Where drafts were kept per pack before; read for a day or two until those lapse. */
const olderKeyOf = (userId: string, packId: string) => `line-select:interview-draft:${userId}:${packId}`;
type Stored = { pack: string; draft: unknown } | null;
const packOf = (request: Request) => {
  const pack = new URL(request.url).searchParams.get("pack");
  return isText(pack, 200) ? pack : null;
};

/**
 * A signed-in pilot's unfinished interview, kept on the server as they answer — so it follows them to another device
 * and survives the browser clearing its storage, as the finished interview does in their profile. One draft at a time,
 * with the pack it's for; the body is the interview's own draft record, which only the interview reads.
 */
export async function GET(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to load your interview." }, { status: 401 });
  if (!(await checkRateLimit("interview-draft-read", user.id, 240, 60 * 60)).ok) return rateLimitedResponse();
  const pack = packOf(request);
  if (!pack) return NextResponse.json({ error: "Which bid pack?" }, { status: 400 });
  const stored = await getJson<Stored>(keyOf(user.id));
  const draft = stored ? (stored.pack === pack ? stored.draft : null) : await getJson<unknown>(olderKeyOf(user.id, pack));
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
    await setJson<Stored>(keyOf(user.id), { pack: body.pack, draft: body.draft }, { ttlSeconds: TTL_SECONDS });
  } catch (e) {
    await reportProblem("profile-save", e, { what: "interview draft" });
    return NextResponse.json({ error: "Couldn't save your interview just now." }, { status: 503 });
  }
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await checkRateLimit("interview-draft-delete", user.id, 120, 60 * 60)).ok) return rateLimitedResponse();
  const pack = packOf(request);
  if (!pack) return NextResponse.json({ error: "Which bid pack?" }, { status: 400 });
  // The store has no delete: an empty draft that lapses in a minute reads back as none. Only this pack's draft — a
  // draft since begun for another pack stays.
  const stored = await getJson<Stored>(keyOf(user.id));
  if (stored?.pack === pack) await setJson<Stored>(keyOf(user.id), null, { ttlSeconds: 60 });
  await setJson(olderKeyOf(user.id, pack), null, { ttlSeconds: 60 });
  return NextResponse.json({ ok: true });
}
