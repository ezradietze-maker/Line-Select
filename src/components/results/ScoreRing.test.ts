import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScoreRing } from "./ScoreRing";

const name = (props: Parameters<typeof ScoreRing>[0]) => renderToStaticMarkup(createElement(ScoreRing, props)).match(/aria-label="([^"]*)"/)?.[1];

describe("ScoreRing's name", () => {
  it("says what the score is: a line's Satisfaction Index, a trip's Trip Index", () => {
    expect(name({ score: 87.24, index: true })).toBe("Satisfaction Index 87.2 out of 100");
    // On Trip Rankings it read "Satisfaction Index" over a trip the page calls the Trip Index.
    expect(name({ score: 87.24, index: true, trip: true })).toBe("Trip Index 87.2 out of 100");
    expect(name({ score: 71.6 })).toBe("Score 72 out of 100");
  });
});
