import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/app-state", () => ({ useAppState: () => ({ ready: true, user: null, bidPack: null, handleTrySample: () => {} }) }));

import PricingPage from "./page";

describe("the pricing page", () => {
  it("names the membership's price and free month, as the Membership page charges it", () => {
    // It said "Pricing to be announced" and that no Pro plan existed, while Membership offered $20/month with a free month.
    const html = renderToStaticMarkup(createElement(PricingPage));
    expect(html).toContain("$20/month");
    expect(html).toContain("first month free");
    expect(html).not.toContain("to be announced");
    expect(html).toContain("free for every pilot");
  });
});
