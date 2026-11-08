import { NextResponse } from "next/server";
import { calibrationReport } from "@/lib/learning/calibration-report";
import type { Calibration } from "@/lib/learning/forecast-learning";
import { loadActiveModel, loadCalibrationCases } from "@/lib/server/learning-store";
import { pilotHashIsKeyed } from "@/lib/server/pilot-hash";
import { secretMatches } from "@/lib/server/secret";

export const runtime = "nodejs";

/**
 * Admin-only: how the award odds have measured up against real shared awards.
 *
 *   GET /api/admin/calibration   Brier scores, what the odds said against what happened by band, counts, the fair test's
 *                                verdict, the correction in use, and whether pilot hashes are keyed on this server.
 *
 * Numbers only: no hash, no line, no seniority number.
 */
export async function GET(request: Request) {
  if (!secretMatches(request.headers.get("x-admin-key"), process.env.ADMIN_API_KEY)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [cases, inUse] = await Promise.all([loadCalibrationCases(), loadActiveModel<Calibration>("forecast-calibration", { fresh: true })]);
  return NextResponse.json(
    {
      pilotHashKeyed: pilotHashIsKeyed(),
      correctionInUse: inUse ? { version: inUse.version, awards: inUse.sampleSize, createdAt: inUse.createdAt } : null,
      ...calibrationReport(cases, inUse?.payload ?? null, new Date()),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
