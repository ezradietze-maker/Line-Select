import { describe, expect, it } from "vitest";
import { formatValue } from "@/lib/brain/describe";
import { avoidedPhrases, insteadOf, pilotWordsForPrompt } from "@/lib/brain/pilot-words";
import { METRICS } from "@/lib/metrics/catalog";

describe("pilot words", () => {
  it("finds the phrases the app made up", () => {
    expect(avoidedPhrases("Say a trip joins from LAX or the Pacific")).toEqual(["joins from"]);
    expect(avoidedPhrases("How much of your layover value would you give up?")).toEqual(["layover value"]);
    expect(avoidedPhrases("Trips you can join from San Diego")).toHaveLength(2);
    expect(insteadOf("joins from")).toMatch(/front-end deadhead/);
  });

  it("leaves a pilot's own words alone", () => {
    for (const ok of [
      "A trip that starts with a deadhead to LAX or somewhere in the Pacific, so you can skip Memphis and shorten it",
      "Front-end deadheads, double deadheads and trips you can deviate home from",
      "Two departures, three commutes, a night hub turn and a crew-rest hotel",
      "Line 1033 has 48 hours in cities you like",
    ])
      expect(avoidedPhrases(ok)).toEqual([]);
  });

  it("is what the app's own words are made of: every measure's name, description and value", () => {
    for (const d of METRICS) {
      expect(avoidedPhrases(d.label), d.id).toEqual([]);
      for (const v of [0, 1, 3]) expect(avoidedPhrases(formatValue(v, d)), d.id).toEqual([]);
    }
  });

  it("goes into the prompts with the made-up words named", () => {
    const text = pilotWordsForPrompt();
    expect(text).toMatch(/front-end deadhead/);
    expect(text).toMatch(/Never say .*layover value/);
  });
});
