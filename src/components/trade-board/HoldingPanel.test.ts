import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-state", () => ({ useAppState: () => ({ profile: null, user: null }) }));
const { TradeSettingsSwitches } = await import("@/components/trade-board/HoldingPanel");

const render = (held: boolean, emailMatches: boolean, suggestMe = true) =>
  renderToStaticMarkup(createElement(TradeSettingsSwitches, { settings: { suggestMe, emailMatches }, held, emailsOn: emailMatches && suggestMe, onChange: () => {} }));

describe("the trade email switch", () => {
  it("is there on a pack with nothing confirmed while emails are going: they're about another month's pack, and say to turn them off here", () => {
    const html = render(false, true);
    expect(html).toContain("Email me when a trade needs my answer");
    expect(html).not.toContain("Include me");
  });

  it("isn't, on a pack with nothing confirmed, when there are no emails to turn off", () => {
    expect(render(false, false)).toBe("");
    expect(render(false, true, false)).toBe("");
  });

  it("sits with Include me where they hold something, as before", () => {
    const html = render(true, false);
    expect(html).toContain("Include me when suggesting trades");
    expect(html).toContain("Email me when a trade needs my answer");
  });
});
