import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentServerUser();
  return NextResponse.json({ user });
}
