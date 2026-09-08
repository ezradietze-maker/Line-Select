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
  | "vacation-vault"
  | "reserve-avoidance"
  | "trip-trading"
  | "grievance-slide";

/**
 * "grounded" = computed straight from this pilot's own parsed bid pack data,
 * same trust level as the original strategies. "pending-contract" = the
 * mechanism depends on specific contract/PBS language this app hasn't
 * confirmed — built ahead of that confirmation on purpose (see the
 * Strategies-board plan), but never presented at the same confidence as a
 * grounded one. Absent on the original seven strategies (all grounded) for
 * backward compatibility; only ever set explicitly on new ones.
 */
export type StrategyVerification = "grounded" | "pending-contract";

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
  /**
   * This line's own real Satisfaction Index and how it compares to the
   * pilot's current top pick — null when no profile/ranking exists yet (a
   * pilot who hasn't interviewed sees strategies exactly as before this
   * existed), or when the recommended line couldn't be matched to a scored
   * line for some reason. Never a hypothetical "if you applied this
   * strategy" transformation — a strategy here always points at a real,
   * already-scored line, so this is that line's own real number.
   */
  scoreContext: { score: number; deltaFromTopPick: number } | null;
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
  /** Absent means "grounded" (the original seven strategies) — see `StrategyVerification`'s own doc comment. */
  verification?: StrategyVerification;
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
