import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentServerUser();
  // Who's signed in must never be kept by the browser or anything between it and here.
  return NextResponse.json({ user }, { headers: { "Cache-Control": "private, no-store" } });
}
