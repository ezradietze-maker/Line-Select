import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { deletePreferenceProfile, getPreferenceProfile, savePreferenceProfile } from "@/lib/server/db";
import type { PreferenceProfile } from "@/types/preferences";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to load your preference profile." }, { status: 401 });
  }
  return NextResponse.json({ profile: await getPreferenceProfile(user.id) });
}

export async function PUT(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to save your preference profile." }, { status: 401 });
  }

  let body: { profile?: PreferenceProfile };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.profile || typeof body.profile !== "object" || !body.profile.weights) {
    return NextResponse.json({ error: "Missing or malformed profile." }, { status: 400 });
  }

  await savePreferenceProfile(user.id, body.profile);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to clear your preference profile." }, { status: 401 });
  }
  await deletePreferenceProfile(user.id);
  return NextResponse.json({ ok: true });
}
