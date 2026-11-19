import { describe, expect, it } from "vitest";
import { buildViewAddFields, makeUpHoursText, MAX_VIEW_ADD_PREFERENCES, parseViewAddSent, vipsViewAddUrl } from "@/lib/vips-view-add";

describe("VIPS's make-up page", () => {
  it("is keyed on the employee number, as the bid page is", () => {
    expect(vipsViewAddUrl("123456")).toBe("https://pilot.fedex.com/vips-bin/vipscgi?webmmu?123456?");
  });

  it("takes hours as HH:MM", () => {
    expect(makeUpHoursText(12)).toBe("12:00");
    expect(makeUpHoursText(8.5)).toBe("08:30");
    expect(makeUpHoursText(18 + 56 / 60)).toBe("18:56");
  });

  it("gets the type, the hours and each preference in its own field, in the page's order", () => {
    const b = buildViewAddFields({ type: "CIA", hours: 18.5, preferences: ["501/09Dec,502/19Dec", "501/09Dec", "RES BLOCK A12"] });
    expect(b).toEqual({
      ok: true,
      preferences: ["501/09Dec,502/19Dec", "501/09Dec", "RES BLOCK A12"],
      fields: [
        ["n999", "Continue"],
        ["nMKPTYP", "CIA"],
        ["nMKPCAP", "18:30"],
        ["n201001", "501/09Dec,502/19Dec"],
        ["n201002", "501/09Dec"],
        ["n201003", "RES BLOCK A12"],
      ],
    });
  });

  it("drops a repeat and blank lines, and refuses what VIPS wouldn't take", () => {
    const b = buildViewAddFields({ type: "MUV", hours: 6, preferences: ["501/09Dec", " ", "501/09Dec"] });
    expect(b.ok && b.preferences).toEqual(["501/09Dec"]);
    expect(buildViewAddFields({ type: "CIA", hours: 0, preferences: ["501/09Dec"] }).ok).toBe(false);
    expect(buildViewAddFields({ type: "CIA", hours: 12, preferences: [] }).ok).toBe(false);
    const many = Array.from({ length: MAX_VIEW_ADD_PREFERENCES + 1 }, (_, i) => `${1000 + i}/09Dec`);
    expect(buildViewAddFields({ type: "CIA", hours: 12, preferences: many })).toMatchObject({ ok: false, reason: expect.stringContaining("99") });
  });

  it("keeps a record of what was sent only when it reads whole", () => {
    const sent = { at: "2026-12-04T15:00:00.000Z", type: "CIA", hours: 18.5, preferences: ["501/09Dec"] };
    expect(parseViewAddSent(JSON.stringify(sent))).toEqual(sent);
    expect(parseViewAddSent(JSON.stringify({ ...sent, type: "XYZ" }))).toBeNull();
    expect(parseViewAddSent("not json")).toBeNull();
    expect(parseViewAddSent(null)).toBeNull();
  });
});
