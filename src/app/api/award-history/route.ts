import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { getCurrentServerUser } from "@/lib/server/auth";
import { confirmEmailRefusal, fromVerified, isVerified, verifiedPilotHashes } from "@/lib/server/verified-pilots";
import { checkRateLimit, checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { summarizeBands } from "@/lib/server/award-aggregate";
import { createAwardHistoryRecord, deleteAwardShares, listAwardRowsForSeat } from "@/lib/server/db";
import { forecastPackKey } from "@/lib/forecast/forecast";
import { afterResponse } from "@/lib/server/after-response";
import { hashUser } from "@/lib/server/forecast-store";
import { maybeLearn } from "@/lib/server/learning-runner";
import { awardedChoiceFromPrediction } from "@/lib/server/learning-store";
import type { AwardHistoryRecord } from "@/types/award-history";
import type { BidPack } from "@/types/bidpack";

export const runtime = "nodejs";

/** An integer within a plausible real-world range, or null — every optional numeric field below maps to a Postgres `integer` column, which throws on a fraction or a non-numeric string rather than just rejecting it. */
function isIntOrNull(value: unknown, max: number): value is number | null {
  return value === null || value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max);
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** How far back a month may be shared (a logbook check-in on an older month), and how far ahead (next month's award). */
const MONTHS_BACK = 24;
const MONTHS_AHEAD = 3;

/**
 * A bid month as packs print it ("OCT26"), within a couple of years of now. Any text used to do: one pilot could share
 * a "month" for every made-up name, each a report of its own, and outweigh every other pilot in their slice's numbers
 * and in how flown months judge the fleet notes.
 */
function isShareableMonth(value: unknown, now = new Date()): value is string {
  const m = typeof value === "string" ? value.match(/^([A-Z]{3})(\d{2})$/) : null;
  const month = m ? MONTHS.indexOf(m[1]) : -1;
  if (!m || month < 0) return false;
  const at = (2000 + Number(m[2])) * 12 + month;
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return at >= current - MONTHS_BACK && at <= current + MONTHS_AHEAD;
}

/**
 * GET gives the group numbers for one base/aircraft/seat, held back for small
 * groups — no sign-in required, since it never returns a single report. POST
 * requires sign-in as a spam gate, and to tag the report with the pilot's own
 * one-way hash; DELETE takes their reports back by that same hash.
 */

export async function GET(request: Request) {
  if (!(await checkRequestLimit("award-history-read", request, 120, 60 * 60)).ok) return rateLimitedResponse();
  const { searchParams } = new URL(request.url);
  const base = searchParams.get("base");
  const aircraft = searchParams.get("aircraft");
  const seat = searchParams.get("seat");
  if (!base || !aircraft || !seat) {
    return NextResponse.json({ error: "Missing base, aircraft, or seat." }, { status: 400 });
  }
  // Confirmed accounts' reports only: five made-up accounts would otherwise be five pilots behind a group number.
  const [rows, verified] = await Promise.all([listAwardRowsForSeat({ base, aircraft, seat }), verifiedPilotHashes()]);
  return NextResponse.json(summarizeBands(fromVerified(rows, verified, (r) => r.pilotHash)));
}

export async function POST(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to report what you held." }, { status: 401 });
  }
  if (!isVerified(user)) return confirmEmailRefusal("share what you held");
  // Every report can set off a learning run, and a pilot logs a handful a month at most.
  if (!(await checkRateLimit("award-history", user.id, 20, 60 * 60)).ok) return rateLimitedResponse();

  let body: Partial<AwardHistoryRecord> & { awardedChoice?: unknown; monthFeel?: unknown; brainVersion?: unknown; notesUsed?: unknown; holderShown?: unknown };
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
    !isShareableMonth(month) ||
    !isIntOrNull(seniorityRank, 100_000) ||
    seniorityRank == null ||
    !isIntOrNull(seniorityTotalPilots, 100_000) ||
    seniorityTotalPilots == null ||
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
  // After the month, a re-share carries how it flew, and every share which brain ranked the lines — the real-outcome signal.
  // A field the report leaves out stays undefined, so the report it replaces keeps its answer (`createAwardHistoryRecord`).
  const said = (key: keyof typeof body) => body[key] !== undefined;
  const monthFeel = !said("monthFeel") ? undefined : body.monthFeel === "better" || body.monthFeel === "asExpected" || body.monthFeel === "worse" ? body.monthFeel : null;
  const brainVersion = !said("brainVersion") ? undefined : Number.isInteger(body.brainVersion) && (body.brainVersion as number) > 0 && (body.brainVersion as number) < 10_000 ? (body.brainVersion as number) : null;
  const notesUsed = !said("notesUsed") ? undefined : typeof body.notesUsed === "boolean" ? body.notesUsed : null;
  // Only for a line, and only when the pilot said yes to showing their number beside it.
  const canShowHolder = isLine && !!record.lineNumber && record.seniorityRank >= 1 && record.seniorityRank <= record.seniorityTotalPilots;
  const holderShown = !canShowHolder ? false : !said("holderShown") ? undefined : body.holderShown === true;
  await createAwardHistoryRecord(record, { pilotHash, packKey, awardedChoice: isLine ? (fromForecast ?? clientChoice) : null, monthFeel, brainVersion, notesUsed, holderShown });
  afterResponse(() => maybeLearn("awards"));
  return NextResponse.json({ record });
}

/** A pilot takes their reports back: one month's when the body names it, otherwise all of them. Group numbers change at once; a learned correction drops them at its next refit. */
export async function DELETE(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to withdraw what you shared." }, { status: 401 });
  if (!(await checkRateLimit("award-history-withdraw", user.id, 30, 60 * 60)).ok) return rateLimitedResponse();
  const body: unknown = await request.json().catch(() => null);
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const { base, aircraft, seat, month } = body;
  const one = base !== undefined || aircraft !== undefined || seat !== undefined || month !== undefined;
  if (one && (!isText(base, 20) || !isText(aircraft, 20) || !isText(seat, 20) || !isText(month, 20))) {
    return NextResponse.json({ error: "Missing or invalid month." }, { status: 400 });
  }
  const packKey = one ? forecastPackKey({ month: month as string, base: base as string, aircraft: aircraft as string, seat: seat as BidPack["seat"] }) : undefined;
  return NextResponse.json({ removed: await deleteAwardShares(hashUser(user.id), packKey) });
}
