import type { Bucket } from "@/lib/learning/interview-outcome";
import type { PreferenceFact } from "@/types/interview-session";

/**
 * How an assumed answer reads to the pilot — plain, first person ("this is
 * what I'm going with for you"), and honest about where it came from. One
 * phrase per answer bucket per dimension, so the review screen can say
 * exactly what was assumed without the pilot having to decode a slider.
 */
const PHRASES: Record<string, Partial<Record<Bucket, string>>> = {
  daysOff: { zero: "the number of days off doesn't matter much", pos: "you want as many days off as you can get", neg: "you're fine with a busier month and fewer days off" },
  tripLength: { zero: "trip length doesn't matter much", pos: "you lean toward longer trips", neg: "you lean toward shorter trips" },
  international: { zero: "international versus domestic doesn't matter much", pos: "you like a good international mix", neg: "you lean toward mostly domestic flying" },
  reportTime: { zero: "report times don't matter much", pos: "you lean toward later reports", neg: "you lean toward earlier reports" },
  creditHours: { zero: "credit hours aren't a big factor", pos: "you lean toward maximizing credit", neg: "you'd trade some credit for an easier schedule" },
  deadheadTolerance: { zero: "deadheads don't matter much either way", pos: "deadheads don't bother you", neg: "you'd rather avoid deadheads" },
  hotelFood: { zero: "walkable food near the hotel isn't a factor", pos: "walkable food near the hotel matters to you" },
  hotelGym: { zero: "a hotel gym isn't a factor", pos: "a hotel gym matters to you" },
  hotelGrocery: { zero: "a grocery or pharmacy nearby isn't a factor", pos: "a grocery or pharmacy nearby matters to you" },
  hotelQuiet: { zero: "a quiet room isn't a big factor", pos: "a quiet room matters to you" },
  hotelQuality: { zero: "overall hotel quality isn't a big factor", pos: "overall hotel quality matters to you" },
  circadianHealth: { zero: "protecting your body clock isn't a big factor", pos: "protecting your body clock matters to you" },
  landings: { zero: "the number of landings doesn't matter much", pos: "you like more landings", neg: "you'd rather have fewer landings" },
  hotelStandby: { zero: "hotel standby doesn't matter much either way", pos: "hotel standby doesn't bother you", neg: "you'd rather avoid hotel standby" },
  riskTolerance: { zero: "you're in between on bidding long-shot lines", pos: "you'd rank a long-shot line high anyway", neg: "you'd rather bid lines you can actually hold" },
  adminEffortAppetite: { zero: "you're in between on trades and re-bids", pos: "you'd put in the work on trades and re-bids", neg: "you'd rather not chase trades and re-bids" },
};

export function assumedStatement(dim: string, bucket: Bucket, share: number, support: number): string {
  const phrase = PHRASES[dim]?.[bucket] ?? `${dim} — ${bucket}`;
  return `Assumed: ${phrase} — ${Math.round(share * 100)}% of ${support} pilots like you answered this way. Change it if that's not you.`;
}

/**
 * The fact the interview records instead of asking, for one assumed
 * dimension. Low confidence on purpose (it's a group answer, not theirs) and
 * a modest strength: when most pilots lean one way, how strongly any one of
 * them does varies a lot, so the assumption shouldn't swing a ranking as
 * hard as a real answer would.
 */
export function assumedFact(params: {
  dim: string;
  bucket: Bucket;
  share: number;
  support: number;
  typicalStrength: number;
  modelVersion: string;
}): PreferenceFact {
  const { dim, bucket } = params;
  const importance = bucket === "zero" ? 0 : Math.min(0.7, Math.max(0.2, (params.typicalStrength / 100) * 0.8));
  return {
    id: crypto.randomUUID(),
    statement: assumedStatement(dim, bucket, params.share, params.support),
    kind: "measurable",
    measurable: { type: "explicit-weight", key: dim as never, direction: bucket === "neg" ? -1 : 1 },
    confidence: 0.5,
    importance,
    source: { kind: "population-prior", modelVersion: params.modelVersion },
    turnIndex: 0,
  };
}
