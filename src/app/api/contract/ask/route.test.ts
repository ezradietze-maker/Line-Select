import { beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({ structuredCall: vi.fn() }));
vi.mock("@/lib/brain/llm", async (real) => ({ ...(await real<typeof import("@/lib/brain/llm")>()), structuredCall: llm.structuredCall }));
const limits = vi.hoisted(() => ({ day: { ok: true }, hour: { ok: true } }));
vi.mock("@/lib/server/rate-limit", async (real) => ({
  ...(await real<typeof import("@/lib/server/rate-limit")>()),
  checkRateLimit: vi.fn(async () => limits.day),
  checkRequestLimit: vi.fn(async () => limits.hour),
}));
const spend = vi.hoisted(() => ({ check: { ok: true } as { ok: boolean; scope?: string }, recordSpend: vi.fn(async () => {}), signedIn: true }));
vi.mock("@/lib/server/spend-guard", async (real) => ({
  ...(await real<typeof import("@/lib/server/spend-guard")>()),
  checkSpend: vi.fn(async () => spend.check),
  recordSpend: spend.recordSpend,
  spenderFor: vi.fn(async () => ({ key: "u:1", signedIn: spend.signedIn })),
}));
vi.mock("@/lib/server/replay", () => ({ onceForRequest: (_r: Request, _w: number, run: () => Promise<Response>) => run() }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn(async () => {}) }));

const { POST } = await import("./route");
const req = (body: unknown) => new Request("https://example.com/api/contract/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const QUOTE = "The SWW is a period of not less than 115 hours beginning at 1700 CT the day following the posting of the View/Add Processing Window results.";
const usage = { model: "claude-haiku-5-5", inputTokens: 1, outputTokens: 1, costUsd: 0.001, ms: 1 };
const reply = (data: unknown) => ({ data, usage });

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  llm.structuredCall.mockReset();
  spend.recordSpend.mockClear();
  spend.check = { ok: true };
  spend.signedIn = true;
  limits.day = { ok: true };
  limits.hour = { ok: true };
});

describe("POST /api/contract/ask", () => {
  it("returns a checked answer with its section, page and phase, and records the cost", async () => {
    llm.structuredCall.mockResolvedValue(reply({ found: true, answer: "At least 115 hours.", quotes: [{ section: "25.E.6", quote: QUOTE, version: "2026" }] }));
    const res = await POST(req({ question: "How long is the SWW?", bidMonth: "2026-11" }));
    expect(res.status).toBe(200);
    const { answer } = await res.json();
    expect(answer).toMatchObject({ found: true, quotes: [{ section: "25.E.6", page: 158, applies: { kind: "scheduled", phase: 2, inForce: false } }] });
    expect(answer.quotes[0].otherWording).toContain("144 hours");
    expect(spend.recordSpend).toHaveBeenCalledWith(expect.anything(), 0.001);
  });

  it("a made-up section twice over is not found, and both calls are paid for", async () => {
    llm.structuredCall.mockResolvedValue(reply({ found: true, answer: "Yes.", quotes: [{ section: "25.E.99", quote: QUOTE, version: "2026" }] }));
    const { answer } = await (await POST(req({ question: "How long is the SWW?" }))).json();
    expect(answer.found).toBe(false);
    expect(answer.answer).toBe("Not found in the contract sections we have.");
    expect(answer.closest.length).toBeGreaterThan(0);
    expect(answer.covered).toContain("Section 25: Scheduling");
    expect(llm.structuredCall).toHaveBeenCalledTimes(2);
    expect(spend.recordSpend).toHaveBeenCalledWith(expect.anything(), 0.002);
  });

  it("a slip caught the first time gets one more try", async () => {
    llm.structuredCall
      .mockResolvedValueOnce(reply({ found: true, answer: "144 hours.", quotes: [{ section: "25.E.6", quote: QUOTE.replace("115", "144"), version: "2026" }] }))
      .mockResolvedValueOnce(reply({ found: true, answer: "At least 115 hours.", quotes: [{ section: "25.E.6", quote: QUOTE, version: "2026" }] }));
    const { answer } = await (await POST(req({ question: "How long is the SWW?" }))).json();
    expect(answer.found).toBe(true);
    expect(llm.structuredCall.mock.calls[1][0].user.fresh).toContain("failed a check");
  });

  it("not found from the model costs one call", async () => {
    llm.structuredCall.mockResolvedValue(reply({ found: false, answer: "", quotes: [] }));
    const { answer } = await (await POST(req({ question: "How do I reset my VIPS password?" }))).json();
    expect(answer.found).toBe(false);
    expect(llm.structuredCall).toHaveBeenCalledTimes(1);
  });

  it("stops at the limits before paying for anything", async () => {
    limits.hour = { ok: false };
    expect((await POST(req({ question: "q?" }))).status).toBe(429);
    limits.hour = { ok: true };
    limits.day = { ok: false };
    spend.signedIn = false;
    const guest = await POST(req({ question: "q?" }));
    expect(guest.status).toBe(429);
    expect((await guest.json()).error).toContain("Sign in");
    limits.day = { ok: true };
    spend.check = { ok: false, scope: "pilot" };
    expect((await POST(req({ question: "q?" }))).status).not.toBe(200);
    expect(llm.structuredCall).not.toHaveBeenCalled();
  });

  it("turns down an empty or oversized question and oversized facts", async () => {
    expect((await POST(req({ question: "  " }))).status).toBe(400);
    expect((await POST(req({ question: "x".repeat(501) }))).status).toBe(400);
    expect((await POST(req({ question: "q?", facts: "x".repeat(2001) }))).status).toBe(400);
    expect(llm.structuredCall).not.toHaveBeenCalled();
  });

  it("says so when the model call fails, and counts what it cost", async () => {
    llm.structuredCall.mockRejectedValue(Object.assign(new Error("down"), { usage: { costUsd: 0.0005 } }));
    const res = await POST(req({ question: "How long is the SWW?" }));
    expect(res.status).toBe(502);
    expect(spend.recordSpend).toHaveBeenCalledWith(expect.anything(), 0.0005);
  });
});
