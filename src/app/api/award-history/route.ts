import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { createAwardHistoryRecord, listAwardHistoryRecords } from "@/lib/server/db";
import type { AwardHistoryRecord } from "@/types/award-history";

export const runtime = "nodejs";

/**
 * GET lists every self-reported hold outcome for one base/aircraft/seat —
 * no sign-in required, since reading an anonymous aggregate carries no
 * abuse risk. POST requires sign-in purely as a spam gate (matching every
 * other server-write route in this app); the stored record itself carries
 * no link back to who submitted it.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const base = searchParams.get("base");
  const aircraft = searchParams.get("aircraft");
  const seat = searchParams.get("seat");
  if (!base || !aircraft || !seat) {
    return NextResponse.json({ error: "Missing base, aircraft, or seat." }, { status: 400 });
  }
  return NextResponse.json({ records: await listAwardHistoryRecords({ base, aircraft, seat }) });
}

export async function POST(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to report what you held." }, { status: 401 });
  }

  let body: Partial<AwardHistoryRecord>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { base, aircraft, seat, month, seniorityRank, seniorityTotalPilots, outcome } = body;
  if (
    !base ||
    !aircraft ||
    (seat !== "CAP" && seat !== "FO") ||
    !month ||
    typeof seniorityRank !== "number" ||
    typeof seniorityTotalPilots !== "number" ||
    (outcome !== "line" && outcome !== "reserve" && outcome !== "other")
  ) {
    return NextResponse.json({ error: "Missing or invalid report details." }, { status: 400 });
  }

  const isLine = outcome === "line";
  const record: AwardHistoryRecord = {
    id: randomUUID(),
    base,
    aircraft,
    seat,
    month,
    seniorityRank,
    seniorityTotalPilots,
    outcome,
    lineNumber: isLine ? (body.lineNumber ?? null) : null,
    daysOff: isLine ? (body.daysOff ?? null) : null,
    totalCreditHours: isLine ? (body.totalCreditHours ?? null) : null,
    totalTafbHours: isLine ? (body.totalTafbHours ?? null) : null,
    submittedAt: new Date().toISOString(),
  };

  await createAwardHistoryRecord(record);
  return NextResponse.json({ record });
}
