import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AwardHistorySummary } from "@/lib/award-history";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams() }));
const { AwardSummaryView } = await import("@/components/strategies/AwardHistoryPanel");

const view = (summary: AwardHistorySummary) => renderToStaticMarkup(createElement(AwardSummaryView, { summary }));

describe("the group numbers near a pilot's seniority", () => {
  it("shows how many held a regular line where too few did to average their lines: a slice that all held reserve says 0%", () => {
    const html = view({ totalReports: 20, nearbyCount: 10, avgDaysOff: null, avgCreditHours: null, lineRate: 0 });
    expect(html).toContain("Held a regular line");
    expect(html).toContain("0%");
    expect(html).not.toContain("not quite enough");
  });

  it("still says so when there's nothing yet", () => {
    expect(view({ totalReports: 0, nearbyCount: 0, avgDaysOff: null, avgCreditHours: null, lineRate: null })).toContain("Not enough reports near your seniority yet");
  });

  it("shows every number once there are enough lines to average", () => {
    const html = view({ totalReports: 20, nearbyCount: 10, avgDaysOff: 14.2, avgCreditHours: 72.5, lineRate: 0.6 });
    expect(html).toContain("14.2");
    expect(html).toContain("72:30");
    expect(html).toContain("60%");
  });
});
