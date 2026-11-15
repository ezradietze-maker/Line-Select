import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { PilotModel } from "@/types/pilot-model";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/preferences" }));
// The priorities editor reads the app's state; this is only about the section above it.
vi.mock("@/components/preferences/PilotPrioritiesEditor", () => ({ PilotPrioritiesEditor: () => null }));
const { PreferencesScreen } = await import("@/components/preferences/PreferencesScreen");

const pilotModel = { version: 2, home: { airports: ["SAN"], commuter: true, minHomeHours: 48 }, criteria: [], threads: [], notMeasurable: [], synopsis: "" } as PilotModel;
const view = (minHomeHours: number | null) =>
  renderToStaticMarkup(
    createElement(PreferencesScreen, {
      bidPack: SAMPLE_BID_PACK,
      profile: {
        weights: { ...DEFAULT_WEIGHTS },
        deepRoundCompleted: false,
        tradeoffAnswers: [],
        explicitTargets: {},
        cityPreferences: {},
        completedAt: new Date(0).toISOString(),
        implicitWeights: {},
        implicitConfidence: {},
        discoveredFacts: [],
        interviewTranscript: [],
        isCommuter: true,
        commuteFrom: "SAN",
        hasCrashPad: false,
        minHomeHours,
        pilotModel,
      } as PreferenceProfile,
      onGoToUpload: () => {},
      onStartInterview: () => {},
      onUpdateProfile: () => {},
    })
  );
/** The hours-at-home choice shown as picked. */
const picked = (html: string) => [...html.matchAll(/aria-pressed="true"[^>]*>(?:<[^>]*>)*?<span[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);

describe("Time at home on Preferences", () => {
  it("shows the hours the departures are counted by: the brain's reading of his words when he skipped the question", () => {
    // He never picked; the brain read two days from what he said, and the rankings and cards count by it.
    expect(picked(view(null))).toContain("2 days");
    expect(picked(view(null))).not.toContain("24 hours");
  });
});
