import { awardsBehind, pairsOfCase, testCalibration, type CalibrationCase, type FairTest } from "@/lib/learning/fair-test";
import { baselineBrier, brierScore, pairsFromAward, reliabilityTable, type Calibration, type CalibrationPair, type ReliabilityBin } from "@/lib/learning/forecast-learning";

/** How the award odds have measured up against real shared awards: what `/api/admin/calibration` reports. */
export interface CalibrationReport {
  awards: number;
  forecasts: number;
  packs: number;
  pairs: { ownAward: number; otherPilots: number };
  brier: {
    /** The forecast's own numbers. Lower is better. */
    asForecast: number | null;
    /** With the correction in use applied. */
    corrected: number | null;
    /** Always saying the overall rate: the forecast must beat this to be telling anyone anything. */
    alwaysTheAverage: number | null;
  };
  reliability: ReliabilityBin[];
  bySeat: { seat: string; forecasts: number; brier: number | null }[];
  fairTest: { ready: false; reason: string } | { ready: true; promote: boolean; heldBack: number; brierUncalibrated: number; brierChallenger: number; winShare: number };
}

const finite = (x: number) => (Number.isFinite(x) ? x : null);

export function calibrationReport(cases: (CalibrationCase & { seat: string })[], inUse: Calibration | null, now: Date): CalibrationReport {
  const pairs: CalibrationPair[] = cases.flatMap(pairsOfCase);
  const own = cases.reduce((n, c) => n + (c.award ? pairsFromAward(c.prediction, c.award).length : 0), 0);
  const seats = [...new Set(cases.map((c) => c.seat))].sort();
  const test: FairTest = testCalibration(cases, "report", now);
  return {
    awards: awardsBehind(cases),
    forecasts: cases.length,
    packs: new Set(cases.map((c) => c.packKey)).size,
    pairs: { ownAward: own, otherPilots: pairs.length - own },
    brier: { asForecast: finite(brierScore(pairs)), corrected: inUse ? finite(brierScore(pairs, inUse)) : null, alwaysTheAverage: finite(baselineBrier(pairs)) },
    reliability: reliabilityTable(pairs),
    bySeat: seats.map((seat) => {
      const ofSeat = cases.filter((c) => c.seat === seat);
      return { seat, forecasts: ofSeat.length, brier: finite(brierScore(ofSeat.flatMap(pairsOfCase))) };
    }),
    fairTest: test.ready
      ? { ready: true, promote: test.promote, heldBack: test.heldBack, brierUncalibrated: test.brierUncalibrated, brierChallenger: test.brierChallenger, winShare: test.winShare }
      : test,
  };
}
