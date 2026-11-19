import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { bidPack: { id: string } | null; user: { id: string } | null } = { bidPack: null, user: null };
vi.mock("@/lib/app-state", () => ({ useAppState: () => state }));

import { MembershipLocked } from "./MembershipLocked";

const shown = () => renderToStaticMarkup(createElement<{ tool?: string }>(MembershipLocked, { tool: "Strategies" })).replace(/<[^>]+>/g, " ");

describe("the locked screen", () => {
  beforeEach(() => {
    state.bidPack = null;
    state.user = null;
  });

  it("tells a signed-in pilot with their own pack it's uploaded and ready", () => {
    state.bidPack = { id: "uploaded-mem-b777-fo-oct26" };
    state.user = { id: "u1" };
    expect(shown()).toContain("Your bid pack is uploaded and ready.");
    expect(shown()).not.toContain("Sign in");
  });

  it("doesn't tell a guest on the sample pack that their bid pack is uploaded", () => {
    // Since membership went live, a guest trying the sample was told "Your bid pack is uploaded and ready".
    state.bidPack = { id: "sample-bidpack" };
    expect(shown()).not.toContain("uploaded");
    expect(shown()).toContain("the sample bid pack");
    expect(shown()).toContain("Sign in from the account menu");
  });

  it("says the sample is the sample to a signed-in pilot too", () => {
    state.bidPack = { id: "sample-bidpack" };
    state.user = { id: "u1" };
    expect(shown()).toContain("the sample bid pack");
    expect(shown()).not.toContain("Sign in");
  });

  it("asks a guest with their own pack on this device to sign in", () => {
    state.bidPack = { id: "uploaded-mem-b777-fo-oct26" };
    expect(shown()).toContain("Your bid pack is uploaded and ready.");
    expect(shown()).toContain("Sign in from the account menu");
  });
});
