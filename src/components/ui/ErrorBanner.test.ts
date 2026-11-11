import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBanner } from "./ErrorBanner";

describe("ErrorBanner", () => {
  it("is an alert, so a screen reader reads the error out when it appears", () => {
    const html = renderToStaticMarkup(createElement(ErrorBanner, null, "That password doesn't match."));
    expect(html).toContain('role="alert"');
    expect(html).toContain("That password doesn&#x27;t match.");
  });
});
