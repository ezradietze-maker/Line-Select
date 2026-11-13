import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { afterResponse } from "@/lib/server/after-response";
import { isJsonObject } from "@/lib/server/json-body";
import { FEATURE_COUNT, type LineFeatures } from "@/lib/forecast/features";
import { forecastWithCore, resolveBidPosition } from "@/lib/forecast/forecast";
import { applyCalibration, resolveForecastPrior, type Calibration, type ForecastPriorModel } from "@/lib/learning/forecast-learning";
import { getCurrentServerUser } from "@/lib/server/auth";
import { blobKey, hashUser, loadKnownRankings, removeSubmission, saveSubmission } from "@/lib/server/forecast-store";
import { deleteForecastPrediction, loadActiveModel, parsePackKey, saveForecastPrediction, savePackFeatures } from "@/lib/server/learning-store";
import { checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_LINES = 1500;
const MAX_PILOTS = 3000;
/** Shared rankings ahead of the asked place before any are used — fewer, and one could be picked out (see the POST). */
const MIN_SHARERS_AHEAD = 3;
const SERVER_SIMULATIONS = 400;
const DEFAULT_DROPOUT = 0.08;

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
// Bid numbers and seniority numbers are stored in integer columns: one past their range fails the whole share.
const isIntIn = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Runs the bid forecast. The client sends numbers only — the pack's standardized
 * line features, the seniority list (two numbers a pilot), and the pilot's own
 * ranking — never the bid pack. When the pilot is signed in and asks to share,
 * their ranking is stored so it improves everyone else's forecast; only
 * probabilities ever come back.
 */
export async function POST(request: Request) {
  const { ok } = await checkRequestLimit("forecast", request, 20, 60);
  if (!ok) return rateLimitedResponse();

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const { packKey, lineIds, lineNumbers, features, seniorityList, regularLines, dropoutRate, seniorityNumber, ranking } = body;
  if (typeof packKey !== "string" || packKey.length === 0 || packKey.length > 100) return NextResponse.json({ error: "Missing pack." }, { status: 400 });
  if (!isStringArray(lineIds, MAX_LINES) || !isStringArray(lineNumbers, MAX_LINES) || lineIds.length !== lineNumbers.length) return NextResponse.json({ error: "Malformed lines." }, { status: 400 });
  const L = lineIds.length;
  if (!Array.isArray(features) || features.length !== L * FEATURE_COUNT || !features.every((x) => isFiniteNumber(x) && Math.abs(x) < 50)) return NextResponse.json({ error: "Malformed line features." }, { status: 400 });
  if (!Array.isArray(seniorityList) || seniorityList.length === 0 || seniorityList.length > MAX_PILOTS || !seniorityList.every((e) => Array.isArray(e) && (e.length === 2 || (e.length === 3 && (e[2] === 0 || e[2] === 1))) && isIntIn(e[0], 1, 100_000) && isIntIn(e[1], 1, 999_999))) return NextResponse.json({ error: "Malformed seniority list." }, { status: 400 });
  if (!Number.isInteger(seniorityNumber) || (seniorityNumber as number) < 1 || (seniorityNumber as number) > 999999) return NextResponse.json({ error: "Enter a valid seniority number." }, { status: 400 });
  if (!Array.isArray(ranking) || ranking.length === 0 || ranking.length > L || !ranking.every((i) => Number.isInteger(i) && i >= 0 && i < L)) return NextResponse.json({ error: "Malformed ranking." }, { status: 400 });

  const sentList = (seniorityList as number[][]).map(([bidNumber, seniority, pay]) => ({ bidNumber, seniority, ...(pay === 1 ? { pay: true } : {}) }));
  const lineFeatures: LineFeatures = { lineIds, lineNumbers, values: Float64Array.from(features as number[]), lineCount: L };
  const seniority = seniorityNumber as number;

  const user = await getCurrentServerUser();
  const sharing = await loadKnownRankings(packKey, lineNumbers, user?.id ?? null);
  const total = sharing.total;
  // Other pilots' shared rankings sharpen the forecast, but the list of who's ahead is the caller's own: a guest, or
  // anyone with fewer than a few sharers ahead of the place they ask about, could put one known pilot alone ahead of
  // them and read that pilot's first choice off which line drops to 0% open. Only signed-in pilots, and only when
  // several sharers sit ahead, so no one ranking can be picked out.
  // Counted only among those the caller's list has bidding: marking everyone else PAY (or leaving them off) left one
  // sharer the only one bidding ahead, however many were counted.
  const askedAt = resolveBidPosition(sentList, seniority).bidNumber;
  const bidding = new Set(sentList.map((e) => e.bidNumber));
  const known = user && sharing.known.filter((k) => k.bidNumber < askedAt && bidding.has(k.bidNumber)).length >= MIN_SHARERS_AHEAD ? sharing.known : [];
  // With shared rankings in it, who bids isn't the caller's to choose: no one is left out as PAY, and pilots drop out
  // at no less than the usual rate, so a list built round one sharer can't single out their first choice.
  const list = known.length ? sentList.map(({ bidNumber, seniority: s }) => ({ bidNumber, seniority: s })) : sentList;
  const sentDropout = isFiniteNumber(dropoutRate) ? Math.min(0.5, Math.max(0, dropoutRate)) : DEFAULT_DROPOUT;
  const dropout = known.length ? Math.max(DEFAULT_DROPOUT, sentDropout) : sentDropout;

  // What the fleet has learned: starting beliefs from past months at this
  // seat, and a correction from how past forecasts compared with real awards.
  // Missing (a new database, an outage) just means the forecast runs on its
  // reasoned defaults, exactly as before.
  const parts = parsePackKey(packKey);
  const [priorModel, calibration] = await Promise.all([
    loadActiveModel<ForecastPriorModel>("forecast-prior").catch(() => null),
    loadActiveModel<Calibration>("forecast-calibration").catch(() => null),
  ]);
  const learnedPrior = priorModel && parts ? resolveForecastPrior(priorModel.payload, parts.base, parts.aircraft, parts.seat) : null;

  const { forecast, core } = forecastWithCore({
    packKey,
    features: lineFeatures,
    seniorityList: list,
    regularLines: isFiniteNumber(regularLines) ? regularLines : L,
    dropoutRate: dropout,
    seniorityNumber: seniority,
    myRanking: ranking as number[],
    known,
    simulations: SERVER_SIMULATIONS,
    learnedPrior,
    calibrate: calibration ? (p) => applyCalibration(calibration.payload, p) : undefined,
  });

  // Kept for the learning, after the response: this month's line features
  // (numbers only), and for a signed-in pilot who shares, the raw forecast
  // they were shown — checked against the award they report later. Only a
  // signed-in pilot's features are kept: the first copy under a key stays, and
  // a guest's, made up and sent first, would be what every pilot's rankings
  // and awards for the pack were read against.
  const position = resolveBidPosition(list, seniority);
  afterResponse(async () => {
    if (!user) return;
    try {
      const key = blobKey(packKey, lineNumbers);
      await savePackFeatures(key, packKey, lineFeatures);
      if (user && position.exact && body.share === true) {
        await saveForecastPrediction({
          pilotHash: hashUser(user.id),
          blobKey: key,
          packKey,
          bidNumber: position.bidNumber,
          totalPilots: list.length,
          ranking: ranking as number[],
          pAvailableByLine: core.pAvailable,
          modelVersion: [priorModel?.version, calibration?.version].filter(Boolean).join("+") || null,
        });
      }
    } catch (e) {
      await reportProblem("forecast", e, { action: "record" });
    }
  });

  let shared: "stored" | "not-signed-in" | "not-requested" | "position-taken" | "store-full" | "unlisted" | "failed" = "not-requested";
  if (body.share === true) {
    if (!user) shared = "not-signed-in";
    else if (!position.exact) shared = "unlisted";
    else {
      // The forecast is already worked out: a failed save costs the pilot their share, not the answer.
      const saved = await saveSubmission({ packKey, lineNumbers, userId: user.id, bidNumber: position.bidNumber, seniority, ranking: ranking as number[] }).catch(async (e) => {
        await reportProblem("forecast", e, { action: "share" });
        return null;
      });
      shared = saved === null ? "failed" : saved.stored ? "stored" : saved.reason;
    }
  }

  return NextResponse.json({
    forecast,
    crowd: { pilotsSharing: total },
    shared,
    learning: { priorFrom: learnedPrior?.n ?? 0, calibratedFrom: calibration?.sampleSize ?? 0 },
  });
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
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  if (typeof body.packKey !== "string" || !isStringArray(body.lineNumbers, MAX_LINES)) return NextResponse.json({ error: "Missing pack." }, { status: 400 });
  await removeSubmission(body.packKey, body.lineNumbers, user.id);
  await deleteForecastPrediction(hashUser(user.id), body.packKey).catch((e) => reportProblem("forecast", e, { action: "delete" }));
  return NextResponse.json({ ok: true });
}
