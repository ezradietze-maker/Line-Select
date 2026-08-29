/**
 * "Strategies" is a read of the bid pack's own printed numbers, not a real
 * award predictor — nobody outside crew scheduling knows actual demand for a
 * given line. `FeasibilityTier` is deliberately a rough estimate (see
 * `estimateFeasibility` in lib/strategy-engine.ts), always presented with
 * that caveat rather than as a probability.
 */
export type FeasibilityTier = "strong" | "possible" | "longshot";

export interface SeniorityInput {
  /** 1 = most senior pilot in the seat. */
  rank: number;
  /** Total pilots holding this seat at this domicile — not just those who got a regular line. */
  totalPilots: number;
}

export type StrategyId =
  | "ghost-line"
  | "mega-trip"
  | "recurring-turn"
  | "safety-net"
  | "re-bid-chain"
  | "reserve-ladder"
  | "vacation-vault";

export interface StrategyLineRecommendation {
  lineNumber: string;
  /** The single boldest, most concrete number this line proves — e.g. "57.0 credit hrs from 3.9 hrs of real flying". */
  headline: string;
  detail: string;
  daysOff: number;
  totalCreditHours: number;
  totalTafbHours: number;
  feasibility: FeasibilityTier;
  feasibilityNote: string;
}

export interface Strategy {
  id: StrategyId;
  name: string;
  tagline: string;
  /** Plain-language explanation of the mechanism that makes this work. */
  mechanism: string;
  benefits: string[];
  /** Empty for a process/timing strategy that isn't tied to specific lines. */
  lines: StrategyLineRecommendation[];
  /** True for strategies (like the re-bid chain) that are general bidding-process advice rather than a read of this specific pack's lines. */
  isProcessTip?: boolean;
  /**
   * Real phrases from the pilot's own interview answers that this strategy's
   * ranking was based on — present only when a profile exists and the
   * strategy has at least one meaningfully-weighted preference behind it.
   * Undefined (not just empty) means "not preference-ranked at all" (the
   * process-tip strategies), vs. an empty array meaning "ranked, but nothing
   * in the interview leaned hard enough either way to name."
   */
  preferenceMatch?: string[];
}

export interface AutoBidEntry {
  rank: number;
  lineNumber: string;
  strategyName: string;
  reason: string;
  feasibility: FeasibilityTier;
}
