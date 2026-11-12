import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTradeBoardOpen } from "./trade-client";

const seat = { base: "MEM", aircraft: "B757", seat: "CAP" };
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("asking whether a seat's board is open", () => {
  it("says open or not yet when the server answers", async () => {
    vi.stubGlobal("fetch", answer(200, { open: true }));
    expect(await fetchTradeBoardOpen(seat)).toBe(true);
    vi.stubGlobal("fetch", answer(200, { open: false }));
    expect(await fetchTradeBoardOpen(seat)).toBe(false);
  });

  it("says it couldn't tell, not \"not yet\", when the check fails", async () => {
    vi.stubGlobal("fetch", answer(500, { error: "busy" }));
    expect(await fetchTradeBoardOpen(seat)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await fetchTradeBoardOpen(seat)).toBeNull();
    vi.stubGlobal("fetch", answer(200, {}));
    expect(await fetchTradeBoardOpen(seat)).toBeNull();
  });
});
