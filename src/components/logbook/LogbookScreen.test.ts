import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildProfile, emptyWeights } from "@/lib/preference-logic";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { LoggedMonth } from "@/types/logbook";
import type { PreferenceProfile } from "@/types/preferences";

vi.mock("@/lib/app-state", () => ({ useAppState: () => ({ profile: null, user: null, bidPack: null }) }));
const { CheckInForm, LogbookScreen } = await import("@/components/logbook/LogbookScreen");

const month: LoggedMonth = { id: "m", base: "MEM", aircraft: "MD11", seat: "CAP", month: "NOV26", outcome: "line", lineNumber: "1033", loggedAt: "2026-11-02T00:00:00Z" };

/** Each box with the words of the label it sits in. */
function boxNames(html: string): string[] {
  const boxes = [...html.matchAll(/<(input|textarea)\b/g)].map((b) => b.index!);
  return boxes.map((at) => {
    const open = html.lastIndexOf("<label", at);
    const close = html.lastIndexOf("</label>", at);
    if (open < 0 || close > open) return "";
    return html.slice(open, at).replace(/<[^>]+>/g, "").trim();
  });
}

describe("the logbook check-in", () => {
  it("names every box with a label, not a placeholder alone", () => {
    const html = renderToStaticMarkup(createElement(CheckInForm, { entry: month, onSave: () => {}, onCancel: () => {} }));
    expect(boxNames(html)).toEqual(["Best trip", "Worst trip", "Anything else about the month (optional)"]);
  });

  it("opens on what was saved", () => {
    const html = renderToStaticMarkup(
      createElement(CheckInForm, { entry: { ...month, checkIn: { feel: "worse", bestTrip: "#76", note: "Long sits", at: "2026-12-01T00:00:00Z" } }, onSave: () => {}, onCancel: () => {} })
    );
    expect(html).toContain('value="#76"');
    expect(html).toContain("Long sits");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Worse than I expected/);
  });
});

describe("the logbook on the sample pack", () => {
  const profile: PreferenceProfile = buildProfile(emptyWeights(), false, []);
  const render = (bidPack: typeof SAMPLE_BID_PACK) =>
    renderToStaticMarkup(createElement(LogbookScreen, { bidPack, profile, user: null, seniority: null, onUpdateProfile: () => {} }));

  it("doesn't offer to log its made-up month as the pilot's award", () => {
    const html = render(SAMPLE_BID_PACK);
    expect(html).not.toContain("Log your SAMPLE award");
    expect(html).toContain("This is the sample pack.");
  });

  it("offers it on a real pack, as before", () => {
    const html = render({ ...SAMPLE_BID_PACK, id: "uploaded-mem-md11-cap-nov26", month: "NOV26" });
    expect(html).toContain("Log your NOV26 award");
    expect(html).not.toContain("This is the sample pack.");
  });
});
