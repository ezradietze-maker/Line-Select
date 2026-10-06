import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { getCurrentServerUser } from "@/lib/server/auth";
import { createAwardHistoryRecord, listAwardHistoryRecords } from "@/lib/server/db";
import { forecastPackKey } from "@/lib/forecast/forecast";
import { afterResponse } from "@/lib/server/after-response";
import { hashUser } from "@/lib/server/forecast-store";
import { maybeLearn } from "@/lib/server/learning-runner";
import { awardedChoiceFromPrediction } from "@/lib/server/learning-store";
import type { AwardHistoryRecord } from "@/types/award-history";

export const runtime = "nodejs";

/** An integer within a plausible real-world range, or null — every optional numeric field below maps to a Postgres `integer` column, which throws on a fraction or a non-numeric string rather than just rejecting it. */
function isIntOrNull(value: unknown, max: number): value is number | null {
  return value === null || value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max);
}

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

  let body: Partial<AwardHistoryRecord> & { awardedChoice?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const { base, aircraft, seat, month, seniorityRank, seniorityTotalPilots, outcome } = body;
  if (
    !isText(base, 20) ||
    !isText(aircraft, 20) ||
    (seat !== "CAP" && seat !== "FO") ||
    !isText(month, 20) ||
    !Number.isInteger(seniorityRank) ||
    (seniorityRank as number) < 0 ||
    !Number.isInteger(seniorityTotalPilots) ||
    (seniorityTotalPilots as number) < 0 ||
    (outcome !== "line" && outcome !== "reserve" && outcome !== "other") ||
    (body.lineNumber !== undefined && body.lineNumber !== null && !isText(body.lineNumber, 12)) ||
    !isIntOrNull(body.daysOff, 31) ||
    !isIntOrNull(body.totalCreditHours, 500) ||
    !isIntOrNull(body.totalTafbHours, 1000)
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
    seniorityRank: seniorityRank as number,
    seniorityTotalPilots: seniorityTotalPilots as number,
    outcome,
    lineNumber: isLine ? (body.lineNumber ?? null) : null,
    daysOff: isLine ? (body.daysOff ?? null) : null,
    totalCreditHours: isLine ? (body.totalCreditHours ?? null) : null,
    totalTafbHours: isLine ? (body.totalTafbHours ?? null) : null,
    submittedAt: new Date().toISOString(),
  };

  // Linked to the pilot by a one-way hash, so their own months form a history
  // and the forecast they were shown can be checked against what they got.
  // Which of their choices it was comes from that forecast when there is one,
  // otherwise from their own ranking as their browser sent it.
  const pilotHash = hashUser(user.id);
  const packKey = forecastPackKey({ month, base, aircraft, seat });
  const clientChoice = Number.isInteger(body.awardedChoice) && (body.awardedChoice as number) > 0 && (body.awardedChoice as number) <= 2000 ? (body.awardedChoice as number) : null;
  const fromForecast = isLine ? await awardedChoiceFromPrediction(pilotHash, packKey, record.lineNumber).catch(() => null) : null;
  await createAwardHistoryRecord(record, { pilotHash, packKey, awardedChoice: isLine ? (fromForecast ?? clientChoice) : null });
  afterResponse(() => maybeLearn("awards"));
  return NextResponse.json({ record });
}
