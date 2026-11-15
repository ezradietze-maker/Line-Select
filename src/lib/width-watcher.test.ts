import { afterEach, describe, expect, it, vi } from "vitest";
import { widthWatcher } from "@/lib/width-watcher";

/** A stand-in for the browser's observer: remembers what it watches, and can say an element changed size. */
class FakeObserver {
  static all: FakeObserver[] = [];
  watched: Element[] = [];
  constructor(private cb: () => void) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.watched.push(el);
  }
  disconnect() {
    this.watched = [];
  }
  fire() {
    this.cb();
  }
}
vi.stubGlobal("ResizeObserver", FakeObserver);

const box = (width: number) => {
  const el = { width, getBoundingClientRect: () => ({ width: el.width }) };
  return el as unknown as Element & { width: number };
};

afterEach(() => {
  FakeObserver.all = [];
});

describe("widthWatcher", () => {
  it("measures an element that only appears on a later render", () => {
    // The rankings list sits behind a loading screen on the first render: no element yet. Before, the width stayed at
    // the 768px guess for good, and a 375px phone got the laptop layout with a 75px window onto the days.
    const widths: number[] = [];
    const w = widthWatcher((x) => widths.push(x), 768);
    w.follow(null);
    expect(widths).toEqual([]);
    const list = box(343);
    w.follow(list);
    expect(widths).toEqual([343]);
    list.width = 300;
    FakeObserver.all[0].fire();
    expect(widths).toEqual([343, 300]);
  });

  it("starts over only when the element changes, and lets go of the old one", () => {
    const widths: number[] = [];
    const w = widthWatcher((x) => widths.push(x), 768);
    const a = box(500);
    w.follow(a);
    w.follow(a);
    expect(widths).toEqual([500]);
    expect(FakeObserver.all).toHaveLength(1);
    const b = box(320);
    w.follow(b);
    expect(widths).toEqual([500, 320]);
    expect(FakeObserver.all[0].watched).toEqual([]);
    expect(FakeObserver.all[1].watched).toEqual([b]);
    w.stop();
    expect(FakeObserver.all[1].watched).toEqual([]);
  });

  it("uses the guess for an element not drawn yet", () => {
    const widths: number[] = [];
    widthWatcher((x) => widths.push(x), 768).follow(box(0));
    expect(widths).toEqual([768]);
  });
});
