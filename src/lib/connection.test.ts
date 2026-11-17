import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The app's reading of the connection, with the browser and `/api/ping` stood in for. A fresh copy of the module each
 * time: it keeps its reading at the top level, as the page does.
 */
let onWindow: Record<string, () => void> = {};
let ping: (init?: RequestInit) => Promise<Response>;

async function fresh() {
  vi.resetModules();
  return import("./connection");
}

beforeEach(() => {
  onWindow = {};
  vi.useFakeTimers();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", { addEventListener: (type: string, fn: () => void) => void (onWindow[type] = fn) });
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => ping(init)));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connection", () => {
  it("doesn't tell the pilot they're offline when only one request was slow and the server still answers", async () => {
    // Who's signed in took more than 8 seconds (the server slow on that one request) while `/api/ping` answered at
    // once. Before, "Flying offline" went up at 8 seconds and "Back online" at the next check, up to 5 seconds later.
    ping = async () => new Response(null, { status: 204 });
    const c = await fresh();
    c.reportConnectionLost();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.offlineShown()).toBe(false);
    expect(c.isOffline()).toBe(false);
  });

  it("tells them once the ping fails too, or doesn't answer in time", async () => {
    ping = async () => Promise.reject(new TypeError("Failed to fetch"));
    let c = await fresh();
    c.reportConnectionLost();
    expect(c.isOffline()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.offlineShown()).toBe(true);

    // A hotel's Wi-Fi that's there but crawling: the ping hangs as the request did.
    ping = (init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    c = await fresh();
    c.reportConnectionLost();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(c.offlineShown()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(c.offlineShown()).toBe(true);
    expect(c.isOffline()).toBe(true);
  });

  it("believes the browser when it says it's offline, and comes back when the ping answers", async () => {
    ping = async () => Promise.reject(new TypeError("Failed to fetch"));
    const c = await fresh();
    onWindow.offline();
    expect(c.offlineShown()).toBe(true);
    ping = async () => new Response(null, { status: 204 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(c.isOffline()).toBe(false);
    expect(c.offlineShown()).toBe(false);
  });
});
