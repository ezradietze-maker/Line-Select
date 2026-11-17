import { describe, expect, it } from "vitest";
import { letGoWhenLeft } from "./focus-keeper";

/** A stand-in for the document or the window: keeps its listeners so a test can fire them. */
function target() {
  const listeners = new Map<string, Set<(e: never) => void>>();
  return {
    addEventListener(type: string, fn: (e: never) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: never) => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string, e: object) {
      for (const fn of listeners.get(type) ?? []) fn(e as never);
    },
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

/** A control: still on the page or not, greyed out or not, with what's inside it. */
function control(inside: object[] = []) {
  const el = { isConnected: true, disabled: false, contains: (n: unknown) => n === el || inside.includes(n as object) };
  return el;
}

function setup() {
  const doc = target();
  const win = target();
  const claim = control();
  let held: ReturnType<typeof control> | null = claim;
  const stop = letGoWhenLeft(
    () => held as unknown as HTMLElement | null,
    () => {
      held = null;
    },
    doc as unknown as EventTarget,
    win as unknown as EventTarget
  );
  return { doc, win, claim, stop, held: () => held };
}

const tick = () => Promise.resolve();

describe("the keyboard kept for a control lets go when the pilot leaves it", () => {
  it("a click on the page beside it, while it's still there and working: lets go", async () => {
    const s = setup();
    s.doc.fire("focusout", { target: s.claim, relatedTarget: null });
    await tick();
    expect(s.held()).toBeNull();
  });

  it("focus lost because it went or greyed out: still held, for focus to come back to", async () => {
    const s = setup();
    s.claim.disabled = true;
    s.doc.fire("focusout", { target: s.claim, relatedTarget: null });
    await tick();
    expect(s.held()).toBe(s.claim);
    s.claim.disabled = false;
    s.claim.isConnected = false;
    s.doc.fire("focusout", { target: s.claim, relatedTarget: null });
    await tick();
    expect(s.held()).toBe(s.claim);
  });

  it("a click on the page while it's greyed out and working: lets go", () => {
    // Claim pressed from the keyboard, the pilot clicks on the page while it works, the spots run out: the keyboard
    // landed on "Start free month", and the Space they scrolled with started it.
    const s = setup();
    s.claim.disabled = true;
    s.doc.fire("pointerdown", { target: { page: true } });
    expect(s.held()).toBeNull();
  });

  it("a press on the control itself: still held", () => {
    const s = setup();
    s.doc.fire("pointerdown", { target: s.claim });
    expect(s.held()).toBe(s.claim);
  });

  it("the window or tab left: lets go; a control's own blur alone doesn't", () => {
    const s = setup();
    s.win.fire("blur", { target: { other: true } });
    expect(s.held()).toBe(s.claim);
    s.win.fire("blur", { target: s.win });
    expect(s.held()).toBeNull();
  });

  it("stops listening when the screen goes", () => {
    const s = setup();
    expect(s.doc.count() + s.win.count()).toBe(3);
    s.stop();
    expect(s.doc.count() + s.win.count()).toBe(0);
  });
});
