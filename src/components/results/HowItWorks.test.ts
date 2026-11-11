import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HowItWorksContent } from "./HowItWorks";

const text = renderToStaticMarkup(createElement(HowItWorksContent)).replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'");

describe("How this works", () => {
  it("describes the story-driven interview, not the slider one it replaced", () => {
    expect(text).not.toMatch(/slider|deeper round|exact target/i);
    expect(text).toMatch(/in your own words/);
    expect(text).toMatch(/two real lines side by side/);
  });

  it("names everything the server sees that the Privacy Policy lists", () => {
    for (const thing of ["Ask your pack", "Ask the contract", "swapping or correcting lines", "commuting flights", "hotel names", "bid forecast", "Trade Board"]) expect(text).toContain(thing);
  });
});
