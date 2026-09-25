import { FEATURE_COUNT, type LineFeatures } from "@/lib/forecast/features";
import { estimateDropoutRate, forecastBid, forecastPackKey, type BidForecast } from "@/lib/forecast/forecast";
import type { BidPack } from "@/types/bidpack";

export type ShareOutcome = "stored" | "not-signed-in" | "not-requested" | "position-taken" | "store-full" | "unlisted";

export interface ForecastResponse {
  forecast: BidForecast;
  /** How many pilots have shared a real ranking for this seat. */
  pilotsSharing: number;
  shared: ShareOutcome;
  /** True when the server couldn't be reached and this was worked out on this device from the pack alone. */
  local: boolean;
}

export interface ForecastRequestInput {
  bidPack: BidPack;
  features: LineFeatures;
  seniorityNumber: number;
  /** Line ids, best first. */
  rankingLineIds: string[];
  /** Whether to let the pilot's ranking help forecasts for other pilots. */
  share: boolean;
}

/** Numbers rounded to keep the request small — four decimals is far below anything that could move a probability. */
function round4(values: Float64Array): number[] {
  return Array.from(values, (v) => Math.round(v * 10000) / 10000);
}

export async function fetchForecast(input: ForecastRequestInput): Promise<ForecastResponse | null> {
  const { bidPack, features } = input;
  const list = bidPack.seniorityList;
  if (!list || list.length === 0) return null;

  const indexById = new Map(features.lineIds.map((id, i) => [id, i] as const));
  const ranking = input.rankingLineIds.map((id) => indexById.get(id)).filter((i): i is number => i !== undefined);

  try {
    const res = await fetch("/api/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        packKey: forecastPackKey(bidPack),
        lineIds: features.lineIds,
        lineNumbers: features.lineNumbers,
        features: round4(features.values),
        seniorityList: list.map((e) => [e.bidNumber, e.seniority]),
        regularLines: bidPack.lines.length,
        dropoutRate: estimateDropoutRate(bidPack, list.length),
        seniorityNumber: input.seniorityNumber,
        ranking,
        share: input.share,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return { forecast: data.forecast as BidForecast, pilotsSharing: data.crowd?.pilotsSharing ?? 0, shared: data.shared as ShareOutcome, local: false };
    }
  } catch {
    // fall through to the on-device estimate
  }

  const local = forecastBid({ bidPack, seniorityNumber: input.seniorityNumber, myRanking: input.rankingLineIds, features, simulations: 200 });
  return local ? { forecast: local, pilotsSharing: 0, shared: "not-requested", local: true } : null;
}

export { FEATURE_COUNT };

/** Asks the server to forget this pilot's shared ranking for the seat. */
export async function stopSharingRanking(packKey: string, lineNumbers: string[]): Promise<void> {
  try {
    await fetch("/api/forecast", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ packKey, lineNumbers }),
    });
  } catch {
    // Nothing more to do — the next forecast simply won't include it.
  }
}
