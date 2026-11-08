import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { tradeBoardIsOpen } from "@/lib/server/trade-board-bar";
import type { Seat } from "@/types/bidpack";

export const runtime = "nodejs";

/** Whether this seat's Trade Board has opened yet. Just yes or no, for signed-in pilots, as the board itself is. */
export async function GET(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const base = searchParams.get("base");
  const aircraft = searchParams.get("aircraft");
  const seat = searchParams.get("seat");
  if (!base || !aircraft || !seat) return NextResponse.json({ error: "Missing base, aircraft or seat." }, { status: 400 });
  return NextResponse.json({ open: await tradeBoardIsOpen({ base, aircraft, seat: seat as Seat }) });
}
