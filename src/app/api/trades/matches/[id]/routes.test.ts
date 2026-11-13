import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reportProblem: vi.fn(), answerSuggestion: vi.fn(), markStepDone: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => ({ id: "pilot-1", displayName: "J Pilot" }) }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: mocks.reportProblem }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/trade-suggestions", () => ({ answerSuggestion: mocks.answerSuggestion, markStepDone: mocks.markStepDone }));

const { POST: answer } = await import("./answer/route");
const { POST: step } = await import("./step/route");

const post = (body: unknown) => new Request("https://example.com/api/trades/matches/x", { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => vi.clearAllMocks());

describe("a suggested trade's id", () => {
  // Each passed the old /^[0-9a-f-]{36}$/ check, and Postgres threw on it.
  const malformed = ["-".repeat(36), "a".repeat(36), "0000000-00000-0000-0000-0000000000000"];

  it("that isn't a real one is not found, never a database error that emails the owner", async () => {
    for (const id of malformed) {
      expect((await answer(post({ answer: "accepted" }), params(id))).status).toBe(404);
      expect((await step(post({ step: 0 }), params(id))).status).toBe(404);
    }
    expect(mocks.answerSuggestion).not.toHaveBeenCalled();
    expect(mocks.markStepDone).not.toHaveBeenCalled();
    expect(mocks.reportProblem).not.toHaveBeenCalled();
  });

  it("that is well formed is looked up", async () => {
    mocks.answerSuggestion.mockResolvedValue({ ok: false, reason: "not-found" });
    const id = "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b";
    expect((await answer(post({ answer: "accepted" }), params(id))).status).toBe(404);
    expect(mocks.answerSuggestion).toHaveBeenCalledOnce();
  });
});
