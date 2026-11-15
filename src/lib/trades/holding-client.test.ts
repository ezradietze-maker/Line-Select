import { afterEach, describe, expect, it, vi } from "vitest";
import { answerSuggestion, findTradesNow } from "./holding-client";

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
// Only once FREE_FOR_ALL is off: the server's `accessRefusal`.
const words = "A Line Select membership unlocks this. Start yours to carry on.";

afterEach(() => vi.unstubAllGlobals());

describe("suggested trades turned away for no membership", () => {
  it("Find trades says it's the membership, not that it couldn't look just now", async () => {
    // Read as any other failure, the pilot was told to try again in a moment, for good.
    vi.stubGlobal("fetch", answer(402, { error: words, upgrade: "/membership" }));
    expect(await findTradesNow("p")).toEqual({ membership: words });
    vi.stubGlobal("fetch", answer(503, { error: "busy" }));
    expect(await findTradesNow("p")).toBeNull();
  });

  it("saying yes says it's the membership", async () => {
    vi.stubGlobal("fetch", answer(402, { error: words, upgrade: "/membership" }));
    expect(await answerSuggestion("s1", "accepted")).toEqual({ ok: false, error: words, confirmEmail: false, membership: true });
  });
});
