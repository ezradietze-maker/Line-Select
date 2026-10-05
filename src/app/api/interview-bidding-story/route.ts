import { NextResponse } from "next/server";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { runBiddingStoryExtraction } from "@/lib/interview-turn-service";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import { saveStyleSamples } from "@/lib/server/style-store";
import type { BiddingStoryRequestBody } from "@/types/interview-session";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Generous enough for genuinely exhaustive detail, still a sane ceiling for one LLM call and one localStorage-bound profile. */
const MAX_BID_STORY_LENGTH = 12000;

/**
 * Thin HTTP wrapper around `runBiddingStoryExtraction` — the one-shot read
 * of a pilot's free-text "walk through your whole bidding process" answer,
 * called once right after seniority, before the adaptive turn loop starts.
 * Guest-accessible and IP-rate-limited like `/api/interview-turn`, since
 * it's the same core interview flow. Unlike that route, this one also
 * writes to the anonymous cross-pilot style corpus (`server/style-store.ts`)
 * itself — the extracted phrases/tags are never returned to the client,
 * matching the forecast feature's "shared data never comes back over the
 * wire" posture.
 */
export async function POST(request: Request) {
  const { ok } = await checkRateLimit("interview-bidding-story", clientIp(request), 20, 60 * 60);
  if (!ok) return rateLimitedResponse();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "The adaptive interview isn't configured on this server." }, { status: 503 });
  }

  let body: Partial<BiddingStoryRequestBody>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  if (
    !isText(body.bidStoryText, MAX_BID_STORY_LENGTH) ||
    !isJsonObject(body.grounding) ||
    typeof body.base !== "string" ||
    typeof body.aircraft !== "string" ||
    (body.isCommuter !== null && typeof body.isCommuter !== "boolean") ||
    (body.cityCodes !== undefined && !Array.isArray(body.cityCodes))
  ) {
    return NextResponse.json({ error: "Missing bidding-story input." }, { status: 400 });
  }
  // Absent on a client from before this field existed — treated as "no known cities" rather than a hard failure.
  const cityCodes = Array.isArray(body.cityCodes) ? body.cityCodes.filter((c): c is string => typeof c === "string").slice(0, 300) : [];

  const result = await runBiddingStoryExtraction(apiKey, { ...body, cityCodes } as BiddingStoryRequestBody);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  if (result.styleSamplePhrases.length > 0) {
    // Fire-and-forget from the pilot's perspective — a style-corpus write
    // failing should never fail (or even delay) the interview itself.
    saveStyleSamples(result.styleSamplePhrases, result.styleTags).catch((e) => {
      console.error("[interview-bidding-story] style sample save failed", e);
    });
  }

  return NextResponse.json({ profileUpdates: result.profileUpdates, commuterStatus: result.commuterStatus });
}
