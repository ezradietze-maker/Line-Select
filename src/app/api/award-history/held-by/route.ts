import { NextResponse } from "next/server";
import { forecastPackKey } from "@/lib/forecast/forecast";
import { heldByFrom } from "@/lib/server/award-aggregate";
import { getCurrentServerUser } from "@/lib/server/auth";
import { listAwardRowsForPack } from "@/lib/server/db";
import { loadActiveModel } from "@/lib/server/learning-store";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import type { HeldByView } from "@/types/award-history";
import type { Seat } from "@/types/bidpack";

export const runtime = "nodejs";

/**
 * Who held what for one pack, from pilots who agreed to show it. Sign-in only: a seniority number leads back to a
 * person for anyone with the list, so this never answers the open internet the way the group numbers do.
 */
export async function GET(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to see who held what." }, { status: 401 });
  if (!(await checkRateLimit("award-held-by", user.id, 120, 60 * 60)).ok) return rateLimitedResponse();
  const { searchParams } = new URL(request.url);
  const base = searchParams.get("base");
  const aircraft = searchParams.get("aircraft");
  const seat = searchParams.get("seat");
  const month = searchParams.get("month");
  if (!base || !aircraft || !seat || !month) return NextResponse.json({ error: "Missing base, aircraft, seat or month." }, { status: 400 });
  const [rows, calibration] = await Promise.all([
    listAwardRowsForPack(forecastPackKey({ month, base, aircraft, seat: seat as Seat })),
    loadActiveModel("forecast-calibration").catch(() => null),
  ]);
  const view: HeldByView = { holders: heldByFrom(rows), oddsCheckedAgainst: calibration?.sampleSize ?? null };
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}
