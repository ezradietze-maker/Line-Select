import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { checkSpend, recordSpend, spenderFor, spendLimitResponse } from "@/lib/server/spend-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The speech service's model: the most accurate of the ones tested on pilot sentences (Oct 2026). */
const MODEL = "universal-3-6-pro";
/** One tap of the mic can't run longer than this — a forgotten open mic stops costing money. */
const MAX_SESSION_SECONDS = 15 * 60;
/**
 * The speech service bills by the minute of audio, which this server never sees, so each pass is charged a typical
 * dictation's worth (a few minutes) up front. The hourly limit on passes bounds anyone holding the mic open.
 */
const PASS_COST_USD = 0.03;

/**
 * A pass for one dictation: the browser trades it for a live connection straight to the speech service (AssemblyAI),
 * so the audio never passes through this server and the secret key never reaches the browser. The pass is only good
 * for a minute to open the connection, and the session it opens stops after `MAX_SESSION_SECONDS`.
 *
 * Guest-accessible like the interview itself, and rate-limited per address so nobody can run up the bill. With no key
 * configured it says so (503), and the mic falls back to the browser's own speech engine.
 */
/** Whether the speech service is set up here, so the mic knows which engine to start the moment it's tapped. Mints nothing. */
export async function GET() {
  return NextResponse.json({ available: !!process.env.ASSEMBLYAI_API_KEY }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { ok } = await checkRequestLimit("dictation-token", request, 120, 60 * 60);
  if (!ok) return rateLimitedResponse();

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Dictation isn't configured on this server." }, { status: 503 });
  const spender = await spenderFor(request);
  const allowed = await checkSpend(spender);
  if (!allowed.ok) return spendLimitResponse(allowed);

  const url = `https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=${MAX_SESSION_SECONDS}`;
  try {
    const res = await fetch(url, { headers: { Authorization: apiKey }, cache: "no-store" });
    if (!res.ok) {
      await reportProblem("dictation", new Error(`speech service refused a pass (${res.status})`));
      return NextResponse.json({ error: "Dictation is unavailable right now." }, { status: 502 });
    }
    const { token } = (await res.json()) as { token?: string };
    if (!token) return NextResponse.json({ error: "Dictation is unavailable right now." }, { status: 502 });
    await recordSpend(spender, PASS_COST_USD);
    return NextResponse.json(
      { provider: "assemblyai", token, socket: "wss://streaming.assemblyai.com/v3/ws", model: MODEL, maxSeconds: MAX_SESSION_SECONDS },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    await reportProblem("dictation", e);
    return NextResponse.json({ error: "Dictation is unavailable right now." }, { status: 502 });
  }
}
