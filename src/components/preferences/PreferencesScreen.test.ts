import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BidPack, Line } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

// The priorities editor below the picker reads the app's state; only the picker is under test here.
vi.mock("@/lib/app-state", () => ({ useAppState: () => ({ handleUpdateProfileWith: () => {} }), useBidPackIfAny: () => null }));

const { PreferencesScreen } = await import("@/components/preferences/PreferencesScreen");

const line = (id: string): Line =>
  ({ id: `line-${id}`, lineNumber: id, trips: [], daysOff: 15, totalCreditHours: 75, totalTafbHours: 200, totalBlockHours: 40, totalLandings: 10, totalDepartures: 10 }) as unknown as Line;
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line("1"), line("2")] } as unknown as BidPack;
const model: PilotModel = {
  version: 2,
  // What the brain read from the pilot's words: "I only go home if I get two days".
  home: { airports: ["DEN"], commuter: true, minHomeHours: 48 },
  threads: [],
  notMeasurable: [],
  synopsis: "",
  criteria: [{ id: "off", metric: "daysOff", shape: { kind: "more" }, tier: "medium", weight: 1, confidence: 1, label: "Days off", evidence: [], status: "settled" }],
};
const profile: PreferenceProfile = {
  weights: { ...DEFAULT_WEIGHTS }, deepRoundCompleted: false, tradeoffAnswers: [], explicitTargets: {}, isCommuter: true, commuteFrom: "DEN", hasCrashPad: null,
  cityPreferences: {}, completedAt: "2026-10-11T00:00:00.000Z", implicitWeights: {}, implicitConfidence: {}, discoveredFacts: [], interviewTranscript: [],
  pilotModel: model, brainInterview: { exchanges: [], choices: [], reviewedModel: model },
};

const pressed = (html: string) => [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());

describe("hours at home on Preferences", () => {
  it("shows the hours the ranking counts departures by, not the default, when the pilot's words gave them", () => {
    // The commute step was skipped (no number on the profile); the ranking counts by the 48 hours read from the words.
    const html = renderToStaticMarkup(createElement(PreferencesScreen, { bidPack: pack, profile, onGoToUpload: () => {}, onStartInterview: () => {}, onUpdateProfile: () => {} }));
    const picked = pressed(html.slice(html.indexOf("Time at home")));
    expect(picked[0]).toBe("2 days");
  });

  it("shows the pilot's own pick when they made one", () => {
    const own = { ...profile, minHomeHours: 36, pilotModel: { ...model, home: { ...model.home!, minHomeHours: 36 } } };
    const html = renderToStaticMarkup(createElement(PreferencesScreen, { bidPack: pack, profile: own, onGoToUpload: () => {}, onStartInterview: () => {}, onUpdateProfile: () => {} }));
    expect(pressed(html.slice(html.indexOf("Time at home")))[0]).toBe("36 hours");
  });
});
