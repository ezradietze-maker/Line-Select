import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("holding the page still", () => {
  let body: { style: { overflow: string } };
  beforeEach(() => {
    vi.resetModules();
    body = { style: { overflow: "" } };
    vi.stubGlobal("document", { body, querySelector: () => null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("scrolls again only once the last of what's open closes, in whatever order they close", async () => {
    const { lockScroll, scrollLocked } = await import("@/lib/scroll-lock");
    // The palette opened first, then the tour over it; the palette closed first.
    const palette = lockScroll();
    const tour = lockScroll();
    palette();
    expect(body.style.overflow).toBe("hidden");
    expect(scrollLocked()).toBe(true);
    tour();
    expect(body.style.overflow).toBe("");
    expect(scrollLocked()).toBe(false);
  });

  it("counts a release once, however often it's called", async () => {
    const { lockScroll } = await import("@/lib/scroll-lock");
    const dialog = lockScroll();
    const tour = lockScroll();
    dialog();
    dialog();
    expect(body.style.overflow).toBe("hidden");
    tour();
    expect(body.style.overflow).toBe("");
  });

  it("tells what waits for the screen that a sheet marked modal is open, though it holds nothing", async () => {
    vi.stubGlobal("document", { body, querySelector: (s: string) => (s === '[aria-modal="true"]' ? {} : null) });
    const { overlayOpen } = await import("@/lib/scroll-lock");
    expect(overlayOpen()).toBe(true);
  });
});
