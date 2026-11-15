import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskQuery } from "@/lib/brain/ask-pack";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * The panel run as a function, its hooks held here: no DOM in these tests, and what matters is what it shows after
 * each reply, not how it draws.
 */
const hooks = vi.hoisted(() => {
  const slots: unknown[] = [];
  let at = 0;
  return {
    slots,
    start: () => void (at = 0),
    reset: () => void (slots.length = 0),
    useState: <T,>(init: T | (() => T)) => {
      const i = at++;
      if (!(i in slots)) slots[i] = typeof init === "function" ? (init as () => T)() : init;
      return [slots[i] as T, (v: T | ((p: T) => T)) => void (slots[i] = typeof v === "function" ? (v as (p: T) => T)(slots[i] as T) : v)] as const;
    },
    useRef: <T,>(init: T) => {
      const i = at++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i] as { current: T };
    },
    useMemo: <T,>(make: () => T) => (at++, make()),
  };
});
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useState: hooks.useState, useRef: hooks.useRef, useMemo: hooks.useMemo }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/shown-account", () => ({ apiFetch: fetchMock }));
vi.mock("@/lib/brain/pack-brief", () => ({ buildPackBrief: () => "brief" }));

const { AskPackPanel } = await import("@/components/results/AskPackPanel");

const profile = { cityRatings: {} } as unknown as PreferenceProfile;
const render = () => {
  hooks.start();
  return AskPackPanel({ bidPack: SAMPLE_BID_PACK, profile, rankedIds: [], packMetrics: null });
};

/** Every piece of text the panel shows, its own elements' children only. */
function text(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement(node)) return text((node.props as { children?: ReactNode }).children);
  return "";
}

function submit() {
  const form = (render().props as { children: ReactNode[] }).children[0] as { props: { onSubmit: (e: { preventDefault: () => void }) => void } };
  form.props.onSubmit({ preventDefault: () => {} });
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("Ask your pack", () => {
  beforeEach(() => {
    hooks.reset();
    fetchMock.mockReset();
  });

  it("doesn't leave the last question's answer up when the next one can't reach the server", async () => {
    const query: AskQuery = { summary: "Lines with fewest trips", conditions: [], sort: null } as unknown as AskQuery;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ query }) });
    render();
    hooks.slots[0] = "fewest trips"; // the question box
    submit();
    await settle();
    expect(text(render())).toContain("Lines with fewest trips");

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    hooks.slots[0] = "lines with Honolulu";
    submit();
    await settle();
    const shown = text(render());
    expect(shown).toContain("Couldn't reach the server");
    expect(shown).not.toContain("Lines with fewest trips");
  });
});
