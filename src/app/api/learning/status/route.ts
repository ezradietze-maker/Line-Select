import { NextResponse } from "next/server";
import { runLearningCycle } from "@/lib/server/learning-runner";
import { listRecentRuns, loadActiveModel } from "@/lib/server/learning-store";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const key = request.headers.get("x-admin-key");
  return !!key && key === process.env.ADMIN_API_KEY;
}

/**
 * Admin-only view of the learning: the models in use, what each was scored
 * at, and the recent runs — whether it's actually getting better month over
 * month. Same `ADMIN_API_KEY` gate as the other admin routes.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [interview, prior, calibration, runs] = await Promise.all([
    loadActiveModel("interview", { fresh: true }),
    loadActiveModel("forecast-prior", { fresh: true }),
    loadActiveModel("forecast-calibration", { fresh: true }),
    listRecentRuns(30),
  ]);
  const describe = (m: Awaited<ReturnType<typeof loadActiveModel>>) => (m ? { version: m.version, sampleSize: m.sampleSize, createdAt: m.createdAt, metrics: m.metrics } : null);
  return NextResponse.json({ active: { interview: describe(interview), forecastPrior: describe(prior), forecastCalibration: describe(calibration) }, runs });
}

/** Runs a learning cycle on demand. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const summary = await runLearningCycle("manual");
  return NextResponse.json(summary ?? { skipped: "a run is already in progress" });
}
