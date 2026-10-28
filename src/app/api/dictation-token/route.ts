import { NextResponse } from "next/server";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The speech service's model: the most accurate of the ones tested on pilot sentences (Oct 2026). */
const MODEL = "universal-3-6-pro";
/** One tap of the mic can't run longer than this — a forgotten open mic stops costing money. */
const MAX_SESSION_SECONDS = 15 * 60;

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
  const { ok } = await checkRateLimit("dictation-token", clientIp(request), 120, 60 * 60);
  if (!ok) return rateLimitedResponse();

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Dictation isn't configured on this server." }, { status: 503 });

  const url = `https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=${MAX_SESSION_SECONDS}`;
  try {
    const res = await fetch(url, { headers: { Authorization: apiKey }, cache: "no-store" });
    if (!res.ok) {
      console.error("[dictation-token] speech service refused a pass", res.status);
      return NextResponse.json({ error: "Dictation is unavailable right now." }, { status: 502 });
    }
    const { token } = (await res.json()) as { token?: string };
    if (!token) return NextResponse.json({ error: "Dictation is unavailable right now." }, { status: 502 });
    return NextResponse.json(
      { provider: "assemblyai", token, socket: "wss://streaming.assemblyai.com/v3/ws", model: MODEL, maxSeconds: MAX_SESSION_SECONDS },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[dictation-token] speech service unreachable", e);
    return NextResponse.json({ error: "Dictation is unavailable right now." }, { status: 502 });
  }
}
