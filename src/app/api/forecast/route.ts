import { NextResponse } from "next/server";
import { FEATURE_COUNT, type LineFeatures } from "@/lib/forecast/features";
import { forecastFromFeatures, resolveBidPosition } from "@/lib/forecast/forecast";
import { getCurrentServerUser } from "@/lib/server/auth";
import { loadKnownRankings, removeSubmission, saveSubmission } from "@/lib/server/forecast-store";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_LINES = 1500;
const MAX_PILOTS = 3000;
const SERVER_SIMULATIONS = 400;

interface Body {
  packKey?: unknown;
  lineIds?: unknown;
  lineNumbers?: unknown;
  features?: unknown;
  seniorityList?: unknown;
  regularLines?: unknown;
  dropoutRate?: unknown;
  seniorityNumber?: unknown;
  ranking?: unknown;
  share?: unknown;
}

const isStringArray = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= max && v.every((x) => typeof x === "string" && x.length <= 40);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Runs the bid forecast. The client sends numbers only — the pack's standardized
 * line features, the seniority list (two numbers a pilot), and the pilot's own
 * ranking — never the bid pack. When the pilot is signed in and asks to share,
 * their ranking is stored so it improves everyone else's forecast; only
 * probabilities ever come back.
 */
export async function POST(request: Request) {
  const { ok } = await checkRateLimit("forecast", clientIp(request), 20, 60);
  if (!ok) return rateLimitedResponse();

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { packKey, lineIds, lineNumbers, features, seniorityList, regularLines, dropoutRate, seniorityNumber, ranking } = body;
  if (typeof packKey !== "string" || packKey.length === 0 || packKey.length > 100) return NextResponse.json({ error: "Missing pack." }, { status: 400 });
  if (!isStringArray(lineIds, MAX_LINES) || !isStringArray(lineNumbers, MAX_LINES) || lineIds.length !== lineNumbers.length) return NextResponse.json({ error: "Malformed lines." }, { status: 400 });
  const L = lineIds.length;
  if (!Array.isArray(features) || features.length !== L * FEATURE_COUNT || !features.every((x) => isFiniteNumber(x) && Math.abs(x) < 50)) return NextResponse.json({ error: "Malformed line features." }, { status: 400 });
  if (!Array.isArray(seniorityList) || seniorityList.length === 0 || seniorityList.length > MAX_PILOTS || !seniorityList.every((e) => Array.isArray(e) && e.length === 2 && Number.isInteger(e[0]) && Number.isInteger(e[1]))) return NextResponse.json({ error: "Malformed seniority list." }, { status: 400 });
  if (!Number.isInteger(seniorityNumber) || (seniorityNumber as number) < 1 || (seniorityNumber as number) > 999999) return NextResponse.json({ error: "Enter a valid seniority number." }, { status: 400 });
  if (!Array.isArray(ranking) || ranking.length === 0 || ranking.length > L || !ranking.every((i) => Number.isInteger(i) && i >= 0 && i < L)) return NextResponse.json({ error: "Malformed ranking." }, { status: 400 });

  const list = (seniorityList as number[][]).map(([bidNumber, seniority]) => ({ bidNumber, seniority }));
  const lineFeatures: LineFeatures = { lineIds, lineNumbers, values: Float64Array.from(features as number[]), lineCount: L };
  const seniority = seniorityNumber as number;

  const user = await getCurrentServerUser();
  const { known, total } = await loadKnownRankings(packKey, lineNumbers, user?.id ?? null);

  const forecast = forecastFromFeatures({
    packKey,
    features: lineFeatures,
    seniorityList: list,
    regularLines: isFiniteNumber(regularLines) ? regularLines : L,
    dropoutRate: isFiniteNumber(dropoutRate) ? Math.min(0.5, Math.max(0, dropoutRate)) : 0.08,
    seniorityNumber: seniority,
    myRanking: ranking as number[],
    known,
    simulations: SERVER_SIMULATIONS,
  });

  let shared: "stored" | "not-signed-in" | "not-requested" | "position-taken" | "store-full" | "unlisted" = "not-requested";
  if (body.share === true) {
    const position = resolveBidPosition(list, seniority);
    if (!user) shared = "not-signed-in";
    else if (!position.exact) shared = "unlisted";
    else {
      const saved = await saveSubmission({ packKey, lineNumbers, userId: user.id, bidNumber: position.bidNumber, seniority, ranking: ranking as number[] });
      shared = saved.stored ? "stored" : saved.reason;
    }
  }

  return NextResponse.json({ forecast, crowd: { pilotsSharing: total }, shared });
}

/** Stops sharing: removes the signed-in pilot's stored ranking for this seat. */
export async function DELETE(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { packKey?: unknown; lineNumbers?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.packKey !== "string" || !isStringArray(body.lineNumbers, MAX_LINES)) return NextResponse.json({ error: "Missing pack." }, { status: 400 });
  await removeSubmission(body.packKey, body.lineNumbers, user.id);
  return NextResponse.json({ ok: true });
}
