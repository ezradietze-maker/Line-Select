import { cityScoresFromRatings } from "@/lib/city-ratings";
import type { CityRating } from "@/types/preferences";
import type { Criterion, PilotModel } from "@/types/pilot-model";

/** Measures that take graded city feelings. */
const CITY_SCORED = new Set(["layoverValue", "standbyDaysByCity"]);

/**
 * A pilot's own city grades beat anything the brain inferred from how they
 * talked: every city they rated takes their grade in each city-scored
 * criterion. Cities they didn't rate keep the brain's reading (they may have
 * skipped the step). A pilot who rated cities but whose model has no
 * layover-location criterion gets one — they took the time to rate, so
 * location matters to them.
 */
export function applyCityRatings(model: PilotModel, ratings: Record<string, CityRating> | undefined): PilotModel {
  const graded = cityScoresFromRatings(ratings ?? {});
  if (Object.keys(graded).length === 0) return model;
  const criteria: Criterion[] = model.criteria.map((c) => (CITY_SCORED.has(c.metric) ? { ...c, params: { ...c.params, cityScores: { ...c.params?.cityScores, ...graded } } } : c));
  if (!criteria.some((c) => c.metric === "layoverValue") && Object.keys(graded).length >= 2) {
    criteria.push({
      id: "cityRatings",
      metric: "layoverValue",
      params: { cityScores: graded },
      shape: { kind: "more" },
      tier: "medium",
      weight: 0.4,
      confidence: 0.9,
      label: "Layovers in the cities you rated highest",
      evidence: [{ quote: "Your city ratings", turn: 0 }],
      status: "settled",
    });
  }
  return { ...model, criteria };
}
