import { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BidPack } from "@/types/bidpack";

/**
 * The interview with the pack changed under it while it's open: a load that had only this device's copy (no answer in
 * time) shows the account's newer pack once the connection is back (`caughtUpState`). Kept mounted, the interview went
 * on with the old pack's questions and answers, and its next save put them up as the new pack's draft, over one begun
 * for that pack on another device. The interview itself is a stand-in that notes each start; the page runs on a
 * stand-in for the browser's page, since it draws nothing else of its own here but a heading.
 */
const doc = vi.hoisted(() => ({
  nodeType: 9,
  activeElement: null,
  body: {},
  addEventListener() {},
  removeEventListener() {},
  createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
  createTextNode: () => ({}),
}));
vi.stubGlobal("window", { document: doc, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {} });
vi.stubGlobal("document", doc);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const app = vi.hoisted(() => ({ bidPack: null as unknown, interviewKey: 0 }));
const started = vi.hoisted(() => [] as string[]);
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));
vi.mock("@/lib/app-state", () => ({
  useAppState: () => ({ bidPack: app.bidPack, profile: null, user: null, interviewKey: app.interviewKey, handleBrainInterviewComplete: () => {} }),
}));
vi.mock("@/components/interview/BrainInterview", () => ({
  BrainInterview: ({ bidPack }: { bidPack: BidPack }) => {
    // Once per start: a new pack handed to the same interview isn't a start.
    useState(() => started.push(bidPack.id));
    return null;
  },
}));

const { createRoot } = await import("react-dom/client");
const { default: InterviewPage } = await import("@/app/interview/page");

describe("the interview page", () => {
  it("starts the interview again on the new pack when the pack changes under it", async () => {
    const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: doc, addEventListener() {}, removeEventListener() {}, appendChild() {} };
    const root = createRoot(container as unknown as HTMLElement);
    app.bidPack = { id: "OCT26" };
    await act(async () => root.render(<InterviewPage />));
    app.bidPack = { id: "NOV26" };
    await act(async () => root.render(<InterviewPage />));
    expect(started).toEqual(["OCT26", "NOV26"]);
  });
});
