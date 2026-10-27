import { describe, expect, it } from "vitest";
import { formatValue } from "@/lib/brain/describe";
import { avoidedPhrases, insteadOf, inventedLimit, pilotWordsForPrompt, statesALimit } from "@/lib/brain/pilot-words";
import { METRICS } from "@/lib/metrics/catalog";

describe("pilot words", () => {
  it("finds the phrases the app made up", () => {
    expect(avoidedPhrases("Say a trip joins from LAX or the Pacific")).toEqual(["joins from"]);
    expect(avoidedPhrases("How much of your layover value would you give up?")).toEqual(["layover value"]);
    expect(avoidedPhrases("Trips you can join from Denver")).toHaveLength(2);
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

describe("limits", () => {
  it("tells a stated limit from a preference, and a denied one from neither", () => {
    expect(statesALimit("Two in a row is my absolute limit, I won't bid three.")).toBe(true);
    expect(statesALimit("One backup is about my floor.")).toBe(true);
    expect(statesALimit("I wouldn't rule anything out — ideally not more than two.")).toBe(false);
    expect(statesALimit("Nothing's an absolute; not really a hard cutoff on most things.")).toBe(false);
    expect(statesALimit("Three or four and I'd hardly bid it.")).toBe(false);
  });

  it("finds a limit a reply invents, and only then", () => {
    const pref = "Lots of commutes give a line a very low score — ideally not more than two.";
    expect(inventedLimit("That's a firm cap on Memphis.", pref)).toBe("firm");
    expect(inventedLimit("CAN standby never — got it.", "Standby in Anchorage is fine.")).toBe("never");
    expect(inventedLimit("Low 70s is out — got it.", "Probably around 76 or 77.")).toBe("is out");
    expect(inventedLimit("Two or fewer, ideally — got it.", pref)).toBeNull();
    expect(inventedLimit("The closest thing to a dealbreaker — got it.", pref)).toBeNull();
    expect(inventedLimit("Hotel standby wrecks it because you never know when the call comes.", "About right.")).toBeNull();
    expect(inventedLimit("So Hawaii isn't off the table.", "Night flying is what I steer away from.")).toBeNull();
    expect(inventedLimit("Worth knowing how firm that is.", "Church on Wednesdays.")).toBeNull();
  });
});
