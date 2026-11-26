import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MEMBERSHIP_PRICE } from "@/lib/billing";
import { FREE_MEMBER_CAP, FREE_PREVIEW_LINES } from "@/lib/membership";
import { WelcomeScreen } from "./WelcomeScreen";

describe("the landing page", () => {
  const html = renderToStaticMarkup(createElement(WelcomeScreen, { onStart: () => {}, onTrySample: () => {} }));

  it("is in the server's HTML: what it does, what it costs and the first questions", () => {
    for (const words of ["Send to VIPS", "Your vacation, drawn on every line.", "Every trip in the pack, best first.", "Heat Map", "Ask the Contract", "Questions pilots ask first"])
      expect(html).toContain(words);
  });

  it("names the price and the free spots as the Membership page has them", () => {
    expect(html).toContain(`${MEMBERSHIP_PRICE}, your first month free.`);
    expect(html).toContain(`The first ${FREE_MEMBER_CAP} pilots`);
    expect(html).toContain(`top ${FREE_PREVIEW_LINES} lines`);
  });

  it("says what Line Select isn't, and no longer calls itself a prototype or scores lines 0–100", () => {
    expect(html).toContain("not affiliated with FedEx");
    expect(html).not.toMatch(/prototype/i);
    expect(html).not.toContain("0–100");
  });
});
