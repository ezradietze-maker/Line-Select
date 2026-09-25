import { buildLineFeatures, type LineFeatures } from "@/lib/forecast/features";
import { hashString } from "@/lib/forecast/random";
import { DEFAULT_DROPOUT_RATE, DEFAULT_SIMULATIONS, simulateBid, type ForecastCore, type KnownRanking } from "@/lib/forecast/simulate";
import type { BidPack, SeniorityEntry } from "@/types/bidpack";

export type Likelihood = "very-likely" | "likely" | "possible" | "long-shot" | "out-of-reach";
export type ForecastConfidence = "low" | "medium" | "high";

export interface LineForecast {
  lineId: string;
  lineNumber: string;
  /** Chance the line is still open when it's this pilot's turn to pick. */
  pAvailable: number;
  /** Chance it's the line this pilot ends up awarded from their own ranking. */
  pAward: number;
  likelihood: Likelihood;
}

export interface BidForecast {
  packKey: string;
  myBidNumber: number;
  /** False when the pilot's seniority number wasn't on the pack's list and their place was worked out from where it would fall. */
  exactPosition: boolean;
  totalPilots: number;
  pilotsAhead: number;
  regularLines: number;
  lines: Record<string, LineForecast>;
  /** Chance nothing on the pilot's ranking is left — a reserve or secondary line instead. */
  pNoRegularLine: number;
  /** Where in the pilot's own ranking their award most likely falls (1 = their top choice). */
  awardedRank: { best: number; typical: number; worst: number } | null;
  pTop: Record<number, number>;
  /** How many pilots ahead have shared a real ranking. */
  knownAhead: number;
  confidence: ForecastConfidence;
  simulations: number;
  outlook: string;
}

/** One base, aircraft, seat and month — what a set of pilots are bidding against each other for. */
export function forecastPackKey(pack: Pick<BidPack, "month" | "base" | "aircraft" | "seat">): string {
  return `${pack.month}|${pack.base}|${pack.aircraft}|${pack.seat}`.toLowerCase();
}

export function likelihoodOf(pAvailable: number): Likelihood {
  if (pAvailable >= 0.8) return "very-likely";
  if (pAvailable >= 0.5) return "likely";
  if (pAvailable >= 0.2) return "possible";
  if (pAvailable >= 0.05) return "long-shot";
  return "out-of-reach";
}

export const LIKELIHOOD_LABEL: Record<Likelihood, string> = {
  "very-likely": "Very likely",
  likely: "Likely",
  possible: "Possible",
  "long-shot": "Long shot",
  "out-of-reach": "Out of reach",
};

/**
 * Where a seniority number sits in bid order. An exact match on the pack's
 * list is authoritative; a number that isn't on it (a typo, or a list that
 * left someone off) is placed by how many listed pilots are more senior.
 */
export function resolveBidPosition(list: SeniorityEntry[], seniority: number): { bidNumber: number; exact: boolean } {
  const exact = list.find((e) => e.seniority === seniority);
  if (exact) return { bidNumber: exact.bidNumber, exact: true };
  const moreSenior = list.filter((e) => e.seniority < seniority).length;
  return { bidNumber: moreSenior + 1, exact: false };
}

/**
 * How many pilots on the list won't take a regular line this month. The list
 * names everyone eligible for the seat; the pack says how many lines exist to
 * hold — regular, reserve and secondary. Pilots beyond that many slots aren't
 * competing for them (vacation, training, leave, or bidding elsewhere), so
 * the gap, as a share of the list, is spread across the bid order. Held to a
 * sensible band because the gap also absorbs anything the pack doesn't say.
 */
export function estimateDropoutRate(pack: Pick<BidPack, "info" | "lines">, totalPilots: number): number {
  const info = pack.info;
  if (!info || totalPilots === 0) return DEFAULT_DROPOUT_RATE;
  const slots = (info.totalRegularLines ?? pack.lines.length) + (info.totalReserveLines ?? 0) + (info.totalSecondaryLines ?? 0);
  const gap = (totalPilots - slots) / totalPilots;
  return Math.min(0.25, Math.max(0.03, gap));
}

function confidenceOf(knownAhead: number, pilotsAhead: number): ForecastConfidence {
  if (pilotsAhead === 0) return "high";
  const share = knownAhead / pilotsAhead;
  if (share >= 0.75) return "high";
  if (share >= 0.3) return "medium";
  return "low";
}

