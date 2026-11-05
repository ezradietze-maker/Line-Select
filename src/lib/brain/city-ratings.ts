import { cityScoresFromRatings, citySeasonsFromRatings, hotelScoresFromRatings } from "@/lib/city-ratings";
import type { SeasonScores } from "@/lib/seasons";
import type { CityRating } from "@/types/preferences";
import type { Criterion, PilotModel } from "@/types/pilot-model";

/** Measures that take graded city feelings. */
const CITY_SCORED = new Set(["layoverValue", "fullDaysInLikedCities", "standbyDaysByCity"]);

/** One grade on the city scale (Love → Like), as the pilot-facts reader counts a seasonal change. */
const GRADE_STEP = 0.5;
const clamp = (x: number) => Math.max(-1, Math.min(1, x));

/**
 * Each city's grades in its seasons, for one criterion: the pilot's own seasonal grades from the city screen, else what
 * they said ("in the winter, less great"), as a change from the city's usual grade in that criterion.
 */
function seasonsFor(usual: Record<string, number>, rated: Record<string, SeasonScores>, spoken: NonNullable<PilotModel["facts"]>["citySeasons"]): Record<string, SeasonScores> {
  const out: Record<string, SeasonScores> = {};
  for (const s of spoken ?? []) {
    if (rated[s.city]) continue;
    const grade = clamp((usual[s.city] ?? 0) + s.change * GRADE_STEP);
    const e = (out[s.city] ??= {});
    if (s.season === "months") e.months = [...(e.months ?? []), { months: s.months, score: grade }];
    else e[s.season] = grade;
  }
  return { ...out, ...rated };
}

/**
 * A pilot's own city grades beat anything the brain inferred from how they
 * talked: every city they rated takes their grade in each city-scored
 * criterion. Cities they didn't rate keep the brain's reading (they may have
 * skipped the step). A pilot who rated cities but whose model has no
 * layover-location criterion gets one — they took the time to rate, so
 * location matters to them.
 *
 * Grades that change with the season go on with them (`citySeasons`): the pilot's own from the screen, else the ones
 * read from their words. So do their grades for single hotels (`hotelScores`) and for hotels in places they named
 * (`hotelAreas`, from their words, measured from the city's grade).
 */
export function applyCityRatings(model: PilotModel, ratings: Record<string, CityRating> | undefined): PilotModel {
  const graded = cityScoresFromRatings(ratings ?? {});
  const rated = citySeasonsFromRatings(ratings ?? {});
  const spoken = model.facts?.citySeasons;
  const hotelScores = hotelScoresFromRatings(ratings ?? {});
  const areas = model.facts?.hotelAreas;
  if (Object.keys(graded).length === 0 && !spoken?.length && !areas?.length) return model;
  const withGrades = (c: Criterion): Criterion => {
    const cityScores = { ...c.params?.cityScores, ...graded };
    const citySeasons = seasonsFor(cityScores, rated, spoken);
    const hotelAreas = (areas ?? []).map((a) => ({
      city: a.city,
      places: a.places,
      score: clamp((cityScores[a.city] ?? 0) + a.change * GRADE_STEP),
      ...(a.longLayovers ? { longLayovers: true } : {}),
    }));
    // Seasons and hotels are rebuilt from the grades and words each time: a saved model's own copies may be stale.
    const own = { ...c.params };
    delete own.citySeasons;
    delete own.hotelScores;
    delete own.hotelAreas;
    return {
      ...c,
      params: {
        ...own,
        cityScores,
        ...(Object.keys(citySeasons).length ? { citySeasons } : {}),
        ...(Object.keys(hotelScores).length ? { hotelScores } : {}),
        ...(hotelAreas.length ? { hotelAreas } : {}),
      },
    };
  };
  const criteria: Criterion[] = model.criteria.map((c) => (CITY_SCORED.has(c.metric) ? withGrades(c) : c));
  // A full-day criterion is a layover-location one too: city feelings are counted once.
  if (!criteria.some((c) => c.metric === "layoverValue" || c.metric === "fullDaysInLikedCities") && Object.keys(graded).length >= 2) {
    criteria.push(
      withGrades({
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
      })
    );
  }
  return { ...model, criteria };
}
