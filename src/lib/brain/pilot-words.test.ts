import { describe, expect, it } from "vitest";
import { formatValue } from "@/lib/brain/describe";
import { avoidedPhrases, EX_PILOT_WORDS, insteadOf, inventedLimit, PACK_WORDS, PILOT_WORDS, pilotWordsForPrompt, statesALimit } from "@/lib/brain/pilot-words";
import { METRICS } from "@/lib/metrics/catalog";

describe("pilot words", () => {
  it("finds the phrases the app made up", () => {
    expect(avoidedPhrases("Say a trip joins from LAX or the Pacific")).toEqual(["joins from"]);
    expect(avoidedPhrases("How much of your layover value would you give up?")).toEqual(["layover value"]);
    expect(avoidedPhrases("Trips you can join from Denver")).toHaveLength(2);
    expect(insteadOf("joins from")).toMatch(/front-end deadhead/);
  });

  it("finds the words that are in neither the pack nor his own talk", () => {
    const cases: [string, string][] = [
      ["Red-eyes into Memphis — how many is too many?", "Red-eyes"],
      ["ending a trip with an all-nighter", "all-nighter"],
      ["hours worked in the small hours", "small hours"],
      ["back-of-the-clock flying", "back-of-the-clock"],
      ["How many days in a row before it feels like a real block?", "real block"],
      ["Big blocks of days off", "Big blocks"],
      ["A stretch with blocks of days off", "blocks of days"],
      ["How long a block counts as real?", "How long a block"],
      ["How many backup flights do you want?", "backup flights"],
      ["How much buffer do you want before a report?", "buffer"],
      ["Some long hub sits come with a crew-rest hotel", "hub sits"],
      ["Earliest report at base", "base"],
      ["Long duty days", "duty days"],
      ["trip, report to release, and its credit", "report to release"],
      ["Report & release times", "Report & release"],
      ["Rest hotel at a hub", "Rest hotel"],
      ["7 takeoffs in freezing weather", "takeoffs in freezing"],
      ["A long overnight somewhere overseas", "long overnight"],
      ["Early sign-ins are fine", "Early sign-ins"],
      ["from block-in to the hotel pickup", "block-in"],
    ];
    for (const [text, found] of cases) expect(avoidedPhrases(text), text).toContain(found);
  });

  it("says each one in the pack's words or his", () => {
    expect(insteadOf("red-eye")).toMatch(/night flying/);
    expect(insteadOf("real block")).toMatch(/real break/);
    expect(insteadOf("base")).toMatch(/domicile/);
    expect(insteadOf("duty day")).toBe("duty period");
    expect(insteadOf("backup flights")).toMatch(/commute/);
  });

  it("doesn't catch the words that look like them", () => {
    for (const ok of [
      "TAFB is time away from base", // the pack's own TAFB
      "Based on what you said, 18 hours of block time and 30 block hours",
      "Line 1003 flies 30 hours of long block time",
      "The secondary lines release on the 21st, and open time goes out after",
      "Sign in to keep your bid pack",
      "A flight in overnight to make the show",
      "Coffee shops near the hotel",
      "the crew-rest hotel at IND, and a crew rest hotel at OAK",
      "You'd sit in the hub while the packages are sorted",
      "Night flying on the backside of the clock — a night hub turn",
    ])
      expect(avoidedPhrases(ok), ok).toEqual([]);
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
      expect(avoidedPhrases(d.description), d.id).toEqual([]);
      for (const v of [0, 1, 3]) expect(avoidedPhrases(formatValue(v, d)), d.id).toEqual([]);
    }
  });

  it("says where every word comes from: the pack's print, or the ex-pilot's own sentence", () => {
    for (const w of PILOT_WORDS) {
      expect(w.from.trim(), w.term).not.toBe("");
      expect(w.means.trim(), w.term).not.toBe("");
    }
    expect(PACK_WORDS.every((w) => w.source === "pack")).toBe(true);
    expect(EX_PILOT_WORDS.every((w) => w.source === "ex-pilot")).toBe(true);
    // His words are quoted as he said them.
    for (const w of EX_PILOT_WORDS) expect(w.from, w.term).toMatch(/^“.*”$/);
    expect(new Set(PILOT_WORDS.map((w) => w.term.toLowerCase())).size).toBe(PILOT_WORDS.length);
  });

  it("keeps the pack's meaning of block: flying time, not days at home", () => {
    expect(PACK_WORDS.find((w) => w.term === "block")?.means).toMatch(/flying time/);
  });

  it("goes into the prompts with the made-up words named", () => {
    const text = pilotWordsForPrompt();
    expect(text).toMatch(/bid pack's words, as it prints them:\n- trip/);
    expect(text).toMatch(/words pilots use[^\n]*:\n- departure/);
    expect(text).toMatch(/front-end deadhead/);
    expect(text).toMatch(/Never say these[^]*"layover value"/);
    expect(text).toMatch(/"red-eye": say night flying/);
    expect(text).toMatch(/ONLY in these words/);
    expect(text).toMatch(/unless this pilot used the word first/);
    expect(text).toMatch(/Name the domicile by its city/);
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