function outlookText(f: Omit<BidForecast, "outlook">): string {
  const ahead = `${f.pilotsAhead} pilot${f.pilotsAhead === 1 ? "" : "s"} bid ahead of you for ${f.regularLines} line${f.regularLines === 1 ? "" : "s"}`;
  if (f.pilotsAhead === 0) return `You bid first — every line is open to you.`;
  if (f.pNoRegularLine >= 0.95) return `${ahead}. Expect a reserve or secondary line — regular lines are very likely gone by your turn.`;
  if (!f.awardedRank) return `${ahead}.`;
  const range =
    f.awardedRank.best === f.awardedRank.worst
      ? `your #${f.awardedRank.typical} choice`
      : `around your #${f.awardedRank.typical} choice (somewhere between #${f.awardedRank.best} and #${f.awardedRank.worst})`;
  const risk = f.pNoRegularLine >= 0.1 ? ` There's about a ${Math.round(f.pNoRegularLine * 100)}% chance nothing on your ranking is left.` : "";
  return `${ahead}. You'd most likely be awarded ${range}.${risk}`;
}

/** The pack-independent core of a forecast: everything it needs is numbers, so it can run anywhere — in the browser, or on a server that never sees the pack itself. */
export interface FeatureForecastInput {
  packKey: string;
  features: LineFeatures;
  seniorityList: SeniorityEntry[];
  regularLines: number;
  dropoutRate: number;
  seniorityNumber: number;
  /** Line indices (into `features`), best first. */
  myRanking: number[];
  known: KnownRanking[];
  simulations?: number;
}

export function forecastFromFeatures(input: FeatureForecastInput): BidForecast {
  const { features, seniorityList: list } = input;
  const position = resolveBidPosition(list, input.seniorityNumber);
  const core: ForecastCore = simulateBid({
    features,
    totalPilots: list.length,
    myBidNumber: position.bidNumber,
    myRanking: input.myRanking,
    known: input.known,
    simulations: input.simulations ?? DEFAULT_SIMULATIONS,
    seed: hashString(`${input.packKey}|${input.seniorityNumber}`),
    dropoutRate: input.dropoutRate,
  });

  const lines: Record<string, LineForecast> = {};
  features.lineIds.forEach((lineId, i) => {
    lines[lineId] = {
      lineId,
      lineNumber: features.lineNumbers[i],
      pAvailable: core.pAvailable[i],
      pAward: core.pAward[i],
      likelihood: likelihoodOf(core.pAvailable[i]),
    };
  });

  const partial = {
    packKey: input.packKey,
    myBidNumber: position.bidNumber,
    exactPosition: position.exact,
    totalPilots: list.length,
    pilotsAhead: core.pilotsAhead,
    regularLines: input.regularLines,
    lines,
    pNoRegularLine: core.pNoLine,
    awardedRank: core.awardedRank ? { best: core.awardedRank.p10, typical: core.awardedRank.p50, worst: core.awardedRank.p90 } : null,
    pTop: core.pTop,
    knownAhead: core.knownAhead,
    confidence: confidenceOf(core.knownAhead, core.pilotsAhead),
    simulations: core.simulations,
  };
  return { ...partial, outlook: outlookText(partial) };
}

export interface ForecastInput {
  bidPack: BidPack;
  /** The pilot's own system seniority number. */
  seniorityNumber: number;
  /** Line ids, best first — what the pilot would bid. Lines left off are treated as unwanted. */
  myRanking: string[];
  /** Other pilots' real rankings, as line numbers, best first — only ever supplied server-side. */
  known?: { bidNumber: number; ranking: string[] }[];
  simulations?: number;
  implicitValuesByLine?: Record<string, Record<string, number>>;
  /** Precomputed features (they only depend on the pack), to avoid recomputing across calls. */
  features?: LineFeatures;
}

/** null when the pack has no seniority list to place the pilot on. */
export function forecastBid(input: ForecastInput): BidForecast | null {
  const { bidPack } = input;
  const list = bidPack.seniorityList;
  if (!list || list.length === 0) return null;

  const features = input.features ?? buildLineFeatures(bidPack, input.implicitValuesByLine);
  const indexById = new Map(features.lineIds.map((id, i) => [id, i] as const));
  const indexByNumber = new Map(features.lineNumbers.map((n, i) => [n, i] as const));

  return forecastFromFeatures({
    packKey: forecastPackKey(bidPack),
    features,
    seniorityList: list,
    regularLines: bidPack.lines.length,
    dropoutRate: estimateDropoutRate(bidPack, list.length),
    seniorityNumber: input.seniorityNumber,
    myRanking: input.myRanking.map((id) => indexById.get(id)).filter((i): i is number => i !== undefined),
    known: (input.known ?? []).map((k) => ({
      bidNumber: k.bidNumber,
      ranking: k.ranking.map((n) => indexByNumber.get(n)).filter((i): i is number => i !== undefined),
    })),
    simulations: input.simulations,
  });
}
