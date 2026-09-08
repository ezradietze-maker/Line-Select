import { describe, expect, it } from "vitest";
import {
  hotelCityReason,
  orderedAmenityCategories,
  orderedThemeEntries,
  wantsGymEmphasis,
  wantsQuietRoom,
} from "./hotel-personalization";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";
import type { PreferenceFact } from "@/types/interview-session";

function makeProfile(overrides: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    deepRoundCompleted: false,
    tradeoffAnswers: [],
    explicitTargets: {},
    isCommuter: null,
    hasCrashPad: null,
    cityPreferences: {},
    completedAt: new Date(0).toISOString(),
    implicitWeights: {},
    implicitConfidence: {},
    discoveredFacts: [],
    interviewTranscript: [],
    ...overrides,
  };
}

function makeFact(overrides: Partial<PreferenceFact> = {}): PreferenceFact {
  return {
    id: "f1",
    statement: "Avoids NRT because of a rough hotel experience.",
    kind: "qualitative",
    confidence: 0.9,
    importance: 0.8,
    source: { kind: "adaptive-question", questionId: "q1" },
    turnIndex: 0,
    ...overrides,
  };
}

describe("orderedAmenityCategories", () => {
  it("returns the default order when there's no profile", () => {
    const categories: ("food" | "gym" | "grocery" | "coffee")[] = ["food", "gym", "grocery", "coffee"];
    expect(orderedAmenityCategories(null, categories)).toEqual(categories);
  });

  it("promotes the category this pilot weighted highest", () => {
    const profile = makeProfile({ weights: { ...DEFAULT_WEIGHTS, hotelGym: 80, hotelFood: 20 } });
    const result = orderedAmenityCategories(profile, ["food", "gym", "grocery", "coffee"]);
    expect(result[0]).toBe("gym");
  });

  it("leaves ties in their original order (stable sort)", () => {
    const profile = makeProfile();
    const result = orderedAmenityCategories(profile, ["food", "gym", "grocery", "coffee"]);
    expect(result).toEqual(["food", "gym", "grocery", "coffee"]);
  });
});

describe("hotelCityReason", () => {
  it("returns null with no profile", () => {
    expect(hotelCityReason(null, "NRT")).toBeNull();
  });

  it("finds a hotel-category cityReason fact matching this city code", () => {
    const profile = makeProfile({
      discoveredFacts: [makeFact({ cityReason: { code: "NRT", category: "hotel" } })],
    });
    expect(hotelCityReason(profile, "NRT")).toBe("Avoids NRT because of a rough hotel experience.");
  });

  it("ignores a cityReason for a different city or a non-hotel category", () => {
    const profile = makeProfile({
      discoveredFacts: [
        makeFact({ id: "f2", cityReason: { code: "CDG", category: "hotel" } }),
        makeFact({ id: "f3", cityReason: { code: "NRT", category: "weather" } }),
      ],
    });
    expect(hotelCityReason(profile, "NRT")).toBeNull();
  });
});

describe("wantsQuietRoom / wantsGymEmphasis", () => {
  it("is false with no profile", () => {
    expect(wantsQuietRoom(null)).toBe(false);
    expect(wantsGymEmphasis(null)).toBe(false);
  });

  it("is false below the flag threshold", () => {
    const profile = makeProfile({ weights: { ...DEFAULT_WEIGHTS, hotelQuiet: 10, circadianHealth: 10 } });
    expect(wantsQuietRoom(profile)).toBe(false);
  });

  it("is true when hotelQuiet or circadianHealth clears the threshold", () => {
    expect(wantsQuietRoom(makeProfile({ weights: { ...DEFAULT_WEIGHTS, hotelQuiet: 50 } }))).toBe(true);
    expect(wantsQuietRoom(makeProfile({ weights: { ...DEFAULT_WEIGHTS, circadianHealth: 50 } }))).toBe(true);
  });

  it("is true for gym only when hotelGym clears the threshold", () => {
    expect(wantsGymEmphasis(makeProfile({ weights: { ...DEFAULT_WEIGHTS, hotelGym: 50 } }))).toBe(true);
    expect(wantsGymEmphasis(makeProfile())).toBe(false);
  });
});

describe("orderedThemeEntries", () => {
  const entries: ["quietness" | "onSiteGym" | "breakfast", "positive" | "mixed" | "negative"][] = [
    ["breakfast", "positive"],
    ["quietness", "mixed"],
    ["onSiteGym", "negative"],
  ];

  it("returns entries unchanged with no profile or no flagged priority", () => {
    expect(orderedThemeEntries(null, entries)).toEqual(entries);
    expect(orderedThemeEntries(makeProfile(), entries)).toEqual(entries);
  });

  it("promotes quietness for a circadian-flagging pilot", () => {
    const profile = makeProfile({ weights: { ...DEFAULT_WEIGHTS, circadianHealth: 60 } });
    const result = orderedThemeEntries(profile, entries);
    expect(result[0][0]).toBe("quietness");
  });

  it("promotes onSiteGym for a gym-flagging pilot", () => {
    const profile = makeProfile({ weights: { ...DEFAULT_WEIGHTS, hotelGym: 60 } });
    const result = orderedThemeEntries(profile, entries);
    expect(result[0][0]).toBe("onSiteGym");
  });
});
