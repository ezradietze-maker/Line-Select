import { NextResponse } from "next/server";
import { isJsonObject } from "@/lib/server/json-body";
import { getCurrentServerUser } from "@/lib/server/auth";
import { reportProblem } from "@/lib/server/alerts";
import { deletePreferenceProfile, getPreferenceProfileRecord, savePreferenceProfile, savePreferenceProfileOver } from "@/lib/server/db";
import { keepReplacedVersion } from "@/lib/server/profile-history";
import type { PreferenceProfile } from "@/types/preferences";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to load your preference profile." }, { status: 401 });
  }
  const record = await getPreferenceProfileRecord(user.id);
  // `updatedAt` is the version this device now holds; it sends it back with its next save (see PUT).
  return NextResponse.json({ profile: record?.profile ?? null, updatedAt: record?.updatedAt ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to save your preference profile." }, { status: 401 });
  }

  let body: { profile?: PreferenceProfile; baseUpdatedAt?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  if (!body.profile || typeof body.profile !== "object" || !body.profile.weights) {
    return NextResponse.json({ error: "Missing or malformed profile." }, { status: 400 });
  }

  if (JSON.stringify(body.profile).length > 1_000_000) {
    return NextResponse.json({ error: "That profile is too large to save." }, { status: 413 });
  }

  try {
    const previous = await getPreferenceProfileRecord(user.id);
    // A save names the version it started from. One that doesn't (a tab opened before this check existed) saves as before.
    if (body.baseUpdatedAt === undefined) {
      await savePreferenceProfile(user.id, body.profile);
      if (previous) await keepReplacedVersion(user.id, previous);
      return NextResponse.json({ ok: true, updatedAt: (await getPreferenceProfileRecord(user.id))?.updatedAt ?? null });
    }
    const base = typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : null;
    const result = await savePreferenceProfileOver(user.id, body.profile, base);
    if (!result.saved) {
      // Saved from another device since this one loaded it: hand back the newer copy to merge with.
      return NextResponse.json({ error: "Your profile changed on another device.", profile: result.current?.profile ?? null, updatedAt: result.current?.updatedAt ?? null }, { status: 409 });
    }
    if (previous) await keepReplacedVersion(user.id, previous);
    return NextResponse.json({ ok: true, updatedAt: result.updatedAt });
  } catch (e) {
    await reportProblem("profile-save", e);
    return NextResponse.json({ error: "Couldn't save your profile just now." }, { status: 503 });
  }
}

export async function DELETE() {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to clear your preference profile." }, { status: 401 });
  }
  await deletePreferenceProfile(user.id);
  return NextResponse.json({ ok: true });
}
