import { NextResponse } from "next/server";
import { buildPilotModel } from "@/lib/brain/build-model";
import { MAX_CONTEXT, MAX_PACK_BRIEF, readExchanges, readModel } from "@/lib/server/brain-input";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
// Reading a whole interview and writing the pilot's model takes up to a couple of minutes on a long one.
export const maxDuration = 300;

/**
 * The pilot brain's full read: everything the pilot has said so far, against
 * their pack, written into their complete model (see `buildPilotModel`).
 * Guest-accessible and IP-rate-limited like the rest of the interview.
 */
export async function POST(request: Request) {
  const { ok } = await checkRateLimit("brain-build", clientIp(request), 40, 60 * 60);
  if (!ok) return rateLimitedResponse();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "The interview isn't configured on this server." }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const exchanges = readExchanges(body.exchanges);
  if (!isText(body.packBrief, MAX_PACK_BRIEF) || !isText(body.pilotContext, MAX_CONTEXT) || !exchanges) {
    return NextResponse.json({ error: "Missing interview input." }, { status: 400 });
  }
  const prior = body.prior === undefined || body.prior === null ? null : readModel(body.prior);

  try {
    const r = await buildPilotModel({ apiKey, packBrief: body.packBrief, pilotContext: body.pilotContext, exchanges, prior, effort: "high" });
    console.log("[brain-build]", { exchanges: exchanges.length, criteria: r.model.criteria.length, dropped: r.dropped.length, costUsd: +r.usage.costUsd.toFixed(3), ms: r.usage.ms });
    return NextResponse.json({ model: r.model, dropped: r.dropped });
  } catch (e) {
    console.error("[brain-build] failed", e);
    return NextResponse.json({ error: "Couldn't read your answers just now. Please try again." }, { status: 502 });
  }
}
