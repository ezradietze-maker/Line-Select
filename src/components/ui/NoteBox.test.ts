import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoteBox } from "./NoteBox";

describe("NoteBox", () => {
  it("shows the room left near the limit, but doesn't read it out on every key", () => {
    // In a live region, the count was said after each letter typed, over the letter itself.
    const html = renderToStaticMarkup(createElement(NoteBox, { value: "x".repeat(950), onChange: () => {}, ariaLabel: "Note", maxLength: 1000 }));
    expect(html).toContain("50 characters left");
    expect(html).not.toContain("aria-live");
    // Said once typing pauses, by a status that starts empty: nothing is said on arrival.
    expect(html).toMatch(/<span role="status" class="sr-only"><\/span>/);
  });
});
