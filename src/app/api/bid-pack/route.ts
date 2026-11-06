import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { deleteBidPackRecord, getBidPackRecord, saveBidPackRecord } from "@/lib/server/db";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** Gzipped, as the browser sends it. The biggest real pack compresses to well under 1 MB. */
const MAX_COMPRESSED = 3 * 1024 * 1024;
/** Unzipped: the biggest real pack is about 3.2 MB in the compact format. */
const MAX_EXPANDED = 16 * 1024 * 1024;

/**
 * A signed-in pilot's latest bid pack, kept on the server so it follows them to a new device and survives the
 * browser clearing its storage. The body both ways is the browser's compact pack (`compactBidPack`), gzipped; the
 * server checks it unzips to a pack before keeping it, and keeps the bytes as sent.
 */
export async function GET() {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to load your bid pack." }, { status: 401 });
  const record = await getBidPackRecord(user.id);
  if (!record) return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  return new Response(new Uint8Array(record.data), {
    headers: { "Content-Type": "application/gzip", "Cache-Control": "private, no-store", "X-Pack-Id": encodeURIComponent(record.packId), "X-Saved-At": record.updatedAt },
  });
}

export async function PUT(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to save your bid pack." }, { status: 401 });
  if (!(await checkRateLimit("bid-pack-save", user.id, 30, 60 * 60)).ok) return rateLimitedResponse();

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_COMPRESSED) return NextResponse.json({ error: "That bid pack is too large to save." }, { status: 413 });
  let pack: { id?: unknown; format?: unknown; lines?: unknown };
  try {
    pack = JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED }).toString("utf8"));
  } catch {
    return NextResponse.json({ error: "That isn't a bid pack." }, { status: 400 });
  }
  if (typeof pack?.id !== "string" || !pack.id || pack.id.length > 200 || pack.format !== 2 || !Array.isArray(pack.lines)) {
    return NextResponse.json({ error: "That isn't a bid pack." }, { status: 400 });
  }
  // The demo pack is the same for everyone; there's nothing of the pilot's to keep.
  if (pack.id.startsWith("sample")) return NextResponse.json({ saved: false });
  try {
    await saveBidPackRecord(user.id, pack.id, bytes);
  } catch (e) {
    await reportProblem("profile-save", e, { what: "bid pack" });
    return NextResponse.json({ error: "Couldn't save your bid pack just now." }, { status: 503 });
  }
  return NextResponse.json({ saved: true });
}

export async function DELETE() {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await deleteBidPackRecord(user.id);
  return NextResponse.json({ ok: true });
}
