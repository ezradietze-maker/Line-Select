import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlipText } from "./FlipText";

describe("FlipText", () => {
  it("keeps the gap between words: a space draws as a no-break space, which an inline-block can't collapse", () => {
    const html = renderToStaticMarkup(createElement(FlipText, { text: "Line 2021" }));
    // The drawn characters, after the screen-reader copy: "Line", a no-break space, "2021".
    const drawn = [...html.matchAll(/<span aria-hidden="true"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]).join("");
    expect(drawn).toBe("Line 2021");
  });
});
