import type { CaptureResult } from "posthog-js";
import { describe, expect, it } from "vitest";
import { withoutQueries } from "./posthog-loader";

describe("what an event's addresses carry to PostHog", () => {
  it("keeps the path and drops a reset token and the pack's words", () => {
    const event = {
      event: "$pageview",
      properties: {
        $current_url: "https://line-select.app/reset-password?token=SECRET",
        $session_entry_url: "https://line-select.app/results?hotelCity=MEM&hotel=Hilton%20Memphis",
        $referrer: "https://line-select.app/cities?city=ANC#map",
        $pathname: "/results",
        note: "a line? no",
      },
      $set_once: { $initial_current_url: "https://line-select.app/reset-password?token=SECRET" },
    } as unknown as CaptureResult;
    const out = withoutQueries(event)!;
    expect(out.properties).toMatchObject({
      $current_url: "https://line-select.app/reset-password",
      $session_entry_url: "https://line-select.app/results",
      $referrer: "https://line-select.app/cities",
      $pathname: "/results",
      note: "a line? no",
    });
    expect(out.$set_once).toEqual({ $initial_current_url: "https://line-select.app/reset-password" });
  });

  it("cuts addresses inside an event's own parts, and a page's own address, too", () => {
    const event = {
      event: "$web_vitals",
      properties: {
        $web_vitals_LCP_event: { value: 900, $current_url: "https://line-select.app/contract?q=Can%20I%20drop", attribution: { navigationURL: "/contract?q=x" } },
        readings: [{ url: "results?line=2163" }],
      },
    } as unknown as CaptureResult;
    const out = withoutQueries(event)!.properties as Record<string, unknown>;
    expect(out.$web_vitals_LCP_event).toEqual({ value: 900, $current_url: "https://line-select.app/contract", attribution: { navigationURL: "/contract" } });
    expect(out.readings).toEqual([{ url: "results" }]);
  });
});
